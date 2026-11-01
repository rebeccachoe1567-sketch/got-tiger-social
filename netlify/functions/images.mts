// GET /api/images/:id -> the generated graphic for a post (add ?download=1 to save it)
import type { Config, Context } from "@netlify/functions";
import { getGraphic } from "../lib/designer.mts";

export default async (req: Request, context: Context) => {
  const id = context.params.id;
  if (!id || !/^[a-z0-9]{6,20}$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const r = await getGraphic(id);
    if (!r?.data) return new Response("Not found", { status: 404 });
    const type = typeof r.metadata?.contentType === "string" ? r.metadata.contentType : "image/png";
    const download = new URL(req.url).searchParams.has("download");
    return new Response(r.data, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=31536000, immutable",
        ...(download ? { "content-disposition": `attachment; filename="got-tiger-post-${id}.${type.split("/")[1] || "png"}"` } : {}),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

export const config: Config = { path: "/api/images/:id" };
