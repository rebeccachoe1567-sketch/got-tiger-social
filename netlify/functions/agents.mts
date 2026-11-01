// POST /api/agents/strategist | writer | reviewer
import type { Config, Context } from "@netlify/functions";
import { runReviewer, runStrategist, runWriter } from "../lib/agents.mts";
import { getProfile, listPosts } from "../lib/store.mts";
import { llmMode } from "../lib/llm.mts";

export default async (req: Request, context: Context) => {
  const agent = context.params.agent;
  if (req.method === "GET") {
    const keys = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "NETLIFY_AI_GATEWAY_KEY", "NETLIFY_AI_GATEWAY_URL", "FORCE_OFFLINE", "LOCAL_DEV"];
    return Response.json({
      agent,
      mode: llmMode(),
      netlifyEnv: Object.fromEntries(keys.map((k) => [k, !!Netlify.env.get(k)])),
      processEnv: Object.fromEntries(keys.map((k) => [k, !!process.env[k]])),
    });
  }
  const body = await req.json().catch(() => ({}));
  const profile = await getProfile();
  try {
    if (agent === "strategist") return Response.json(await runStrategist(body, profile, await listPosts()));
    if (agent === "writer") return Response.json(await runWriter(body, profile));
    if (agent === "reviewer") return Response.json(await runReviewer(body, profile, await listPosts()));
    return Response.json({ error: "Unknown agent" }, { status: 404 });
  } catch (e: any) {
    console.error(agent, e);
    return Response.json({ error: `${agent} agent failed: ${e?.message || e}` }, { status: 500 });
  }
};

export const config: Config = { path: "/api/agents/:agent", method: ["GET", "POST"] };
