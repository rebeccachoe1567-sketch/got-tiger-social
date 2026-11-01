// Designer step: turns a post's graphic concept into a finished, post-ready image.
// Uses Google's image model through the Netlify AI Gateway (no API key of our own).
// The model is given the shop's real logo and four of its real Instagram posts as references.
import { GoogleGenAI, type Part } from "@google/genai";
import { getStore } from "@netlify/blobs";
import type { MenuItem, Profile } from "./defaults.mts";
import type { Graphic, Post } from "./types.mts";

const ASPECT: Record<string, string> = { Instagram: "4:5", Facebook: "4:5", TikTok: "9:16", Bluesky: "1:1" };
const LOGO = "/brand/logo-ref.jpg";
// Two style references per post keep the request under the free plan's size limit.
function itemsOf(post: Post, profile: Profile): MenuItem[] {
  return (post.plan?.menu_items ?? []).map((n) => profile.menu.find((m) => m.name === n)).filter((m): m is MenuItem => !!m);
}

function styleRefsFor(items: MenuItem[]) {
  const cats = items.map((m) => m.category);
  if (cats.includes("K-Dog")) return ["/brand/style-volcano.jpg", "/brand/style-ghost.jpg"];
  if (cats.some((c) => c === "Slush" || c === "Lemonade" || c === "Soda")) return ["/brand/style-ghost.jpg", "/brand/style-coconut.jpg"];
  return ["/brand/style-coconut.jpg", "/brand/style-fall.jpg"];
}

function imageModels() {
  return [Netlify.env.get("IMAGE_MODEL"), "gemini-2.5-flash-image", "gemini-2.5-flash-image-preview"].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );
}

export function imageAvailable() {
  return !!(Netlify.env.get("GEMINI_API_KEY") || Netlify.env.get("GOOGLE_GEMINI_BASE_URL")) && Netlify.env.get("FORCE_OFFLINE") !== "1";
}

async function loadRef(origin: string, path: string): Promise<Part | null> {
  try {
    const r = await fetch(origin + path);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { inlineData: { mimeType: path.endsWith(".png") ? "image/png" : "image/jpeg", data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

export function buildImagePrompt(post: Post, profile: Profile, opts: { tweak?: string; hasLogo: boolean; styleCount: number }) {
  const items = itemsOf(post, profile);
  const itemLines = items.map((m) => `${m.name} (${m.category}): ${m.description || m.tags.join(", ")}`);
  const isDrink = items.length ? items.some((m) => m.category !== "K-Dog") : false;
  const headline = (post.draft?.headline || "").trim();
  const tagline = (post.draft?.tagline || "").trim();
  const refNote = [
    opts.hasLogo ? `- REFERENCE IMAGE 1 is the shop's real logo (round orange badge with the tiger mascot).` : "",
    opts.styleCount ? `- The next ${opts.styleCount} REFERENCE IMAGES are real posts from the shop's Instagram. They define the style you must match.` : "",
  ].filter(Boolean).join("\n");

  return `You are the graphic designer for "${profile.name}", a family-owned Korean corn dog (K-Dog) and boba shop in the Denver area. Create ONE finished ${post.platform} post graphic.

${refNote}

MATCH THE SHOP'S POSTER STYLE (from the reference posts):
- Hyper-real, cinematic food-advertising poster with dramatic lighting and rich, saturated color.
- A bold themed backdrop that fits the concept: e.g. neon city at night, swirling sauce or syrup macro, glowing lava, autumn scene with Korean hanok architecture. Pick what fits THIS post.
- Layered, designed typography like the references: one big stylized HEADLINE whose lettering matches the theme (drippy slime, brush/graffiti, elegant serif, calligraphy brush), plus a smaller tagline line. Optionally 1–2 tiny side callouts of 2–4 flavor words.
- A small "Got Tiger" wordmark with "K-DOG • BOBA" underneath, near the top or bottom.
- Use the references only for style and typography. Do NOT copy their scenes, characters, monsters or wording.
- If a reference already shows this same product, make a clearly DIFFERENT composition: new camera angle, new backdrop, new headline placement. The post must not look like a repost.

THE HERO PRODUCT (large, sharp, appetizing, drawn accurately):
${itemLines.length ? itemLines.join("\n") : "A signature menu item from the shop."}
K-Dogs are a batter-coated sausage or mozzarella on a wooden stick, deep-fried, with the coating described above. Boba drinks are in a clear plastic cup with a sealed lid and a wide straw, with visible pearls or jelly.

${opts.hasLogo ? `LOGO: Reproduce the logo from REFERENCE IMAGE 1 faithfully: same round orange badge, tiger mascot and lettering. Do not redesign, recolor or misspell it. ${isDrink ? "Place it as a round sticker label on the front of the cup, like the reference posts." : "Place it as a small round badge in a corner (or as a sticker on a boba cup if one appears)."}` : "Do not draw any logo or mascot."}

CONCEPT: ${post.draft?.visual_idea || post.plan?.angle || ""}
${opts.tweak ? `OWNER'S REQUESTED CHANGES (follow these): ${opts.tweak}\n` : ""}
TEXT ON THE IMAGE (spell exactly):
${headline ? `- Headline: "${headline}"\n` : ""}${tagline ? `- Tagline: "${tagline}"\n` : ""}- Wordmark: "Got Tiger" / "K-DOG • BOBA"

RULES: No prices, dates, URLs, phone numbers, discounts or health claims. No people or faces. No other brand names. Keep all text and the logo away from the outer 6% so nothing gets cropped.`;
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export async function generateGraphic(post: Post, profile: Profile, origin: string, tweak?: string): Promise<Graphic> {
  const ai = new GoogleGenAI({});
  const items = itemsOf(post, profile);
  const [logo, ...styles] = await Promise.all([loadRef(origin, LOGO), ...styleRefsFor(items).map((p) => loadRef(origin, p))]);
  const styleRefs = styles.filter((s): s is Part => !!s);
  const prompt = buildImagePrompt(post, profile, { tweak, hasLogo: !!logo, styleCount: styleRefs.length });
  const parts: Part[] = [{ text: prompt }];
  if (logo) parts.push(logo);
  parts.push(...styleRefs);

  let lastErr: unknown;
  for (const model of imageModels()) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: ASPECT[post.platform] || "4:5" } },
      });
      const out = res.candidates?.[0]?.content?.parts || [];
      const img = out.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
      if (!img?.inlineData?.data) throw new Error("The image model returned no image");
      const bytes = Buffer.from(img.inlineData.data, "base64");
      const version = Date.now().toString(36);
      await getStore({ name: "got-tiger-images", consistency: "strong" }).set(`${post.id}`, new Blob([bytes]), {
        metadata: { contentType: img.inlineData.mimeType, version },
      });
      return {
        url: `/api/images/${post.id}?v=${version}`,
        model,
        aspect: ASPECT[post.platform] || "4:5",
        references: { logo: !!logo, styles: styleRefs.length },
        generatedAt: new Date().toISOString(),
        tweak: tweak || null,
      };
    } catch (e) {
      lastErr = e;
      const msg = message(e);
      if (/not found|404|not supported|unknown model/i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(lastErr ? message(lastErr) : "No image model available");
}

export async function getGraphic(id: string) {
  return await getStore({ name: "got-tiger-images", consistency: "strong" }).getWithMetadata(id, { type: "arrayBuffer" });
}
