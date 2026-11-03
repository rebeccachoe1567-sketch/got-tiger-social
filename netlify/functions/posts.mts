// GET    /api/posts                  -> list posts (read-only)
// PATCH  /api/posts/:id              -> edit caption/hashtags/headline (owner)
// POST   /api/posts/:id/approve      -> approve and schedule, or publish now (owner)
// POST   /api/posts/:id/reject       -> reject (owner)
// POST   /api/posts/:id/graphic      -> (re)generate the graphic (owner)
// DELETE /api/posts/:id              -> delete (owner)
// Posts are only CREATED by the server-side pipeline, never from the browser.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { isOwner, requireOwner } from "../lib/auth.mts";
import { runPublishingAutomation } from "../lib/automation.mts";
import { generateGraphic, imageAvailable } from "../lib/designer.mts";
import { MAX_GRAPHICS_PER_DAY } from "../lib/pipeline.mts";
import { deletePost, getPost, getProfile, listPosts, release, savePost, useQuota } from "../lib/store.mts";
import { localToUtc, utcToLocal } from "../lib/time.mts";
import type { Post } from "../lib/types.mts";
import { ApproveBody, errorRef, GraphicBody, parseBody, PostEditBody, RejectBody } from "../lib/validate.mts";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

function applyEdits(post: Post, body: z.infer<typeof PostEditBody>) {
  if (body.caption !== undefined) post.draft.caption = body.caption;
  if (body.hashtags !== undefined) post.draft.hashtags = body.hashtags.map((h) => h.replace(/^#/, ""));
  if (body.headline !== undefined) post.draft.headline = body.headline;
  if (body.tagline !== undefined) post.draft.tagline = body.tagline;
  if (body.caption !== undefined || body.hashtags !== undefined) post.ownerEdited = true;
}

export default async (req: Request, context: Context) => {
  const { id, action } = context.params;
  if (req.method === "GET" && !id) {
    // Newest 60 posts. Visitors get a copy cached at Netlify's edge for 20 seconds, so repeated
    // requests can't force heavy reads; the signed-in owner always gets fresh data.
    const owner = await isOwner(context);
    const headers: Record<string, string> = owner
      ? { "cache-control": "no-store" }
      : { "cache-control": "public, max-age=0, must-revalidate", "netlify-cdn-cache-control": "public, s-maxage=20, stale-while-revalidate=60", "netlify-vary": "cookie=gt_session" };
    return Response.json(await listPosts(60), { headers });
  }

  const denied = await requireOwner(context);
  if (denied) return denied;
  if (!id || !/^[a-z0-9]{6,20}$/.test(id)) return notFound();
  const post = await getPost(id);
  if (!post) return notFound();

  if (req.method === "DELETE" && !action) {
    await deletePost(id);
    return Response.json({ ok: true });
  }

  if (req.method === "PATCH" && !action) {
    const body = await parseBody(req, PostEditBody);
    if ("error" in body) return body.error;
    applyEdits(post, body.data);
    return Response.json({ post: await savePost(post) });
  }

  if (req.method !== "POST") return notFound();
  const profile = await getProfile();

  if (action === "graphic") {
    if (!imageAvailable()) return Response.json({ error: "Image generation isn't available here (it runs on the live Netlify site)." }, { status: 503 });
    const body = await parseBody(req, GraphicBody);
    if ("error" in body) return body.error;
    if (body.data.headline !== undefined) post.draft.headline = body.data.headline;
    if (body.data.tagline !== undefined) post.draft.tagline = body.data.tagline;
    if (!(await useQuota("graphics", MAX_GRAPHICS_PER_DAY()))) {
      return Response.json({ error: `Daily graphic limit reached (${MAX_GRAPHICS_PER_DAY()}). It resets at midnight UTC.` }, { status: 429 });
    }
    try {
      post.image = await generateGraphic(post, profile, new URL(req.url).origin, body.data.tweak || undefined);
      return Response.json({ post: await savePost(post) });
    } catch (e) {
      const ref = errorRef();
      console.error(`[${ref}] graphic`, e);
      return Response.json({ error: `The graphic couldn't be created (ref ${ref}). Try again in a minute.` }, { status: 500 });
    }
  }

  if (action === "approve") {
    const body = await parseBody(req, ApproveBody);
    if ("error" in body) return body.error;
    applyEdits(post, body.data);
    const when = body.data.publishNow ? new Date() : localToUtc(body.data.scheduledLocal ?? post.scheduledLocal, profile.timezone);
    if (isNaN(when.getTime())) return Response.json({ error: "Invalid date." }, { status: 400 });
    post.scheduledFor = when.toISOString();
    post.scheduledLocal = utcToLocal(when, profile.timezone);
    if (post.status === "published") return Response.json({ error: "This post is already published." }, { status: 409 });
    if (post.status === "held") await release(`publish:${post.id}`); // the owner chose to try again
    post.status = "approved";
    post.approvedAt = new Date().toISOString();
    delete post.heldReason;
    await savePost(post);
    // Event trigger: "publish now" fires the automation immediately.
    if (body.data.publishNow) {
      const run = await runPublishingAutomation("event: owner approved with publish now");
      return Response.json({ post: await getPost(id), run });
    }
    return Response.json({ post });
  }

  if (action === "reject") {
    const body = await parseBody(req, RejectBody);
    if ("error" in body) return body.error;
    applyEdits(post, body.data);
    post.status = "rejected";
    post.rejectedReason = body.data.reason ?? "";
    return Response.json({ post: await savePost(post) });
  }

  return notFound();
};

export const config: Config = { path: ["/api/posts", "/api/posts/:id", "/api/posts/:id/:action"] };
