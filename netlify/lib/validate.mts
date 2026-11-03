// Request validation. Every body the server accepts is parsed with one of these schemas.
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

export const StartRunBody = z.object({
  goal: text(300).default(""),
  count: z.coerce.number().int().min(1).max(5).default(3),
});

export const LoginBody = z.object({ password: z.string().min(1).max(256) });

const Hashtags = z.array(text(60).regex(/^#?[\p{L}\p{N}_]+$/u, "Hashtags can only contain letters, numbers and _")).max(30);

export const PostEditBody = z.object({
  caption: text(2200).optional(),
  hashtags: Hashtags.optional(),
  headline: text(60).optional(),
  tagline: text(80).optional(),
});

export const ApproveBody = PostEditBody.extend({
  publishNow: z.boolean().optional(),
  scheduledLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, "Use the date picker to choose a time")
    .optional(),
});

export const RejectBody = PostEditBody.extend({ reason: text(500).optional() });

export const GraphicBody = z.object({
  headline: text(60).optional(),
  tagline: text(80).optional(),
  tweak: text(300).optional(),
});

const MenuItemBody = z.object({
  name: text(80).min(1),
  price: z.coerce.number().min(0).max(1000).catch(0),
  category: text(40).default("Other"),
  tags: z.array(text(60)).max(12).default([]),
  sizes: z.array(z.object({ label: text(40).min(1), price: z.coerce.number().positive().max(1000) })).max(6).default([]),
  description: text(400).default(""),
});

export const ProfileBody = z.object({
  name: text(80).min(1),
  former_name: text(160).default(""),
  tagline: text(120).default(""),
  instagram: text(60).default(""),
  city: text(80).min(1),
  locations: text(200).default(""),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  timezone: text(60).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
  hours: text(200).default(""),
  audience: text(400).default(""),
  voice: text(1200).default(""),
  example_posts: z.array(text(500)).max(12).default([]),
  hashtags: z.array(text(60)).max(30).default([]),
  slow_times: text(200).default(""),
  banned_phrases: z.array(text(80)).max(60).default([]),
  promotions: z.array(text(300)).max(20).default([]),
  events: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: text(120).min(1) })).max(60).default([]),
  platforms: z.array(z.enum(["Instagram", "TikTok", "Facebook", "Bluesky"])).min(1).max(4).default(["Instagram", "TikTok", "Facebook", "Bluesky"]),
  menu: z.array(MenuItemBody).min(1).max(120),
  sample: z.boolean().default(false),
});

export const StepBody = z.object({
  runId: z.string().regex(/^[a-z0-9]{6,20}$/),
  step: z.enum(["plan", "write", "review", "design"]),
  lane: z.number().int().min(0).max(4).optional(),
  round: z.number().int().min(1).max(3).optional(),
});

/** Read a request body as text, refusing anything larger than maxBytes without reading it all. */
export async function readLimited(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Parse a JSON body with a schema; returns either the data or a 400/413 Response. */
export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S, maxBytes = 16 * 1024): Promise<{ data: z.infer<S> } | { error: Response }> {
  const t = await readLimited(req, maxBytes);
  if (t === null) return { error: Response.json({ error: "Request is too large." }, { status: 413 }) };
  let raw: unknown;
  try {
    raw = t ? JSON.parse(t) : {};
  } catch {
    return { error: Response.json({ error: "Request body must be valid JSON." }, { status: 400 }) };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return { error: Response.json({ error: `Invalid request. ${where}${first?.message ?? "Check the fields."}` }, { status: 400 }) };
  }
  return { data: r.data };
}

/** A short id to quote in logs and in generic error messages. */
export function errorRef() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
