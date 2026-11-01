import type { Config } from "@netlify/functions";
import { DEFAULT_PROFILE } from "../lib/defaults.mts";
import { getProfile, saveProfile } from "../lib/store.mts";

export default async (req: Request) => {
  if (req.method === "PUT") {
    const body = await req.json();
    const p = { ...DEFAULT_PROFILE, ...body };
    p.menu = (p.menu || []).filter((m: any) => m.name).map((m: any) => ({ name: String(m.name).trim(), price: Number(m.price) || 0, category: m.category || "Other", tags: m.tags || [] }));
    p.latitude = Number(p.latitude);
    p.longitude = Number(p.longitude);
    await saveProfile(p);
    return Response.json(p);
  }
  if (req.method === "DELETE") {
    await saveProfile(DEFAULT_PROFILE);
    return Response.json(DEFAULT_PROFILE);
  }
  return Response.json(await getProfile());
};

export const config: Config = { path: "/api/profile" };
