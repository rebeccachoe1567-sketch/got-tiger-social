// GET  /api/automation      -> run log, notifications, last run
// POST /api/automation/run  -> run the publishing automation now (manual trigger)
// POST /api/automation/reset -> clear demo posts/logs (keeps business profile)
import type { Config, Context } from "@netlify/functions";
import { runPublishingAutomation } from "../lib/automation.mts";
import { getMeta, listNotifications, listRuns, resetDemo } from "../lib/store.mts";

export default async (req: Request, context: Context) => {
  const action = context.params.action;
  if (req.method === "POST" && action === "run") return Response.json(await runPublishingAutomation("manual: owner clicked Run now"));
  if (req.method === "POST" && action === "reset") {
    await resetDemo();
    return Response.json({ ok: true });
  }
  const [runs, notifications, lastRun] = await Promise.all([listRuns(), listNotifications(), getMeta("lastRun")]);
  return Response.json({ runs, notifications, lastRun, schedule: "Every 15 minutes" });
};

export const config: Config = { path: ["/api/automation", "/api/automation/:action"] };
