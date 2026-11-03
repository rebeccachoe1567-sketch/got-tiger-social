// Deterministic safety checks. Used by the Brand Reviewer agent as tools,
// and again by the publishing automation as a final gate (no AI involved).
import { PLATFORM_RULES, type MenuItem, type Profile } from "./defaults.mts";
import type { Issue, Post } from "./types.mts";

export type { Issue };
export type CaptionLike = { id: string; platform: string; caption: string };

export function fullText(caption: string, hashtags: string[] = []) {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return tags ? `${caption.trim()}\n\n${tags}` : caption.trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");
const pricesOf = (m: MenuItem): number[] => [m.price, ...(m.sizes ?? []).map((x) => x.price)].filter((p) => p > 0);
const fmt = (p: number) => `$${p.toFixed(2)}`;

// Money amounts: "$5", "$ 5.25", "5.25 dollars", "5 bucks".
const MONEY_RE = /\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(?:dollars?|bucks|usd)\b/gi;
const moneyIn = (s: string) => [...s.matchAll(MONEY_RE)].map((m) => ({ value: Number(m[1] ?? m[2]), index: m.index ?? 0, length: m[0].length }));
const samePrice = (a: number, b: number) => Math.abs(a - b) < 0.005;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function verifyMenuClaims(text: string, profile: Profile) {
  const issues: Issue[] = [];
  const t = norm(text);
  const found = profile.menu.filter((m) => t.includes(norm(m.name)));
  // If "Coconut Brown Sugar" is mentioned, don't also treat it as a mention of a shorter overlapping name.
  const mentioned = found.filter((m) => !found.some((n) => n !== m && n.name.length > m.name.length && norm(n.name).includes(norm(m.name))));

  // Numbers that active promotions actually state, compared as numbers (not as text).
  const promoText = norm(profile.promotions.join(" | "));
  const promoPrices = moneyIn(promoText).map((m) => m.value);
  const promoPercents = [...promoText.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));

  // 1) Every money amount must be a real menu price or a price stated in an active promotion.
  const prices = moneyIn(t);
  for (const p of prices) {
    const onMenu = profile.menu.some((m) => pricesOf(m).some((q) => samePrice(q, p.value)));
    const inPromo = promoPrices.some((q) => samePrice(q, p.value));
    if (!onMenu && !inPromo) issues.push({ severity: "high", problem: `Price ${fmt(p.value)} does not match any menu item or active promotion.` });
  }

  // 2) A price next to an item (right after it, or just before it) must be that item's price.
  //    Every mention of every item is checked, not just the first.
  const mentions = mentioned
    .flatMap((m) => [...t.matchAll(new RegExp(escapeRe(norm(m.name)), "g"))].map((x) => ({ item: m, start: x.index ?? 0, end: (x.index ?? 0) + m.name.length })))
    .sort((a, b) => a.start - b.start);
  mentions.forEach((mention, i) => {
    const nextStart = mentions[i + 1]?.start ?? t.length;
    const after = prices.filter((p) => p.index >= mention.end && p.index < Math.min(mention.end + 40, nextStart));
    const before = prices.filter((p) => p.index + p.length <= mention.start && p.index + p.length >= mention.start - 3);
    const near = [...before, ...after];
    const valid = pricesOf(mention.item);
    for (const p of near) {
      if (!valid.length) issues.push({ severity: "high", problem: `No price is on file for ${mention.item.name}, so the post must not state one (${fmt(p.value)}).` });
      else if (!valid.some((q) => samePrice(q, p.value) || promoPrices.some((pp) => samePrice(pp, p.value))))
        issues.push({ severity: "high", problem: `${mention.item.name} is listed at ${fmt(p.value)} but the menu says ${valid.map(fmt).join(" / ")}.` });
    }
  });

  // 3) Deal language must match an active promotion.
  const dealRe = /(\d+(?:\.\d+)?\s?%\s?off|bogo|buy one|free\b|half off|discount|coupon|deal\b|sale\b)/gi;
  const deals = [...new Set([...t.matchAll(dealRe)].map((m) => m[1].toLowerCase()))];
  for (const d of deals) {
    const pct = d.match(/(\d+(?:\.\d+)?)\s?%/);
    const ok = pct
      ? promoPercents.some((q) => q === Number(pct[1]))
      : ["discount", "deal", "sale"].includes(d)
        ? profile.promotions.length > 0
        : new RegExp(`\\b${escapeRe(d)}\\b`).test(promoText);
    if (!ok) issues.push({ severity: "high", problem: `Mentions "${d}" but no matching promotion is active. Active: ${profile.promotions.join("; ") || "none"}.` });
  }

  // De-duplicate identical problems.
  const unique = issues.filter((x, i) => issues.findIndex((y) => y.problem === x.problem) === i);
  return {
    menu_items_mentioned: mentioned.map((m) => (pricesOf(m).length ? `${m.name} (${pricesOf(m).map(fmt).join(" / ")})` : m.name)),
    prices_found: prices.map((p) => fmt(p.value)),
    deal_language_found: deals,
    full_menu: profile.menu.map((m) => m.name),
    issues: unique,
    passed: !unique.some((i) => i.severity === "high"),
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

export function checkDuplicates(caption: string, recent: CaptionLike[]) {
  const scored = recent
    .filter((p) => p.caption)
    .map((p) => ({ id: p.id, platform: p.platform, sim: similarity(caption, p.caption), caption: p.caption.slice(0, 80) }))
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
export function finalGate(post: Post, profile: Profile) {
  const caption = post.draft?.caption || "";
  const tags = post.draft?.hashtags || [];
  const text = fullText(caption, tags) + (post.draft?.headline ? `\n${post.draft.headline}` : "") + (post.draft?.tagline ? `\n${post.draft.tagline}` : "");
  const issues = [...verifyMenuClaims(text, profile).issues, ...checkBrandRules(caption, tags, post.platform, profile).issues];
  if (post.platform !== "Bluesky" && !post.image?.url) issues.push({ severity: "high", problem: `${post.platform} posts need a graphic. Generate one before publishing.` });
  const blocking = issues.filter((i) => i.severity === "high");
  return { passed: blocking.length === 0, blocking, issues };
}
