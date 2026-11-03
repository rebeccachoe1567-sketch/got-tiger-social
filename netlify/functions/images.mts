// GET /api/images/:id -> the generated graphic for a post (add ?download=1 to save it)
// Only PNG, JPEG and WebP are ever served, checked from the file's bytes.
import type { Config, Context } from "@netlify/functions";
import { getGraphic, sniffImage } from "../lib/designer.mts";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export default async (req: Request, context: Context) => {
  const id = context.params.id;
  if (!id || !/^[a-z0-9]{6,20}$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const r = await getGraphic(id);
    if (!r?.data) return new Response("Not found", { status: 404 });
    const type = sniffImage(Buffer.from(r.data));
    if (!type) return new Response("Not found", { status: 404 });
    const download = new URL(req.url).searchParams.has("download");
    return new Response(r.data, {
      headers: {
        "content-type": type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "public, max-age=31536000, immutable",
        ...(download ? { "content-disposition": `attachment; filename="got-tiger-post-${id}.${EXT[type]}"` } : {}),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

export const config: Config = { path: "/api/images/:id" };
