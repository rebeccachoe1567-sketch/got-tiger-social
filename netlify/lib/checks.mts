// Deterministic safety checks. Used by the Brand Reviewer agent as tools,
// and again by the publishing automation as a final gate (no AI involved).
import { PLATFORM_RULES, type Profile } from "./defaults.mts";

export type Issue = { severity: "low" | "medium" | "high"; problem: string };

export function fullText(caption: string, hashtags: string[] = []) {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return tags ? `${caption.trim()}\n\n${tags}` : caption.trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");
const pricesOf = (m: any): number[] => [m.price, ...(m.sizes || []).map((x: any) => x.price)].filter((p) => p > 0);
const fmt = (p: number) => `$${p.toFixed(2)}`;

export function verifyMenuClaims(text: string, profile: Profile) {
  const issues: Issue[] = [];
  const t = norm(text);
  const found = profile.menu.filter((m) => t.includes(norm(m.name)));
  // If "Coconut Brown Sugar" is mentioned, don't also treat it as a mention of a shorter overlapping name.
  const mentioned = found.filter((m) => !found.some((n) => n !== m && n.name.length > m.name.length && norm(n.name).includes(norm(m.name))));
  const promoText = norm(profile.promotions.join(" | "));

  // Prices: every $ amount must exist on the menu or in an active promotion.
  const priceRe = /\$\s?(\d+(?:\.\d{1,2})?)/g;
  const prices = [...text.matchAll(priceRe)].map((m) => Number(m[1]));
  for (const p of prices) {
    const onMenu = profile.menu.some((m) => pricesOf(m).some((q) => Math.abs(q - p) < 0.005));
    const inPromo = promoText.includes(String(p));
    if (!onMenu && !inPromo) issues.push({ severity: "high", problem: `Price $${p.toFixed(2)} does not match any menu item or active promotion.` });
  }
  // Item-specific price: "<item> ... $x" within 40 chars must match that item.
  for (const m of mentioned) {
    const idx = t.indexOf(norm(m.name));
    const window = text.slice(idx, idx + m.name.length + 40);
    const pm = window.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
    const valid = pricesOf(m);
    if (pm && !valid.length) {
      issues.push({ severity: "high", problem: `No price is on file for ${m.name}, so the post must not state one (${fmt(Number(pm[1]))}).` });
    } else if (pm && !valid.some((q) => Math.abs(q - Number(pm[1])) < 0.005)) {
      issues.push({ severity: "high", problem: `${m.name} is listed at ${fmt(Number(pm[1]))} but the menu says ${valid.map(fmt).join(" / ")}.` });
    }
  }

  // Promotions: deal language must match an active promotion.
  const dealRe = /(\d+\s?%\s?off|bogo|buy one|free\b|half off|discount|coupon|deal\b|sale\b)/gi;
  const deals = [...new Set([...text.matchAll(dealRe)].map((m) => m[1].toLowerCase()))];
  for (const d of deals) {
    const pct = d.match(/(\d+)\s?%/);
    const ok = pct ? promoText.includes(`${pct[1]}%`) : promoText.length > 0 && (promoText.includes(d) || ["discount", "deal", "sale"].includes(d));
    if (!ok) issues.push({ severity: "high", problem: `Mentions "${d}" but no matching promotion is active. Active: ${profile.promotions.join("; ") || "none"}.` });
  }

  return {
    menu_items_mentioned: mentioned.map((m) => (pricesOf(m).length ? `${m.name} (${pricesOf(m).map(fmt).join(" / ")})` : m.name)),
    prices_found: prices.map((p) => `$${p.toFixed(2)}`),
    deal_language_found: deals,
    full_menu: profile.menu.map((m) => m.name),
    issues,
    passed: !issues.some((i) => i.severity === "high"),
  };
}

const emojiRe = /\p{Extended_Pictographic}/gu;

export function checkBrandRules(caption: string, hashtags: string[], platform: string, profile: Profile) {
  const issues: Issue[] = [];
  const rules = PLATFORM_RULES[platform] || PLATFORM_RULES.Instagram;
  const text = fullText(caption, hashtags);
  const lower = norm(text);
  for (const b of profile.banned_phrases) {
    if (b && lower.includes(norm(b))) issues.push({ severity: "high", problem: `Uses banned phrase "${b}".` });
  }
  const length = [...text].length;
  if (length > rules.max_chars) issues.push({ severity: "high", problem: `${length} characters; ${platform} limit is ${rules.max_chars}.` });
  const [minTags, maxTags] = rules.hashtags;
  if (hashtags.length > maxTags) issues.push({ severity: "medium", problem: `${hashtags.length} hashtags; ${platform} should use at most ${maxTags}.` });
  if (hashtags.length < minTags) issues.push({ severity: "low", problem: `${hashtags.length} hashtags; ${platform} works best with at least ${minTags}.` });
  const emojis = (caption.match(emojiRe) || []).length;
  if (emojis > 4) issues.push({ severity: "low", problem: `${emojis} emojis; brand voice allows at most 4.` });
  const shouty = (caption.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !["BOGO", "TIGER"].includes(w));
  if (shouty.length > 1) issues.push({ severity: "low", problem: `ALL-CAPS words (${shouty.join(", ")}) feel pushy.` });
  if ((caption.match(/!/g) || []).length > 3) issues.push({ severity: "low", problem: "More than 3 exclamation marks." });
  return {
    platform,
    character_count: length,
    limit: rules.max_chars,
    hashtag_count: hashtags.length,
    emoji_count: emojis,
    issues,
    passed: !issues.some((i) => i.severity === "high"),
  };
}

function words(s: string) {
  return new Set(norm(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));
}

export function similarity(a: string, b: string) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function checkDuplicates(caption: string, recent: any[]) {
  const scored = recent
    .filter((p) => p.draft?.caption)
    .map((p) => ({ id: p.id, platform: p.platform, sim: similarity(caption, p.draft.caption), caption: p.draft.caption.slice(0, 80) }))
    .sort((a, b) => b.sim - a.sim);
  const top = scored[0];
  const issues: Issue[] =
    top && top.sim > 0.45
      ? [{ severity: "high", problem: `Too similar (${Math.round(top.sim * 100)}%) to a post that already exists (${top.platform}): "${top.caption}…" Write a new hook and new wording.` }]
      : top && top.sim > 0.3
        ? [{ severity: "medium", problem: `Somewhat similar (${Math.round(top.sim * 100)}%) to an existing post: "${top.caption}…"` }]
        : [];
  return { most_similar: top ? { ...top, similarity: Math.round(top.sim * 100) + "%" } : null, issues };
}

/** Final automated gate used by the publishing automation. */
export function finalGate(post: any, profile: Profile) {
  const caption = post.draft?.caption || "";
  const tags = post.draft?.hashtags || [];
  const text = fullText(caption, tags) + (post.draft?.headline ? `\n${post.draft.headline}` : "") + (post.draft?.tagline ? `\n${post.draft.tagline}` : "");
  const issues = [...verifyMenuClaims(text, profile).issues, ...checkBrandRules(caption, tags, post.platform, profile).issues];
  if (post.platform !== "Bluesky" && !post.image?.url) issues.push({ severity: "high", problem: `${post.platform} posts need a graphic. Generate one before publishing.` });
  const blocking = issues.filter((i) => i.severity === "high");
  return { passed: blocking.length === 0, blocking, issues };
}
