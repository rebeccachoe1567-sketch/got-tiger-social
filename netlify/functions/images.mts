// GET /api/images/:id -> the generated graphic for a post
import type { Config, Context } from "@netlify/functions";
import { getGraphic } from "../lib/designer.mts";

export default async (req: Request, context: Context) => {
  try {
    const r: any = await getGraphic(context.params.id);
    if (!r?.data) return new Response("Not found", { status: 404 });
    const download = new URL(req.url).searchParams.has("download");
    const ext = String(r.metadata?.contentType || "image/png").split("/")[1] || "png";
    return new Response(r.data, {
      headers: {
        "content-type": r.metadata?.contentType || "image/png",
        "cache-control": "public, max-age=31536000, immutable",
        ...(download ? { "content-disposition": `attachment; filename="got-tiger-post-${context.params.id}.${ext}"` } : {}),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

export const config: Config = { path: "/api/images/:id" };
