// Posts: list, create (after the agents finish), approve / reject / edit / delete.
import type { Config, Context } from "@netlify/functions";
import { runPublishingAutomation } from "../lib/automation.mts";
import { generateGraphic, imageAvailable } from "../lib/designer.mts";
import { deletePost, getPost, getProfile, listPosts, savePost } from "../lib/store.mts";
import { localToUtc, utcToLocal } from "../lib/time.mts";

export default async (req: Request, context: Context) => {
  const { id, action } = context.params;
  const method = req.method;

  if (!id && method === "GET") return Response.json(await listPosts());

  if (!id && method === "POST") {
    const body = await req.json();
    const post = {
      id: crypto.randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      platform: body.plan.platform,
      plan: body.plan,
      draft: body.draft,
      review: body.review,
      rounds: body.rounds || [],
      batchId: body.batchId,
      strategySummary: body.strategySummary,
      status: body.review?.decision === "reject" ? "rejected_by_agent" : "awaiting_owner",
      scheduledFor: body.plan.publish_at,
      scheduledLocal: body.plan.publish_at_local,
    };
    return Response.json(await savePost(post), { status: 201 });
  }

  const post: any = id ? await getPost(id) : null;
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });

  if (method === "DELETE") {
    await deletePost(id);
    return Response.json({ ok: true });
  }

  const body = await req.json().catch(() => ({}));
  const profile = await getProfile();

  if (action === "graphic") {
    if (!imageAvailable()) return Response.json({ error: "Image generation isn't available here (it runs on the live Netlify site)." }, { status: 503 });
    try {
      if (body.headline !== undefined) post.draft.headline = String(body.headline);
      post.image = await generateGraphic(post, profile, body.tweak);
      return Response.json({ post: await savePost(post) });
    } catch (e: any) {
      console.error("graphic", e);
      return Response.json({ error: `Designer failed: ${e?.message || e}` }, { status: 500 });
    }
  }
  if (body.caption !== undefined) post.draft.caption = String(body.caption);
  if (body.hashtags !== undefined) post.draft.hashtags = body.hashtags;
  if (body.headline !== undefined) post.draft.headline = String(body.headline);
  if (body.caption !== undefined || body.hashtags !== undefined) post.ownerEdited = true;

  if (action === "approve") {
    const when = body.publishNow ? new Date() : localToUtc(body.scheduledLocal || post.scheduledLocal, profile.timezone);
    post.scheduledFor = when.toISOString();
    post.scheduledLocal = utcToLocal(when, profile.timezone);
    post.status = "approved";
    post.approvedAt = new Date().toISOString();
    delete post.heldReason;
    await savePost(post);
    // Event trigger: "publish now" fires the automation immediately.
    if (body.publishNow) {
      const run = await runPublishingAutomation("event: owner approved with publish now");
      return Response.json({ post: await getPost(id), run });
    }
    return Response.json({ post });
  }
  if (action === "reject") {
    post.status = "rejected";
    post.rejectedReason = body.reason || "";
    return Response.json({ post: await savePost(post) });
  }
  return Response.json({ post: await savePost(post) });
};

export const config: Config = { path: ["/api/posts", "/api/posts/:id", "/api/posts/:id/:action"] };
