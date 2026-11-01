// The three AI agents: Strategist -> Writer -> Brand Reviewer.
// Each one is an LLM tool-use loop: it decides which tools to call, in what order,
// and when it has enough information to submit a decision. Every agent's final answer
// is validated with zod before the server uses it.
import { z } from "zod";
import { PLATFORM_RULES, type MenuItem, type Profile } from "./defaults.mts";
import { getCalendar, getPostingInsights, getWeather, type Weather } from "./context.mts";
import { checkBrandRules, checkDuplicates, fullText, verifyMenuClaims, type CaptionLike } from "./checks.mts";
import { llmMode, runAgent, tool, type AgentTool } from "./llm.mts";
import { localToUtc, utcToLocal, weekday } from "./time.mts";
import { PLATFORMS, type Draft, type Issue, type PlanItem, type Platform, type Post, type Review, type TraceStep } from "./types.mts";

/** The owner asked for no em dashes anywhere; AI text is cleaned before it is stored. */
export function noEmDash(s: string) {
  return s.replace(/\s*\u2014\s*/g, ", ").replace(/\s+\u2013\s+/g, ", ").replace(/,\s*,/g, ",");
}
const NO_DASH_RULE = "Never use em dashes (\u2014) or en dashes between words. Use commas, periods or colons instead.";

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function recentSummary(posts: Post[]) {
  return posts
    .filter((p) => ["awaiting_owner", "approved", "published"].includes(p.status))
    .slice(0, 15)
    .map((p) => ({
      platform: p.platform,
      status: p.status,
      when: p.scheduledLocal || p.plan?.publish_at_local,
      menu_items: p.plan?.menu_items ?? [],
      angle: p.plan?.angle,
      caption_start: p.draft?.caption?.slice(0, 90),
    }));
}
type RecentPost = ReturnType<typeof recentSummary>[number];

const menuForAgent = (items: MenuItem[]) => items.map((m) => ({ ...m, price: m.price ? m.price : "not on file" }));

// ---------------------------------------------------------------- STRATEGIST
const PlanSchema = z.object({
  summary: z.string().default(""),
  posts: z
    .array(
      z.object({
        platform: z.string(),
        publish_at_local: z.string().default(""),
        menu_items: z.array(z.string()).default([]),
        angle: z.string().default(""),
        goal: z.string().default("promote_item"),
        format: z.string().default("photo"),
        reasoning: z.string().default(""),
      }),
    )
    .default([]),
});
type RawPlan = z.infer<typeof PlanSchema>;

export type StrategistResult = { summary: string; posts: PlanItem[]; trace: TraceStep[]; model: string; mode: "live" | "offline" };

export async function runStrategist(input: { goal?: string; count: number }, profile: Profile, posts: Post[]): Promise<StrategistResult> {
  const count = Math.min(Math.max(input.count || 3, 1), 5);
  const platforms = profile.platforms?.length ? profile.platforms : PLATFORMS;
  let weatherCache: Weather | undefined;
  const weather = async () => (weatherCache ??= await getWeather(profile));

  const tools: AgentTool[] = [
    tool({
      name: "get_business_profile",
      description: "Business basics: location, hours, audience, slow times, active promotions.",
      run: () => ({
        name: profile.name,
        former_name: profile.former_name,
        tagline: profile.tagline,
        instagram: profile.instagram,
        locations: profile.locations,
        city: profile.city,
        hours: profile.hours,
        audience: profile.audience,
        slow_times: profile.slow_times,
        promotions: profile.promotions,
        platforms,
      }),
      summarize: (o) => `${o.name} · ${o.city} · slow: ${o.slow_times}`,
    }),
    tool({
      name: "get_menu",
      description: "Full menu with prices and tags (bestseller, spicy, new, seasonal...). Price 'not on file' means never mention a price.",
      run: () => menuForAgent(profile.menu),
      summarize: (o) => `${o.length} menu items loaded`,
    }),
    tool({
      name: "get_weather_forecast",
      description: "7-day live weather forecast for the shop's city. Use it to match drinks/food to the weather.",
      run: weather,
      summarize: (o) => ("unavailable" in o ? "Weather unavailable" : o.days.slice(0, 4).map((d) => `${d.weekday.slice(0, 3)} ${d.high_f}°F ${d.conditions}`).join(" · ")),
    }),
    tool({
      name: "get_calendar",
      description: "Today's date/time and the next 10 days with holidays and local events.",
      run: () => getCalendar(profile),
      summarize: (o) => {
        const n = o.days.filter((d) => d.notable.length).map((d) => `${d.date.slice(5)} ${d.notable[0]}`);
        return `Today ${o.today}${n.length ? " · " + n.slice(0, 3).join(" · ") : " · no holidays soon"}`;
      },
    }),
    tool({
      name: "get_posting_insights",
      description: "When each audience is online, platform audiences, and scheduling rules of thumb.",
      run: () => getPostingInsights(profile),
      summarize: () => "Engagement windows + platform audiences loaded",
    }),
    tool({
      name: "get_recent_posts",
      description: "Posts already planned or published, so you avoid repeating items or angles.",
      run: () => recentSummary(posts),
      summarize: (o) => (o.length ? `${o.length} recent posts to avoid repeating` : "No recent posts yet"),
    }),
  ];

  const finalTool = tool({
    name: "submit_content_plan",
    description: `Submit the final content plan with exactly ${count} posts.`,
    input_schema: {
      type: "object",
      required: ["summary", "posts"],
      properties: {
        summary: { type: "string", description: "1-2 sentences: the overall strategy and why." },
        posts: {
          type: "array",
          items: {
            type: "object",
            required: ["platform", "publish_at_local", "menu_items", "angle", "goal", "format", "reasoning"],
            properties: {
              platform: { type: "string", enum: platforms },
              publish_at_local: { type: "string", description: "Local time 'YYYY-MM-DD HH:mm', in the future, within 7 days, during or just before business hours." },
              menu_items: { type: "array", items: { type: "string" }, description: "Exact menu item names." },
              angle: { type: "string", description: "The creative hook in one sentence." },
              goal: { type: "string", enum: ["drive_traffic", "promote_item", "fill_slow_period", "engagement", "event_tie_in", "brand_story"] },
              format: { type: "string", enum: ["photo", "carousel", "short_video", "text"] },
              reasoning: { type: "string", description: "Why this item, platform and time. Cite the data you used (weather, calendar, slow times, recent posts)." },
            },
          },
        },
      },
    },
    run: () => null,
  });

  const system = `You are the Content Strategist agent for ${profile.name} (${profile.tagline}), a family-owned Korean corn dog (K-Dog) and boba shop at ${profile.locations || profile.city}.
Your job: decide WHAT to post, on WHICH platform, and WHEN, for the next week.
Work like a real strategist: look up the data you need with your tools (calendar, weather, menu, posting insights, recent posts) before deciding.
Decision rules:
- Every post must have a distinct menu focus or angle; don't repeat items that were posted recently.
- Use real context: weather (iced vs hot), holidays/events, and slow periods that need traffic.
- Spread posts across different days and platforms that fit the audience.
- Only use exact menu item names from get_menu. Only reference promotions that are active.
- Respect item tags: skip anything tagged as a past seasonal special unless the owner's goal asks for it; favor "new" and "limited time" items.
${NO_DASH_RULE}
Before each tool call, write one short sentence about what you're checking and why.`;

  const userMessage = `Plan ${count} social media posts for the next 7 days.${input.goal ? ` The owner's goal this week: "${input.goal}".` : ""}`;

  if (llmMode() === "live") {
    const r = await runAgent<unknown>({ system, userMessage, tools, finalTool, maxTurns: 9 });
    return { ...normalizePlan(PlanSchema.parse(r.result), profile, count), trace: r.trace, model: r.model, mode: "live" };
  }
  return offlineStrategist(profile, count, tools);
}

function normalizePlan(plan: RawPlan, profile: Profile, count: number) {
  const tz = profile.timezone;
  const now = Date.now();
  // Map near-misses ("Cotton Candy Electric Slush Boba") to the real menu item name.
  const byLength = [...profile.menu].sort((a, b) => b.name.length - a.name.length);
  const toMenuName = (raw: string) => {
    const r = raw.toLowerCase();
    const hit = profile.menu.find((m) => m.name.toLowerCase() === r) ?? byLength.find((m) => r.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(r));
    return hit?.name ?? null;
  };
  const posts: PlanItem[] = plan.posts.slice(0, count).map((p, i) => {
    let when = localToUtc(p.publish_at_local, tz);
    if (isNaN(when.getTime()) || when.getTime() < now + 10 * 60000 || when.getTime() > now + 8 * 86400000) when = new Date(now + (i + 1) * 86400000);
    const platform: Platform = (PLATFORMS as string[]).includes(p.platform) ? (p.platform as Platform) : "Instagram";
    return {
      platform,
      publish_at_local: utcToLocal(when, tz),
      publish_at: when.toISOString(),
      weekday: weekday(when, tz),
      menu_items: [...new Set(p.menu_items.map(toMenuName).filter((n): n is string => !!n))],
      angle: noEmDash(p.angle),
      goal: p.goal,
      format: p.format,
      reasoning: noEmDash(p.reasoning),
    };
  });
  return { summary: noEmDash(plan.summary), posts };
}

async function offlineStrategist(profile: Profile, count: number, tools: AgentTool[]): Promise<StrategistResult> {
  const trace: TraceStep[] = [{ type: "thought", text: "Offline demo mode: following a scripted strategy instead of an LLM." }];
  const call = async (name: string) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`Missing tool ${name}`);
    const out = await t.run({});
    trace.push({ type: "tool", tool: name, input: {}, summary: t.summarize ? t.summarize(out, {}) : "" });
    return out;
  };
  const weather = (await call("get_weather_forecast")) as Weather;
  await call("get_calendar");
  await call("get_menu");
  const recent = (await call("get_recent_posts")) as RecentPost[];
  const used = new Set(recent.flatMap((r) => r.menu_items));
  const warm = !("unavailable" in weather) && (weather.days[1]?.high_f ?? 0) >= 70;
  const fresh = [...profile.menu]
    .sort((a, b) => Number(used.has(a.name)) - Number(used.has(b.name)))
    .filter((m) => m.category !== "Add-on" && !m.tags.some((t) => /halloween|seasonal special/i.test(t)));
  const chosen = new Set<string>();
  const pick = (cat: string, pref?: string): MenuItem => {
    const m =
      fresh.find((x) => x.category === cat && (!pref || x.tags.includes(pref)) && !used.has(x.name) && !chosen.has(x.name)) ??
      fresh.find((x) => x.category === cat && !chosen.has(x.name)) ??
      fresh.find((x) => !chosen.has(x.name)) ??
      fresh[0];
    chosen.add(m.name);
    return m;
  };
  const choices = [pick("K-Dog", "new"), pick("Boba", warm ? "iced" : "bestseller"), pick("K-Dog", "cheese pull"), pick("Boba"), pick("K-Dog")];
  const plats = (["Instagram", "TikTok", "Facebook", "Bluesky", "Instagram"] as Platform[]).filter((p) => profile.platforms.includes(p));
  const times = ["11:15", "15:00", "18:30", "11:30", "19:00"];
  const plan: RawPlan = {
    summary: `Lead with the newest K-Dog, follow with a ${warm ? "cool-down" : "cozy fall"} boba post, then a classic K-Dog to keep the feed varied.`,
    posts: choices.slice(0, count).map((m, i) => ({
      platform: plats[i % plats.length],
      publish_at_local: `${utcToLocal(new Date(Date.now() + (i + 1) * 86400000), profile.timezone).slice(0, 10)} ${times[i]}`,
      menu_items: [m.name],
      angle: `Spotlight the ${m.name}`,
      goal: m.tags.includes("new") ? "promote_item" : i === 2 ? "fill_slow_period" : "engagement",
      format: i === 1 ? "short_video" : "photo",
      reasoning: `Not posted recently; ${m.tags.join(", ")}.`,
    })),
  };
  trace.push({ type: "final", tool: "submit_content_plan" });
  return { ...normalizePlan(plan, profile, count), trace, model: "offline-script", mode: "offline" };
}

// ---------------------------------------------------------------- WRITER
const DraftSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
  headline: z.string().optional(),
  tagline: z.string().optional(),
  visual_idea: z.string().default(""),
  call_to_action: z.string().optional(),
  changes_made: z.string().optional(),
});

export type WriterResult = { draft: Draft; trace: TraceStep[]; model: string; mode: "live" | "offline" };

export async function runWriter(input: { plan: PlanItem; previous?: Draft; feedback?: string }, profile: Profile): Promise<WriterResult> {
  const { plan } = input;
  const rulesFor = (p: unknown) => PLATFORM_RULES[str(p)] ?? PLATFORM_RULES.Instagram;
  const tools: AgentTool[] = [
    tool({
      name: "get_brand_voice",
      description: "Brand voice, real example captions from the shop's Instagram, hashtag bank, audience, banned phrases and active promotions.",
      run: () => ({
        voice: profile.voice,
        former_name: profile.former_name,
        example_posts: profile.example_posts,
        hashtag_bank: profile.hashtags,
        audience: profile.audience,
        banned_phrases: profile.banned_phrases,
        active_promotions: profile.promotions,
        locations: profile.locations,
        hours: profile.hours,
      }),
      summarize: () => "Brand voice + banned phrases loaded",
    }),
    tool({
      name: "get_platform_rules",
      description: "Length limits, hashtag ranges and format tips for a platform.",
      input_schema: { type: "object", properties: { platform: { type: "string" } }, required: ["platform"] },
      run: (i) => rulesFor(i.platform),
      summarize: (o, i) => `${str(i.platform, "Instagram")}: max ${o.max_chars} chars, ${o.hashtags[0]} to ${o.hashtags[1]} hashtags`,
    }),
    tool({
      name: "get_menu_details",
      description: "Exact names, prices, sizes, descriptions and tags for menu items.",
      input_schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } } },
      run: (i) => {
        const want = strList(i.items).map((s) => s.toLowerCase());
        const found = profile.menu.filter((m) => !want.length || want.some((w) => m.name.toLowerCase().includes(w) || w.includes(m.name.toLowerCase())));
        const addOns = profile.menu.filter((m) => m.category === "Add-on" && !found.includes(m));
        return menuForAgent([...(found.length ? found : profile.menu), ...addOns]);
      },
      summarize: (o) => o.slice(0, 3).map((m) => (typeof m.price === "number" ? `${m.name} $${m.price}` : `${m.name} (no price on file)`)).join(", "),
    }),
    tool({
      name: "check_draft",
      description: "Self-check a draft against brand rules, platform limits and menu facts before submitting.",
      input_schema: { type: "object", required: ["caption", "hashtags"], properties: { caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } } },
      run: (i) => {
        const caption = str(i.caption);
        const hashtags = strList(i.hashtags);
        const b = checkBrandRules(caption, hashtags, plan.platform, profile);
        const m = verifyMenuClaims(fullText(caption, hashtags), profile);
        return { character_count: b.character_count, limit: b.limit, issues: [...b.issues, ...m.issues], passed: b.passed && m.passed };
      },
      summarize: (o) => (o.issues.length ? `${o.issues.length} issue(s): ${o.issues[0].problem}` : `Passed (${o.character_count}/${o.limit} chars)`),
    }),
  ];

  const finalTool = tool({
    name: "submit_draft",
    description: "Submit the finished post.",
    input_schema: {
      type: "object",
      required: ["caption", "hashtags", "headline", "visual_idea", "call_to_action"],
      properties: {
        caption: { type: "string", description: "Post text WITHOUT hashtags." },
        headline: { type: "string", description: "2 to 5 word headline printed big on the graphic, like the shop's posters (e.g. 'GHOST CHARGE', 'BROWN SUGAR BOBA', 'VOLCANO HEAT'). No prices or deals." },
        tagline: { type: "string", description: "Short second line on the graphic, 2 to 6 words (e.g. 'Taste the season', 'Green Apple Energy Slush', 'with buldak mayo'). No prices or deals." },
        hashtags: { type: "array", items: { type: "string" }, description: "Hashtags without the # sign." },
        visual_idea: { type: "string", description: "The graphic or video concept in Got Tiger's style: a dramatic or seasonal scene with the drink or K-Dog as the large hero (and which flavor/color it is). One or two sentences. Don't describe logos; the real logo is added separately." },
        call_to_action: { type: "string" },
        changes_made: { type: "string", description: "If revising: what you changed in response to feedback." },
      },
    },
    run: () => null,
  });

  const system = `You are the Copywriter agent for ${profile.name} (${profile.tagline}), a family-owned K-Dog and boba shop at ${profile.locations || profile.city}.
You turn a strategist's plan into a ready-to-post caption for one platform, in the SAME style as the shop's real example posts (get_brand_voice): a short punchy hook, one sensory line, a few matching emojis.
The example posts are already published: match their style, but write a NEW hook and NEW wording. Never reuse their sentences or hooks.
Pick hashtags mostly from the hashtag bank. Call corn dogs "K-Dogs".
The shop is "${profile.name}". Its former name (${profile.former_name || "none"}) may still show on cups or signs; don't treat it as an error.
Process: load the brand voice and platform rules, get exact menu details, write a draft, run check_draft, fix any issues, then submit.
Never invent menu items, prices, hours or promotions. Only mention a price if get_menu_details shows one, and then exactly that price (sizes and "with Potato" versions have their own prices). Never make allergen or diet claims (K-Dogs contain egg, milk and wheat).
${NO_DASH_RULE}
Before each tool call, write one short sentence about what you're doing.`;

  const userMessage =
    `Plan:\n${JSON.stringify({ platform: plan.platform, publish_at_local: plan.publish_at_local, weekday: plan.weekday, menu_items: plan.menu_items, angle: plan.angle, goal: plan.goal, format: plan.format }, null, 1)}` +
    (input.previous ? `\n\nYour previous draft:\n${JSON.stringify(input.previous)}\n\nBrand Reviewer feedback you MUST address:\n${input.feedback ?? ""}` : "");

  if (llmMode() === "live") {
    const r = await runAgent<unknown>({ system, userMessage, tools, finalTool, maxTurns: 7 });
    return { draft: cleanDraft(DraftSchema.parse(r.result)), trace: r.trace, model: r.model, mode: "live" };
  }
  // Offline scripted writer
  const trace: TraceStep[] = [{ type: "thought", text: "Offline demo mode: using a caption template." }];
  const item = profile.menu.find((m) => plan.menu_items.includes(m.name)) ?? profile.menu[0];
  const drink = item.category !== "K-Dog";
  const e = drink ? "🧋" : "🔥";
  const lines: Record<Platform, string> = {
    Instagram: drink ? `Your ${plan.weekday} needs this. ${e} ${item.name}: smooth, sweet and made to order. Come say hi!` : `Think you can handle the crunch? ${e} ${item.name}, fried fresh and loaded with flavor. Come grab one!`,
    TikTok: drink ? `Watch the swirl ${e} ${item.name} at ${profile.name}.` : `Listen to that crunch ${e} ${item.name} at ${profile.name}.`,
    Facebook: `${item.name} is waiting for you at ${profile.name} ${e} Made fresh by our family at ${profile.locations || profile.city}.`,
    Bluesky: `${plan.weekday} plans: ${item.name} at ${profile.name} ${e} Made fresh, made with love.`,
  };
  const draft = cleanDraft({
    caption: input.previous ? lines[plan.platform].replace("!", ".") : lines[plan.platform],
    headline: item.name.split(/ with /i)[0].toUpperCase(),
    hashtags: plan.platform === "Bluesky" ? ["denverfoodie"] : (profile.hashtags?.length ? profile.hashtags : ["denverfoodie", "boba"]).slice(0, plan.platform === "Facebook" ? 2 : 5),
    visual_idea: `Bold poster: "${item.name.toUpperCase()}" in big headline letters, the ${drink ? "cup" : "K-Dog"} as the hero, dramatic ${drink ? "cozy fall" : "fiery"} background.`,
    call_to_action: "Visit today",
    changes_made: input.previous ? "Toned down punctuation per reviewer." : undefined,
  });
  trace.push({ type: "tool", tool: "check_draft", input: {}, summary: "Template checked" }, { type: "final", tool: "submit_draft" });
  return { draft, trace, model: "offline-script", mode: "offline" };
}

function cleanDraft(d: z.infer<typeof DraftSchema>): Draft {
  return {
    ...d,
    caption: noEmDash(d.caption.trim()),
    headline: d.headline ? noEmDash(d.headline.trim()) : undefined,
    tagline: d.tagline ? noEmDash(d.tagline.trim()) : undefined,
    visual_idea: noEmDash(d.visual_idea),
    hashtags: d.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean),
  };
}

// ---------------------------------------------------------------- BRAND REVIEWER
const IssueSchema = z.object({ severity: z.enum(["low", "medium", "high"]).catch("medium"), problem: z.string().default("") });
const ReviewSchema = z.object({
  decision: z.enum(["approve", "revise", "reject"]).catch("revise"),
  score: z.coerce.number().min(1).max(10).catch(5),
  issues: z.array(IssueSchema).catch([]),
  feedback_for_writer: z.string().catch(""),
  owner_should_check: z.string().catch(""),
});

export type ReviewerResult = { review: Review; trace: TraceStep[]; model: string; mode: "live" | "offline" };

export async function runReviewer(input: { plan: PlanItem; draft: Draft }, profile: Profile, posts: Post[]): Promise<ReviewerResult> {
  const { plan, draft } = input;
  const text = fullText(draft.caption, draft.hashtags) + (draft.headline ? `\n${draft.headline}` : "") + (draft.tagline ? `\n${draft.tagline}` : "");
  const others: CaptionLike[] = [
    ...posts.filter((p) => p.draft?.caption && p.draft.caption !== draft.caption).map((p) => ({ id: p.id, platform: p.platform, caption: p.draft.caption })),
    ...(profile.example_posts || []).map((c, i) => ({ id: `instagram-${i}`, platform: "Instagram (already posted)", caption: c })),
  ];

  const tools: AgentTool[] = [
    tool({
      name: "verify_menu_claims",
      description: "Deterministically checks every price, menu item and promotion claim in the post against the real menu and active promotions.",
      run: () => verifyMenuClaims(text, profile),
      summarize: (o) => (o.issues.length ? `✗ ${o.issues[0].problem}` : `✓ Menu facts OK (${o.menu_items_mentioned.join(", ") || "no prices"})`),
    }),
    tool({
      name: "check_brand_rules",
      description: "Checks banned phrases, platform length limit, hashtag count, emoji count and pushy tone markers.",
      run: () => checkBrandRules(draft.caption, draft.hashtags, plan.platform, profile),
      summarize: (o) => (o.issues.length ? `${o.issues.length} issue(s): ${o.issues[0].problem}` : `✓ Brand rules OK (${o.character_count}/${o.limit} chars)`),
    }),
    tool({
      name: "check_against_recent_posts",
      description: "Finds the most similar existing post (including captions already on the shop's Instagram) to catch repeated or copied content.",
      run: () => checkDuplicates(draft.caption, others),
      summarize: (o) => (o.issues.length ? `⚠ ${o.issues[0].problem.slice(0, 90)}` : `✓ Original (closest match ${o.most_similar?.similarity ?? "0%"})`),
    }),
    tool({
      name: "get_brand_voice",
      description: "The owner's brand voice guidelines.",
      run: () => ({ voice: profile.voice, audience: profile.audience, promotions: profile.promotions }),
      summarize: () => "Brand voice loaded",
    }),
  ];

  const finalTool = tool({
    name: "submit_review",
    description: "Submit your decision.",
    input_schema: {
      type: "object",
      required: ["decision", "score", "issues", "feedback_for_writer", "owner_should_check"],
      properties: {
        decision: { type: "string", enum: ["approve", "revise", "reject"] },
        score: { type: "integer", minimum: 1, maximum: 10 },
        issues: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["low", "medium", "high"] }, problem: { type: "string" } } } },
        feedback_for_writer: { type: "string", description: "Specific instructions if decision is revise; empty if approve." },
        owner_should_check: { type: "string", description: "One thing the human owner should double-check before approving (e.g., graphic ready, promo still running)." },
      },
    },
    run: () => null,
  });

  const system = `You are the Brand Reviewer agent for ${profile.name}. You protect the family business's reputation.
Review one draft post. ALWAYS run verify_menu_claims and check_brand_rules; also check against recent posts and the brand voice.
Decide:
- approve: accurate, on-brand, fits the platform, score >= 7, no high-severity issues.
- revise: fixable problems (wrong price, too long, off-tone, repetitive, weak hook). Give precise feedback.
- reject: fundamentally inappropriate or misleading, not worth fixing.
Also judge things the tools can't: is it on-brand, does the hook work, does it mention items that aren't on the menu, is a promotion valid for the posting day (${plan.weekday})?
${NO_DASH_RULE}
Before each tool call, write one short sentence about what you're checking.`;

  const userMessage = `Platform: ${plan.platform}\nScheduled: ${plan.weekday} ${plan.publish_at_local}\nPlan angle: ${plan.angle}\n\nDraft caption:\n${fullText(draft.caption, draft.hashtags)}\n\nHeadline on the graphic: ${draft.headline || "(none)"}\nTagline on the graphic: ${draft.tagline || "(none)"}\nVisual idea: ${draft.visual_idea}`;

  let review: Review;
  let trace: TraceStep[];
  let model: string;
  let mode: "live" | "offline";
  if (llmMode() === "live") {
    const r = await runAgent<unknown>({ system, userMessage, tools, finalTool, maxTurns: 7 });
    const parsed = ReviewSchema.parse(r.result);
    review = { ...parsed, feedback_for_writer: noEmDash(parsed.feedback_for_writer), owner_should_check: noEmDash(parsed.owner_should_check) };
    trace = r.trace;
    model = r.model;
    mode = "live";
  } else {
    trace = [{ type: "thought", text: "Offline demo mode: rule-based review." }];
    const issues: Issue[] = [];
    for (const t of tools.slice(0, 3)) {
      const o = (await t.run({})) as { issues: Issue[] };
      issues.push(...o.issues);
      trace.push({ type: "tool", tool: t.name, input: {}, summary: t.summarize ? t.summarize(o, {}) : "" });
    }
    const high = issues.some((i) => i.severity === "high");
    review = {
      decision: high ? "revise" : "approve",
      score: high ? 4 : Math.max(6, 9 - issues.length),
      issues,
      feedback_for_writer: high ? issues.map((i) => i.problem).join(" ") : "",
      owner_should_check: "Make sure the graphic for this post is ready before approving.",
    };
    trace.push({ type: "final", tool: "submit_review" });
    model = "offline-script";
    mode = "offline";
  }

  // Guardrail: the AI may not approve a post that fails the deterministic fact checks.
  const hard = [
    ...verifyMenuClaims(text, profile).issues,
    ...checkBrandRules(draft.caption, draft.hashtags, plan.platform, profile).issues,
    ...checkDuplicates(draft.caption, others).issues,
  ].filter((i) => i.severity === "high");
  if (review.decision === "approve" && hard.length) {
    review.decision = "revise";
    review.guardrail_override = `Automatic checks found ${hard.length} blocking issue(s), so the approval was overridden.`;
    review.feedback_for_writer = [review.feedback_for_writer, ...hard.map((h) => h.problem)].filter(Boolean).join(" ");
    review.issues = [...review.issues, ...hard];
    trace.push({ type: "thought", text: "Guardrail: a blocking fact or brand issue was found, so the approval was overridden to revise." });
  }
  return { review, trace, model, mode };
}
