import { getStore } from "@netlify/blobs";
import { DEFAULT_PROFILE, type Profile } from "./defaults.mts";
import type { AutomationRun, Lane, Notification, Post, RunMeta } from "./types.mts";

// Minimal interface of the Blobs store we use, so a local in-memory store can stand in for it.
type JsonStore = {
  get(key: string, opts: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown, opts?: { onlyIfNew?: boolean }): Promise<{ modified: boolean } | void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string }): Promise<{ blobs: { key: string }[] }>;
};

// LOCAL_DEV=1 uses an in-memory store so the app can be tested without Netlify.
const mem = new Map<string, string>();
const localStore: JsonStore = {
  async get(k) {
    const v = mem.get(k);
    return v == null ? null : JSON.parse(v);
  },
  async setJSON(k, v, o) {
    if (o?.onlyIfNew && mem.has(k)) return { modified: false };
    mem.set(k, JSON.stringify(v));
    return { modified: true };
  },
  async delete(k) {
    mem.delete(k);
  },
  async list(o) {
    return { blobs: [...mem.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).map((key) => ({ key })) };
  },
};
const store = (): JsonStore =>
  Netlify.env.get("LOCAL_DEV") === "1" ? localStore : (getStore({ name: "got-tiger", consistency: "strong" }) as unknown as JsonStore);

async function getJSON<T>(key: string): Promise<T | null> {
  return ((await store().get(key, { type: "json" })) as T | null) ?? null;
}
const putJSON = (key: string, value: unknown) => store().setJSON(key, value);

/**
 * Atomically claim a key: returns true only for the FIRST caller. Used so that a pipeline step,
 * a post creation or a publish happens once even if two requests arrive at the same time.
 * A claim older than ttlMs counts as abandoned and can be claimed again.
 */
export async function claim(key: string, ttlMs = 24 * 3600 * 1000): Promise<boolean> {
  const s = store();
  const res = await s.setJSON(`claims/${key}`, { at: Date.now() }, { onlyIfNew: true });
  if (res && res.modified) return true;
  const existing = await getJSON<{ at: number }>(`claims/${key}`);
  if (existing && Date.now() - existing.at > ttlMs) {
    await s.delete(`claims/${key}`);
    const retry = await s.setJSON(`claims/${key}`, { at: Date.now() }, { onlyIfNew: true });
    return !!(retry && retry.modified);
  }
  return false;
}
export async function release(key: string) {
  await store().delete(`claims/${key}`);
}

// ---------------------------------------------------------------- profile
export async function getProfile(): Promise<Profile> {
  const p = await getJSON<Partial<Profile>>("profile");
  return p ? { ...DEFAULT_PROFILE, ...p } : DEFAULT_PROFILE;
}
export async function saveProfile(p: Profile) {
  await putJSON("profile", p);
}

// ---------------------------------------------------------------- posts
// Each post also gets an empty "order" marker whose key sorts by creation time, so the newest
// posts can be listed without reading every post.
const orderKey = (p: Pick<Post, "id" | "createdAt">) => `post-order/${String(Date.parse(p.createdAt) || 0).padStart(14, "0")}-${p.id}`;

export const getPost = (id: string) => getJSON<Post>(`posts/${id}`);

/** Newest posts first, reading at most `limit` posts. */
export async function listPosts(limit = 60): Promise<Post[]> {
  const s = store();
  const [{ blobs: markers }, { blobs: postKeys }] = await Promise.all([s.list({ prefix: "post-order/" }), s.list({ prefix: "posts/" })]);
  const ordered = markers.map((b) => b.key).sort().reverse().map((k) => k.slice(k.lastIndexOf("-") + 1));
  const marked = new Set(ordered);
  // Posts saved before markers existed are read too (oldest data, only until they get a marker).
  const legacy = postKeys.map((b) => b.key.slice("posts/".length)).filter((id) => !marked.has(id));
  const ids = [...ordered.slice(0, limit), ...legacy].slice(0, limit + legacy.length);
  const posts = (await Promise.all(ids.map((id) => getPost(id)))).filter((p): p is Post => !!p);
  await Promise.all(posts.filter((p) => legacy.includes(p.id)).map((p) => putJSON(orderKey(p), {})));
  return posts.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, limit);
}

export async function savePost(post: Post) {
  post.updatedAt = new Date().toISOString();
  await putJSON(`posts/${post.id}`, post);
  await putJSON(orderKey(post), {});
  return post;
}
export async function deletePost(id: string) {
  const p = await getPost(id);
  await store().delete(`posts/${id}`);
  if (p) await store().delete(orderKey(p));
}

// ---------------------------------------------------------------- pipeline runs
// One record for the run, one per lane (so parallel lanes never overwrite each other).
export const getRun = (id: string) => getJSON<RunMeta>(`runs-meta/${id}`);
export async function saveRun(run: RunMeta) {
  await putJSON(`runs-meta/${run.id}`, run);
}
export const getLane = (runId: string, i: number) => getJSON<Lane>(`runs-lane/${runId}/${i}`);
export async function saveLane(runId: string, lane: Lane) {
  lane.updatedAt = new Date().toISOString();
  await putJSON(`runs-lane/${runId}/${lane.index}`, lane);
}
export async function listLanes(runId: string, count: number) {
  const lanes = await Promise.all(Array.from({ length: count }, (_, i) => getLane(runId, i)));
  return lanes.filter((l): l is Lane => !!l);
}
export async function setActiveRun(id: string | null) {
  await putJSON("meta/active-run", id ? { id, at: Date.now() } : null);
}
export const getActiveRun = () => getJSON<{ id: string; at: number }>("meta/active-run");

// ---------------------------------------------------------------- usage limits
const today = () => new Date().toISOString().slice(0, 10);
export type DailyUsage = { runs: number; graphics: number };
export async function getUsage(): Promise<DailyUsage> {
  return (await getJSON<DailyUsage>(`usage/${today()}`)) ?? { runs: 0, graphics: 0 };
}
/** Adds one to today's counter if it is still under the limit. Returns false when the limit is reached. */
export async function useQuota(kind: keyof DailyUsage, limit: number): Promise<boolean> {
  const u = await getUsage();
  if (u[kind] >= limit) return false;
  u[kind] += 1;
  await putJSON(`usage/${today()}`, u);
  return true;
}

// ---------------------------------------------------------------- sign-in records
export type Attempts = { count: number; first: number; lockedUntil?: number };
export const getAttempts = (key: string) => getJSON<Attempts>(`auth/attempts/${key}`);
export async function saveAttempts(key: string, a: Attempts | null) {
  if (a) await putJSON(`auth/attempts/${key}`, a);
  else await store().delete(`auth/attempts/${key}`);
}
export const getSession = (sid: string) => getJSON<{ exp: number; created: number }>(`auth/sessions/${sid}`);
export async function saveSession(sid: string, exp: number) {
  await putJSON(`auth/sessions/${sid}`, { exp, created: Date.now() });
}
export async function deleteSession(sid: string) {
  await store().delete(`auth/sessions/${sid}`);
}

// ---------------------------------------------------------------- automation log
async function listRecent<T>(prefix: string, limit: number): Promise<T[]> {
  const { blobs } = await store().list({ prefix });
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, limit);
  return (await Promise.all(keys.map((k) => getJSON<T>(k)))).filter((x): x is Awaited<T> & T => !!x);
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export async function addRun(run: AutomationRun) {
  await putJSON(`automation-runs/${stamp()}`, run);
}
export const listRuns = (limit = 20) => listRecent<AutomationRun>("automation-runs/", limit);

export async function addNotification(n: Notification) {
  await putJSON(`notes/${stamp()}`, { ...n, at: new Date().toISOString() });
}
export const listNotifications = (limit = 30) => listRecent<Notification>("notes/", limit);

export async function setMeta(key: string, value: unknown) {
  await putJSON(`meta/${key}`, value);
}
export const getMeta = <T,>(key: string) => getJSON<T>(`meta/${key}`);

/** Clears posts, runs and logs. Keeps the profile, sign-in records and today's usage counters. */
export async function resetDemo() {
  const s = store();
  const { blobs } = await s.list();
  const keep = (k: string) => k === "profile" || k.startsWith("auth/") || k.startsWith("usage/");
  await Promise.all(blobs.filter((b) => !keep(b.key)).map((b) => s.delete(b.key)));
}
