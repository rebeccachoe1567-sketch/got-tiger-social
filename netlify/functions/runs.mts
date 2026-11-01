// POST /api/runs      -> start the agent pipeline on the server (owner only)
// GET  /api/runs/:id  -> watch a run's progress (read-only)
import type { Config, Context } from "@netlify/functions";
import { requireOwner } from "../lib/auth.mts";
import { runView, startRun } from "../lib/pipeline.mts";
import { parseBody, StartRunBody } from "../lib/validate.mts";

export default async (req: Request, context: Context) => {
  const id = context.params.id;
  if (req.method === "GET" && id) {
    if (!/^[a-z0-9]{6,20}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
    const view = await runView(id);
    return view ? Response.json(view) : Response.json({ error: "Not found" }, { status: 404 });
  }
  if (req.method === "POST" && !id) {
    const denied = requireOwner(context);
    if (denied) return denied;
    const body = await parseBody(req, StartRunBody);
    if ("error" in body) return body.error;
    try {
      const run = await startRun(body.data.goal, body.data.count, new URL(req.url).origin);
      return Response.json({ runId: run.id }, { status: 202 });
    } catch (e) {
      return Response.json({ error: `Couldn't start the agents: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
    }
  }
  return Response.json({ error: "Not found" }, { status: 404 });
};

export const config: Config = { path: ["/api/runs", "/api/runs/:id"] };
