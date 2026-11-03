// The Publishing Automation. Separate from the agents: no AI decisions here.
// Trigger: every 15 minutes (schedule), or when the owner approves a post with "publish now" (event).
// Steps: 1) collect due posts  2) final safety gate  3) publish  4) log + notify owner.
import { finalGate, fullText } from "./checks.mts";
import { addNotification, addRun, claim, getPost, getProfile, listPosts, release, savePost, setMeta } from "./store.mts";
import { prettyLocal } from "./time.mts";
import { errorRef } from "./validate.mts";
import type { AutomationRun, AutomationStep, Post } from "./types.mts";

type Facet = { index: { byteStart: number; byteEnd: number }; features: { $type: string; tag: string }[] };

async function publishToBluesky(text: string) {
  const handle = Netlify.env.get("BLUESKY_HANDLE");
  const password = Netlify.env.get("BLUESKY_APP_PASSWORD");
  if (!handle || !password) return null;
  const s = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!s.ok) {
    console.error("Bluesky login failed", s.status, (await s.text()).slice(0, 500));
    throw new Error(`Bluesky sign-in failed (status ${s.status})`);
  }
  const session = (await s.json()) as { accessJwt: string; did: string; handle?: string };
  // Make hashtags clickable with facets (byte offsets).
  const enc = new TextEncoder();
  const facets: Facet[] = [];
  for (const m of text.matchAll(/#[\p{L}\p{N}_]+/gu)) {
    const start = enc.encode(text.slice(0, m.index)).length;
    facets.push({
      index: { byteStart: start, byteEnd: start + enc.encode(m[0]).length },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[0].slice(1) }],
    });
  }
  const r = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: { $type: "app.bsky.feed.post", text, facets, createdAt: new Date().toISOString() },
    }),
  });
  if (!r.ok) {
    // Keep Bluesky's response in the server log only; it is never stored on the post.
    console.error("Bluesky post failed", r.status, (await r.text()).slice(0, 500));
    throw new Error(`Bluesky rejected the post (status ${r.status})`);
  }
  const out = (await r.json()) as { uri: string };
  const rkey = out.uri.split("/").pop();
  return `https://bsky.app/profile/${session.handle || handle}/post/${rkey}`;
}

async function notifyWebhook(message: string) {
  const url = Netlify.env.get("NOTIFY_WEBHOOK_URL");
  if (!url) return false;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Works for Discord ("content") and Slack ("text") incoming webhooks.
      body: JSON.stringify({ content: message, text: message }),
    });
    return true;
  } catch {
    return false;
  }
}

const LOCK = "automation-lock";

export async function runPublishingAutomation(trigger: string): Promise<AutomationRun> {
  const startedAt = new Date();
  // Only one automation run at a time (the 15-minute schedule and a "publish now" click can overlap).
  if (!(await claim(LOCK, 2 * 60 * 1000))) {
    return {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      steps: [{ step: 1, name: "Collect due posts", detail: "Another automation run is in progress; due posts will be published by that run or the next one." }],
      published: 0,
      held: 0,
    };
  }
  try {
    return await runLocked(trigger, startedAt);
  } finally {
    await release(LOCK);
  }
}

async function runLocked(trigger: string, startedAt: Date): Promise<AutomationRun> {
  const profile = await getProfile();
  const steps: AutomationStep[] = [];

  // STEP 1: Collect: approved posts whose scheduled time has arrived.
  const posts = await listPosts();
  const due = posts.filter((p) => p.status === "approved" && new Date(p.scheduledFor).getTime() <= Date.now());
  const upcoming = posts.filter((p) => p.status === "approved" && new Date(p.scheduledFor).getTime() > Date.now());
  steps.push({ step: 1, name: "Collect due posts", detail: `${due.length} due now, ${upcoming.length} scheduled later` });

  // STEP 2: Safety gate: re-run deterministic checks (the owner may have edited the text).
  const ready: Post[] = [];
  const held: Post[] = [];
  for (const p of due) {
    const gate = finalGate(p, profile);
    if (gate.passed) ready.push(p);
    else {
      p.status = "held";
      p.heldReason = gate.blocking.map((b) => b.problem).join(" ");
      await savePost(p);
      held.push(p);
    }
  }
  steps.push({ step: 2, name: "Final safety check", detail: `${ready.length} passed, ${held.length} held for owner` });

  // STEP 3: Publish: Bluesky goes live if connected; other platforms go to the Got Tiger feed (simulated).
  const published: Post[] = [];
  const failed: Post[] = [];
  for (const candidate of ready) {
    // Each post can be published once: claim it, then re-read it in case it changed meanwhile.
    if (!(await claim(`publish:${candidate.id}`, 365 * 86400000))) continue;
    const p = await getPost(candidate.id);
    if (!p || p.status !== "approved") continue;
    const text = fullText(p.draft.caption, p.draft.hashtags);
    try {
      let url: string | null = null;
      if (p.platform === "Bluesky") url = await publishToBluesky(text);
      p.status = "published";
      p.publishedAt = new Date().toISOString();
      p.externalUrl = url;
      p.publishTarget = url ? "Bluesky (live)" : `${p.platform} (simulated feed)`;
      await savePost(p);
      published.push(p);
    } catch (e) {
      const ref = errorRef();
      console.error(`[${ref}] publish ${p.id}`, e);
      p.status = "held";
      p.heldReason = `Publishing to ${p.platform} failed (ref ${ref}). Check the account, then approve again.`;
      await savePost(p);
      failed.push(p);
    }
  }
  steps.push({
    step: 3,
    name: "Publish",
    detail: published.length ? published.map((p) => p.publishTarget).join("; ") : "Nothing to publish",
    errors: failed.map((p) => p.heldReason ?? "Unknown publishing error"),
  });

  // STEP 4: Log + notify the owner.
  let notified = "no notification needed";
  if (published.length || held.length || failed.length) {
    const parts = [];
    if (published.length) parts.push(`✅ ${published.length} post(s) went live: ${published.map((p) => p.platform).join(", ")}`);
    if (held.length + failed.length) parts.push(`⚠️ ${held.length + failed.length} post(s) held for your review`);
    const next = upcoming.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
    if (next) parts.push(`Next up: ${next.platform} on ${prettyLocal(new Date(next.scheduledFor), profile.timezone)}`);
    const message = `🐯 ${profile.name} social update: ${parts.join(" · ")}`;
    await addNotification({ message, kind: held.length + failed.length ? "warning" : "success", postIds: [...published, ...held, ...failed].map((p) => p.id) });
    const hook = await notifyWebhook(message);
    notified = hook ? "owner notified in app + team chat" : "owner notified in app";
  }
  steps.push({ step: 4, name: "Log & notify owner", detail: notified });

  const run: AutomationRun = { trigger, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), steps, published: published.length, held: held.length + failed.length };
  await setMeta("lastRun", run);
  // Keep the log readable: record runs that did something, or were started by a person/event.
  if (published.length || held.length || failed.length || trigger !== "schedule") await addRun(run);
  return run;
}
