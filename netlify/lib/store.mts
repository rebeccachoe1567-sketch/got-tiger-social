import { getStore } from "@netlify/blobs";
import { DEFAULT_PROFILE, type Profile } from "./defaults.mts";

// LOCAL_DEV=1 uses an in-memory store so the app can be tested without Netlify.
const mem = new Map<string, string>();
const localStore: any = {
  async get(k: string, o?: any) { const v = mem.get(k); return v == null ? null : o?.type === "json" ? JSON.parse(v) : v; },
  async setJSON(k: string, v: any) { mem.set(k, JSON.stringify(v)); },
  async delete(k: string) { mem.delete(k); },
  async list(o?: any) { return { blobs: [...mem.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).map((key) => ({ key })) }; },
};
const store = () => (Netlify.env.get("LOCAL_DEV") === "1" ? localStore : getStore({ name: "got-tiger", consistency: "strong" }));

export async function getProfile(): Promise<Profile> {
  const p = (await store().get("profile", { type: "json" })) as Profile | null;
  return p ? { ...DEFAULT_PROFILE, ...p } : DEFAULT_PROFILE;
}

export async function saveProfile(p: Profile) {
  await store().setJSON("profile", p);
}

export async function listPosts(): Promise<any[]> {
  const s = store();
  const { blobs } = await s.list({ prefix: "posts/" });
  const posts = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return posts.filter(Boolean).sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function getPost(id: string) {
  return await store().get(`posts/${id}`, { type: "json" });
}

export async function savePost(post: any) {
  post.updatedAt = new Date().toISOString();
  await store().setJSON(`posts/${post.id}`, post);
  return post;
}

export async function deletePost(id: string) {
  await store().delete(`posts/${id}`);
}

async function listRecent(prefix: string, limit: number) {
  const s = store();
  const { blobs } = await s.list({ prefix });
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, limit);
  return (await Promise.all(keys.map((k) => s.get(k, { type: "json" })))).filter(Boolean);
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export async function addRun(run: any) {
  await store().setJSON(`runs/${stamp()}`, run);
}
export const listRuns = (limit = 20) => listRecent("runs/", limit);

export async function addNotification(n: any) {
  await store().setJSON(`notes/${stamp()}`, { ...n, at: new Date().toISOString() });
}
export const listNotifications = (limit = 30) => listRecent("notes/", limit);

export async function setMeta(key: string, value: any) {
  await store().setJSON(`meta/${key}`, value);
}
export async function getMeta(key: string) {
  return await store().get(`meta/${key}`, { type: "json" });
}

export async function resetDemo() {
  const s = store();
  const { blobs } = await s.list();
  await Promise.all(blobs.filter((b) => b.key !== "profile").map((b) => s.delete(b.key)));
}
