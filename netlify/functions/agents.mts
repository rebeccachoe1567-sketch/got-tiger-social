// POST /api/agents/strategist | writer | reviewer
import type { Config, Context } from "@netlify/functions";
import { runReviewer, runStrategist, runWriter } from "../lib/agents.mts";
import { getProfile, listPosts } from "../lib/store.mts";

export default async (req: Request, context: Context) => {
  const agent = context.params.agent;
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

export const config: Config = { path: "/api/agents/:agent", method: "POST" };
