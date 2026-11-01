// Designer step: turns a post's graphic concept into a finished, post-ready image.
// Uses Google's image model through the Netlify AI Gateway (no API key of our own).
import { GoogleGenAI } from "@google/genai";
import { getStore } from "@netlify/blobs";
import type { Profile } from "./defaults.mts";

const ASPECT: Record<string, string> = { Instagram: "4:5", Facebook: "4:5", TikTok: "9:16", Bluesky: "1:1" };

function imageModels() {
  return [Netlify.env.get("IMAGE_MODEL"), "gemini-2.5-flash-image", "gemini-2.5-flash-image-preview"].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );
}

export function imageAvailable() {
  return !!(Netlify.env.get("GEMINI_API_KEY") || Netlify.env.get("GOOGLE_GEMINI_BASE_URL")) && Netlify.env.get("FORCE_OFFLINE") !== "1";
}

export function buildImagePrompt(post: any, profile: Profile, tweak?: string) {
  const items = (post.plan?.menu_items || [])
    .map((n: string) => profile.menu.find((m) => m.name === n))
    .filter(Boolean)
    .map((m: any) => `${m.name} (${m.category}): ${m.description || m.tags.join(", ")}`);
  const headline = (post.draft?.headline || "").trim();
  return `Design a finished, scroll-stopping ${post.platform} food advertisement poster for "${profile.name}", a Korean corn dog (K-Dog) and boba shop in the Denver area.

STYLE (match the shop's existing feed): bold, cinematic, hyper-real food-ad poster. Dramatic lighting, rich saturated color, a themed or seasonal backdrop, glossy condensation and texture, energetic composition. Looks like a professional social ad, not a stock photo.

HERO PRODUCT (draw it accurately, it is the main subject, large and in focus):
${items.length ? items.join("\n") : "A signature menu item from the shop."}
Korean corn dogs are a batter-coated sausage or mozzarella on a wooden stick, deep-fried, with the coating described above. Boba drinks are in a clear plastic cup with a sealed lid and a wide straw, with visible tapioca pearls.

CONCEPT: ${post.draft?.visual_idea || post.plan?.angle || ""}
${tweak ? `OWNER'S REQUESTED CHANGES: ${tweak}\n` : ""}
TEXT ON THE IMAGE (spell exactly, nothing else):
${headline ? `- Big stylized headline: "${headline}"\n` : ""}- Small brand line near the top: "GOT TIGER" with "K-DOG • BOBA" underneath

RULES:
- No prices, dates, phone numbers, URLs, discount claims or any other words.
- Do not draw any logo, mascot, badge or emblem on the cup or anywhere else (the owner adds the real logo).
- No people or faces. No other brand names.
- Keep important content away from the outer 6% so nothing gets cropped.`;
}

export async function generateGraphic(post: any, profile: Profile, tweak?: string) {
  const ai = new GoogleGenAI({});
  const prompt = buildImagePrompt(post, profile, tweak);
  let lastErr: any;
  for (const model of imageModels()) {
    try {
      const res: any = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: ASPECT[post.platform] || "4:5" } } as any,
      });
      const parts = res.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
      if (!img?.inlineData?.data) throw new Error("The image model returned no image");
      const bytes = Buffer.from(img.inlineData.data, "base64");
      const version = Date.now().toString(36);
      await getStore({ name: "got-tiger-images", consistency: "strong" }).set(`${post.id}`, new Blob([bytes]), {
        metadata: { contentType: img.inlineData.mimeType, version },
      });
      return { url: `/api/images/${post.id}?v=${version}`, model, prompt, aspect: ASPECT[post.platform] || "4:5", generatedAt: new Date().toISOString(), tweak: tweak || null };
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (/not found|404|not supported|unknown model/i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr || new Error("No image model available");
}

export async function getGraphic(id: string) {
  return await getStore({ name: "got-tiger-images", consistency: "strong" }).getWithMetadata(id, { type: "arrayBuffer" });
}
