// GET    /api/profile -> the business profile (read-only)
// PUT    /api/profile -> save it (owner)
// DELETE /api/profile -> reset to defaults (owner)
import type { Config, Context } from "@netlify/functions";
import { requireOwner } from "../lib/auth.mts";
import { DEFAULT_PROFILE, type Profile } from "../lib/defaults.mts";
import { getProfile, saveProfile } from "../lib/store.mts";
import { parseBody, ProfileBody } from "../lib/validate.mts";

export default async (req: Request, context: Context) => {
  if (req.method === "GET") return Response.json(await getProfile());
  const denied = requireOwner(context);
  if (denied) return denied;
  if (req.method === "PUT") {
    const body = await parseBody(req, ProfileBody);
    if ("error" in body) return body.error;
    const p: Profile = { ...body.data };
    await saveProfile(p);
    return Response.json(p);
  }
  if (req.method === "DELETE") {
    await saveProfile(DEFAULT_PROFILE);
    return Response.json(DEFAULT_PROFILE);
  }
  return Response.json({ error: "Not found" }, { status: 404 });
};

export const config: Config = { path: "/api/profile" };
