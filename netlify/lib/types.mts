// Shared types for agents, posts, pipeline runs and the automation.

export type Platform = "Instagram" | "TikTok" | "Facebook" | "Bluesky";
export const PLATFORMS: Platform[] = ["Instagram", "TikTok", "Facebook", "Bluesky"];

export type Severity = "low" | "medium" | "high";
export type Issue = { severity: Severity; problem: string };

export type TraceStep =
  | { type: "thought"; text: string }
  | { type: "tool"; tool: string; input: unknown; summary: string }
  | { type: "final"; tool: string };

export type PlanItem = {
  platform: Platform;
  publish_at_local: string;
  publish_at: string;
  weekday: string;
  menu_items: string[];
  angle: string;
  goal: string;
  format: string;
  reasoning: string;
};

export type Draft = {
  caption: string;
  hashtags: string[];
  headline?: string;
  tagline?: string;
  visual_idea: string;
  call_to_action?: string;
  changes_made?: string;
};

export type ReviewDecision = "approve" | "revise" | "reject";
export type Review = {
  decision: ReviewDecision;
  score: number;
  issues: Issue[];
  feedback_for_writer: string;
  owner_should_check: string;
  guardrail_override?: string;
};

export type Graphic = {
  url: string;
  model: string;
  aspect: string;
  references: { logo: boolean; styles: number };
  generatedAt: string;
  tweak: string | null;
};

export type PostStatus = "awaiting_owner" | "approved" | "published" | "held" | "rejected" | "rejected_by_agent";

export type RoundSummary = {
  round: number;
  decision: ReviewDecision;
  score: number;
  feedback: string;
  changes?: string;
  guardrail: string | null;
};

export type Post = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  platform: Platform;
  plan: PlanItem;
  draft: Draft;
  review: Review;
  rounds: RoundSummary[];
  runId?: string;
  strategySummary?: string;
  status: PostStatus;
  scheduledFor: string;
  scheduledLocal: string;
  image?: Graphic;
  ownerEdited?: boolean;
  approvedAt?: string;
  publishedAt?: string;
  publishTarget?: string;
  externalUrl?: string | null;
  heldReason?: string;
  rejectedReason?: string;
};

export type LaneRound = {
  round: number;
  draft?: Draft;
  writerTrace?: TraceStep[];
  review?: Review;
  reviewerTrace?: TraceStep[];
};

export type LaneState = "writing" | "reviewing" | "designing" | "done" | "error";
export type Lane = {
  index: number;
  plan: PlanItem;
  state: LaneState;
  rounds: LaneRound[];
  postId?: string;
  graphicUrl?: string;
  error?: string;
  updatedAt: string;
};

export type RunStatus = "planning" | "running" | "done" | "error";
export type RunMeta = {
  id: string;
  goal: string;
  count: number;
  status: RunStatus;
  createdAt: string;
  summary?: string;
  strategistTrace?: TraceStep[];
  mode?: "live" | "offline";
  laneCount?: number;
  error?: string;
};

export type AutomationStep = { step: number; name: string; detail: string; errors?: string[] };
export type AutomationRun = {
  trigger: string;
  startedAt: string;
  finishedAt: string;
  steps: AutomationStep[];
  published: number;
  held: number;
};

export type Notification = { message: string; kind: "success" | "warning"; postIds: string[]; at?: string };
