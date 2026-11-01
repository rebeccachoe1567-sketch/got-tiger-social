// POST /api/internal/step : one step of the agent pipeline.
// Only accepts requests signed by this server (x-step-token), answers right away,
// and does the work after responding so each step stays within the time limit.
import type { Config, Context } from "@netlify/functions";
import { verifyStepToken } from "../lib/auth.mts";
import { runStep, stepKey } from "../lib/pipeline.mts";
import { parseBody, StepBody } from "../lib/validate.mts";

export default async (req: Request, context: Context) => {
  const body = await parseBody(req, StepBody);
  if ("error" in body) return body.error;
  if (!verifyStepToken(stepKey(body.data), req.headers.get("x-step-token"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  context.waitUntil(runStep(body.data, new URL(req.url).origin));
  return new Response(null, { status: 202 });
};

export const config: Config = { path: "/api/internal/step", method: "POST" };
