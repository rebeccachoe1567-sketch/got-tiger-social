// GET  /api/automation        -> run log, notifications, last run (read-only)
// POST /api/automation/run    -> run the publishing automation now (owner)
// POST /api/automation/reset  -> clear posts, runs and logs; keeps the profile (owner)
import type { Config, Context } from "@netlify/functions";
import { requireOwner } from "../lib/auth.mts";
import { runPublishingAutomation } from "../lib/automation.mts";
import { getMeta, listNotifications, listRuns, resetDemo } from "../lib/store.mts";
import type { AutomationRun } from "../lib/types.mts";

export default async (req: Request, context: Context) => {
  const action = context.params.action;
  if (req.method === "GET" && !action) {
    const [runs, notifications, lastRun] = await Promise.all([listRuns(), listNotifications(), getMeta<AutomationRun>("lastRun")]);
    return Response.json({ runs, notifications, lastRun, schedule: "Every 15 minutes" });
  }
  if (req.method !== "POST") return Response.json({ error: "Not found" }, { status: 404 });
  const denied = requireOwner(context);
  if (denied) return denied;
  if (action === "run") return Response.json(await runPublishingAutomation("manual: owner clicked Run now"));
  if (action === "reset") {
    await resetDemo();
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Not found" }, { status: 404 });
};

export const config: Config = { path: ["/api/automation", "/api/automation/:action"] };
