// GET /api/status -> what the dashboard needs to show (no secrets or setting names).
import type { Config } from "@netlify/functions";
import { llmMode } from "../lib/llm.mts";

export default async () =>
  Response.json({
    ai: llmMode(),
    bluesky: !!(Netlify.env.get("BLUESKY_HANDLE") && Netlify.env.get("BLUESKY_APP_PASSWORD")),
  });

export const config: Config = { path: "/api/status" };
