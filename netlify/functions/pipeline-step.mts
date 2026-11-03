// POST /api/internal/step : one step of the agent pipeline.
// Only accepts small requests signed by this server (x-step-token). The signature header and
// size are checked before the body is read; the work happens after responding.
import type { Config, Context } from "@netlify/functions";
import { verifyStepToken } from "../lib/auth.mts";
import { runStep, stepKey } from "../lib/pipeline.mts";
import { parseBody, StepBody } from "../lib/validate.mts";

const MAX_STEP_BYTES = 512;

export default async (req: Request, context: Context) => {
  const token = req.headers.get("x-step-token");
  if (!token || token.length > 128) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (Number(req.headers.get("content-length") || "0") > MAX_STEP_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  const body = await parseBody(req, StepBody, MAX_STEP_BYTES);
  if ("error" in body) return body.error;
  if (!verifyStepToken(stepKey(body.data), token)) return Response.json({ error: "Forbidden" }, { status: 403 });
  context.waitUntil(runStep(body.data, new URL(req.url).origin));
  return new Response(null, { status: 202 });
};

export const config: Config = { path: "/api/internal/step", method: "POST" };
