// Server-side agent pipeline. The browser can only START a run and WATCH it.
// Each step (plan, write, review, design) runs in its own short function call and then
// triggers the next step with a signed request, so no single call hits the 60s limit and
// the browser never supplies drafts or reviews.
import { runReviewer, runStrategist, runWriter } from "./agents.mts";
import { stepToken } from "./auth.mts";
import { generateGraphic, imageAvailable } from "./designer.mts";
import { claim, getActiveRun, getLane, getPost, getProfile, getRun, listLanes, listPosts, saveLane, savePost, saveRun, setActiveRun, useQuota } from "./store.mts";
import { errorRef } from "./validate.mts";
import type { Lane, Post, RoundSummary, RunMeta } from "./types.mts";

export const MAX_ROUNDS = 3; // first draft + up to 2 revisions
export type StepName = "plan" | "write" | "review" | "design";
export type StepPayload = { runId: string; step: StepName; lane?: number; round?: number };

export const stepKey = (p: StepPayload) => `${p.runId}:${p.step}:${p.lane ?? "-"}:${p.round ?? "-"}`;

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

// Spending limits (override with environment variables if needed).
const limit = (name: string, fallback: number) => Math.max(0, Number(Netlify.env.get(name)) || fallback);
export const MAX_RUNS_PER_DAY = () => limit("MAX_RUNS_PER_DAY", 8);
export const MAX_GRAPHICS_PER_DAY = () => limit("MAX_GRAPHICS_PER_DAY", 30);
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

export class LimitError extends Error {}

/** Logs the real error and returns a message that is safe to show publicly. */
function publicError(e: unknown, what: string) {
  const ref = errorRef();
  console.error(`[${ref}] ${what}`, e);
  return `${what} failed (ref ${ref}). Try again in a minute.`;
}

export async function dispatch(origin: string, payload: StepPayload) {
  const res = await fetch(`${origin}/api/internal/step`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-step-token": stepToken(stepKey(payload)) },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Could not start step ${payload.step} (${res.status})`);
}

export async function startRun(goal: string, count: number, origin: string): Promise<RunMeta> {
  // Only one run at a time.
  const active = await getActiveRun();
  if (active && Date.now() - active.at < RUN_TIMEOUT_MS) {
    const view = await runView(active.id);
    if (view && (view.run.status === "planning" || view.run.status === "running")) throw new LimitError("A run is already in progress. Wait for it to finish.");
  }
  // Daily cap on runs (each run can make up to 5 posts and 5 graphics).
  if (!(await useQuota("runs", MAX_RUNS_PER_DAY()))) throw new LimitError(`Daily limit reached (${MAX_RUNS_PER_DAY()} runs). It resets at midnight UTC.`);
  const run: RunMeta = { id: newId(), goal, count, status: "planning", createdAt: new Date().toISOString() };
  await saveRun(run);
  await setActiveRun(run.id);
  await dispatch(origin, { runId: run.id, step: "plan" });
  return run;
}

/** What the browser sees while it watches a run. */
export async function runView(id: string) {
  const run = await getRun(id);
  if (!run) return null;
  const lanes = run.laneCount ? await listLanes(id, run.laneCount) : [];
  const done = run.status === "error" || (run.status === "running" && lanes.length === run.laneCount && lanes.every((l) => l.state === "done" || l.state === "error"));
  return { run: { ...run, status: done && run.status !== "error" ? "done" : run.status }, lanes };
}

export async function runStep(p: StepPayload, origin: string) {
  // Each step runs once, even if the same signed request is delivered twice.
  if (!(await claim(`step:${stepKey(p)}`))) return;
  try {
    if (p.step === "plan") return await planStep(p.runId, origin);
    if (p.lane === undefined) throw new Error("Lane is required");
    if (p.step === "write") return await writeStep(p.runId, p.lane, p.round ?? 1, origin);
    if (p.step === "review") return await reviewStep(p.runId, p.lane, p.round ?? 1, origin);
    if (p.step === "design") return await designStep(p.runId, p.lane, origin);
  } catch (e) {
    console.error("pipeline step failed", p, e);
    if (p.step === "plan") {
      const run = await getRun(p.runId);
      if (run) await saveRun({ ...run, status: "error", error: publicError(e, "Planning") });
    } else if (p.lane !== undefined) {
      const lane = await getLane(p.runId, p.lane);
      if (lane) await saveLane(p.runId, { ...lane, state: "error", error: publicError(e, p.step === "design" ? "The graphic" : "This post") });
    }
  }
}

async function planStep(runId: string, origin: string) {
  const run = await getRun(runId);
  if (!run || run.status !== "planning") return; // already planned (duplicate request)
  const [profile, posts] = await Promise.all([getProfile(), listPosts()]);
  const strat = await runStrategist({ goal: run.goal, count: run.count }, profile, posts);
  for (const [index, plan] of strat.posts.entries()) {
    await saveLane(runId, { index, plan, state: "writing", rounds: [], updatedAt: "" });
  }
  await saveRun({ ...run, status: "running", summary: strat.summary, strategistTrace: strat.trace, mode: strat.mode, laneCount: strat.posts.length });
  await Promise.all(strat.posts.map((_, lane) => dispatch(origin, { runId, step: "write", lane, round: 1 })));
}

async function writeStep(runId: string, laneIndex: number, round: number, origin: string) {
  const lane = await getLane(runId, laneIndex);
  if (!lane || lane.state !== "writing" || lane.rounds.length !== round - 1 || round > MAX_ROUNDS) return;
  const prev = lane.rounds.at(-1);
  const profile = await getProfile();
  const w = await runWriter({ plan: lane.plan, previous: prev?.draft, feedback: prev?.review?.feedback_for_writer }, profile);
  lane.rounds.push({ round, draft: w.draft, writerTrace: w.trace });
  lane.state = "reviewing";
  await saveLane(runId, lane);
  await dispatch(origin, { runId, step: "review", lane: laneIndex, round });
}

async function reviewStep(runId: string, laneIndex: number, round: number, origin: string) {
  const lane = await getLane(runId, laneIndex);
  const current = lane?.rounds[round - 1];
  if (!lane || lane.state !== "reviewing" || lane.rounds.length !== round || !current?.draft || current.review) return;
  const [profile, posts] = await Promise.all([getProfile(), listPosts()]);
  const r = await runReviewer({ plan: lane.plan, draft: current.draft }, profile, posts);
  current.review = r.review;
  current.reviewerTrace = r.trace;

  if (r.review.decision === "revise" && round < MAX_ROUNDS) {
    lane.state = "writing";
    await saveLane(runId, lane);
    await dispatch(origin, { runId, step: "write", lane: laneIndex, round: round + 1 });
    return;
  }

  // A post is created once per lane, even if this step were to run twice.
  if (!(await claim(`post:${runId}:${laneIndex}`))) return;
  const run = await getRun(runId);
  const post = await savePost(buildPost(lane, run?.summary, runId));
  lane.postId = post.id;
  lane.state = post.status === "rejected_by_agent" ? "done" : "designing";
  await saveLane(runId, lane);
  if (lane.state === "designing") await dispatch(origin, { runId, step: "design", lane: laneIndex });
}

function buildPost(lane: Lane, strategySummary: string | undefined, runId: string): Post {
  const last = lane.rounds.at(-1);
  if (!last?.draft || !last.review) throw new Error("Lane has no reviewed draft");
  const rounds: RoundSummary[] = lane.rounds
    .filter((x) => x.review)
    .map((x) => ({
      round: x.round,
      decision: x.review!.decision,
      score: x.review!.score,
      feedback: x.review!.feedback_for_writer,
      changes: x.draft?.changes_made,
      guardrail: x.review!.guardrail_override ?? null,
    }));
  return {
    id: `${runId}${lane.index}`, // deterministic, so a repeat can never create a second post
    createdAt: new Date().toISOString(),
    platform: lane.plan.platform,
    plan: lane.plan,
    draft: last.draft,
    review: last.review,
    rounds,
    runId,
    strategySummary,
    status: last.review.decision === "reject" ? "rejected_by_agent" : "awaiting_owner",
    scheduledFor: lane.plan.publish_at,
    scheduledLocal: lane.plan.publish_at_local,
  };
}

async function designStep(runId: string, laneIndex: number, origin: string) {
  const lane = await getLane(runId, laneIndex);
  if (!lane || lane.state !== "designing" || !lane.postId) return;
  const post = await getPost(lane.postId);
  if (!post) throw new Error("Post not found");
  if (!imageAvailable()) {
    await saveLane(runId, { ...lane, state: "done", error: "Graphics are only generated on the live site." });
    return;
  }
  if (!(await useQuota("graphics", MAX_GRAPHICS_PER_DAY()))) {
    await saveLane(runId, { ...lane, state: "done", error: `Daily graphic limit reached (${MAX_GRAPHICS_PER_DAY()}). Generate it from Approvals tomorrow.` });
    return;
  }
  const profile = await getProfile();
  post.image = await generateGraphic(post, profile, origin);
  await savePost(post);
  await saveLane(runId, { ...lane, state: "done", graphicUrl: post.image.url });
}
