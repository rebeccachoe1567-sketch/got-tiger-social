import { getStore } from "@netlify/blobs";
import { DEFAULT_PROFILE, type Profile } from "./defaults.mts";
import type { AutomationRun, Lane, Notification, Post, RunMeta } from "./types.mts";

// Minimal interface of the Blobs store we use, so a local in-memory store can stand in for it.
type JsonStore = {
  get(key: string, opts: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
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
  async setJSON(k, v) {
    mem.set(k, JSON.stringify(v));
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

export async function getProfile(): Promise<Profile> {
  const p = await getJSON<Partial<Profile>>("profile");
  return p ? { ...DEFAULT_PROFILE, ...p } : DEFAULT_PROFILE;
}
export async function saveProfile(p: Profile) {
  await store().setJSON("profile", p);
}

export async function listPosts(): Promise<Post[]> {
  const s = store();
  const { blobs } = await s.list({ prefix: "posts/" });
  const posts = await Promise.all(blobs.map((b) => getJSON<Post>(b.key)));
  return posts.filter((p): p is Post => !!p).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export const getPost = (id: string) => getJSON<Post>(`posts/${id}`);
export async function savePost(post: Post) {
  post.updatedAt = new Date().toISOString();
  await store().setJSON(`posts/${post.id}`, post);
  return post;
}
export async function deletePost(id: string) {
  await store().delete(`posts/${id}`);
}

// Pipeline runs: one record for the run, one per lane (so parallel lanes never overwrite each other).
export const getRun = (id: string) => getJSON<RunMeta>(`runs-meta/${id}`);
export async function saveRun(run: RunMeta) {
  await store().setJSON(`runs-meta/${run.id}`, run);
}
export const getLane = (runId: string, i: number) => getJSON<Lane>(`runs-lane/${runId}/${i}`);
export async function saveLane(runId: string, lane: Lane) {
  lane.updatedAt = new Date().toISOString();
  await store().setJSON(`runs-lane/${runId}/${lane.index}`, lane);
}
export async function listLanes(runId: string, count: number) {
  const lanes = await Promise.all(Array.from({ length: count }, (_, i) => getLane(runId, i)));
  return lanes.filter((l): l is Lane => !!l);
}

async function listRecent<T>(prefix: string, limit: number): Promise<T[]> {
  const { blobs } = await store().list({ prefix });
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, limit);
  return (await Promise.all(keys.map((k) => getJSON<T>(k)))).filter((x): x is Awaited<T> & T => !!x);
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export async function addRun(run: AutomationRun) {
  await store().setJSON(`automation-runs/${stamp()}`, run);
}
export const listRuns = (limit = 20) => listRecent<AutomationRun>("automation-runs/", limit);

export async function addNotification(n: Notification) {
  await store().setJSON(`notes/${stamp()}`, { ...n, at: new Date().toISOString() });
}
export const listNotifications = (limit = 30) => listRecent<Notification>("notes/", limit);

export async function setMeta(key: string, value: unknown) {
  await store().setJSON(`meta/${key}`, value);
}
export const getMeta = <T,>(key: string) => getJSON<T>(`meta/${key}`);

export async function resetDemo() {
  const s = store();
  const { blobs } = await s.list();
  await Promise.all(blobs.filter((b) => b.key !== "profile").map((b) => s.delete(b.key)));
}
