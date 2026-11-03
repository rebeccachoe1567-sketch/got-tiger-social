// GET  /api/session         -> { owner, configured }
// POST /api/session/login   -> sign in with the owner password (attempt-limited)
// POST /api/session/logout  -> sign out (ends the session on the server too)
import type { Config, Context } from "@netlify/functions";
import { authConfigured, checkPassword, createSession, endSession, isOwner, recordFailure, recordSuccess, signInWait } from "../lib/auth.mts";
import { LoginBody, parseBody } from "../lib/validate.mts";

export default async (req: Request, context: Context) => {
  const action = context.params.action;
  if (req.method === "GET" && !action) return Response.json({ owner: await isOwner(context), configured: authConfigured() });

  if (req.method === "POST" && action === "login") {
    if (!authConfigured()) return Response.json({ error: "Owner sign-in isn't set up in Netlify yet." }, { status: 503 });
    const wait = await signInWait(context);
    if (wait) return Response.json({ error: `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` }, { status: 429 });
    const body = await parseBody(req, LoginBody, 1024);
    if ("error" in body) return body.error;
    if (!checkPassword(body.data.password)) {
      await recordFailure(context);
      await new Promise((r) => setTimeout(r, 600));
      return Response.json({ error: "Wrong password." }, { status: 401 });
    }
    await recordSuccess(context);
    return Response.json({ owner: true }, { headers: { "set-cookie": await createSession() } });
  }

  if (req.method === "POST" && action === "logout") return Response.json({ owner: false }, { headers: { "set-cookie": await endSession(context) } });
  return Response.json({ error: "Not found" }, { status: 404 });
};

export const config: Config = { path: ["/api/session", "/api/session/:action"] };
