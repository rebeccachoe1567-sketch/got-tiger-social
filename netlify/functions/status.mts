import type { Config } from "@netlify/functions";
import { llmMode } from "../lib/llm.mts";

export default async () =>
  Response.json({
    ai: llmMode(),
    model: Netlify.env.get("AGENT_MODEL") || "claude-haiku-4-5",
    gateway: !!Netlify.env.get("ANTHROPIC_BASE_URL"),
    bluesky: !!(Netlify.env.get("BLUESKY_HANDLE") && Netlify.env.get("BLUESKY_APP_PASSWORD")),
    blueskyHandle: Netlify.env.get("BLUESKY_HANDLE") || null,
    webhook: !!Netlify.env.get("NOTIFY_WEBHOOK_URL"),
  });

export const config: Config = { path: "/api/status" };
