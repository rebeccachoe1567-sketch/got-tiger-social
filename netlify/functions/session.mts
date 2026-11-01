// GET  /api/session         -> { owner, configured }
// POST /api/session/login   -> sign in with the owner password
// POST /api/session/logout  -> sign out
import type { Config, Context } from "@netlify/functions";
import { authConfigured, checkPassword, clearCookie, isOwner, sessionCookie } from "../lib/auth.mts";
import { LoginBody, parseBody } from "../lib/validate.mts";

export default async (req: Request, context: Context) => {
  const action = context.params.action;
  if (req.method === "GET" && !action) return Response.json({ owner: isOwner(context), configured: authConfigured() });

  if (req.method === "POST" && action === "login") {
    if (!authConfigured()) return Response.json({ error: "Owner password isn't set up yet in Netlify." }, { status: 503 });
    const body = await parseBody(req, LoginBody);
    if ("error" in body) return body.error;
    if (!checkPassword(body.data.password)) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      return Response.json({ error: "Wrong password." }, { status: 401 });
    }
    return Response.json({ owner: true }, { headers: { "set-cookie": sessionCookie() } });
  }

  if (req.method === "POST" && action === "logout") return Response.json({ owner: false }, { headers: { "set-cookie": clearCookie() } });
  return Response.json({ error: "Not found" }, { status: 404 });
};

export const config: Config = { path: ["/api/session", "/api/session/:action"] };
