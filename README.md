# 🐯 Got Tiger Social Studio

An AI social media team for **Got Tiger** (K-Dog · Boba · Good Vibes, [@got_tiger_k.dog.boba](https://www.instagram.com/got_tiger_k.dog.boba/)), a family-owned Korean corn dog & boba shop in the Denver area.
Built for the AI Club / CU Boulder Applied AI Development Program capstone.

**User:** the owner of a small family restaurant.
**Problem:** posting consistently takes hours every week, so it doesn't happen, and slow afternoons stay slow.
**Product:** three AI agents plan, write and fact-check a week of posts; the owner approves them in about two minutes; an automation publishes them on schedule.

## How it works

```
Owner goal ──► 1. Strategist agent ──► 2. Writer agent ⇄ 3. Brand Reviewer agent ──► Owner approval ──► Publishing automation
               weather, holidays,      brand voice,        verifies prices, promos,    (human in        every 15 min or "publish now":
               menu, slow hours,       platform rules,     tone, length, repetition;   the loop)        collect due → safety gate →
               past posts → decides    self-check          approve / revise / reject                    publish → log & notify owner
               item, platform, time
```

### AI agents (3)
Each agent is an LLM tool-use loop (`netlify/lib/llm.mts`). It decides which tools to call and when it has enough information to submit a decision.

| Agent | Tools it can call | Decision it makes |
|---|---|---|
| **Strategist** | `get_business_profile`, `get_menu`, `get_weather_forecast` (live Open-Meteo), `get_calendar`, `get_posting_insights`, `get_recent_posts` | What to post, on which platform, at what time, and why |
| **Writer** | `get_brand_voice`, `get_platform_rules`, `get_menu_details`, `check_draft` | The caption, hashtags and a photo/video idea, revised from reviewer feedback |
| **Brand Reviewer** | `verify_menu_claims`, `check_brand_rules`, `check_against_recent_posts`, `get_brand_voice` | Approve, revise (sends it back to the Writer, up to 2 rounds) or reject |

**Guardrail:** if the deterministic checks find a wrong price, an inactive promotion or a banned phrase, the code overrides an AI "approve" to "revise".

### Automation (1)
`netlify/lib/automation.mts`, separate from the agents, with no AI decisions.
- **Triggers:** a schedule (every 15 minutes, `netlify/functions/publish-scheduled.mts`) **or** an event (the owner clicks "Approve & publish now").
- **Steps:** 1) collect approved posts that are due, 2) run the final safety check again (the owner may have edited the text), 3) publish (Bluesky live if connected; Instagram, TikTok and Facebook go to a simulated feed), 4) log the run and notify the owner (in-app inbox, plus an optional Discord/Slack webhook).

## Tech
- Netlify static site + Netlify Functions (TypeScript)
- Netlify AI Gateway → Anthropic Claude (no API key needed; it uses Netlify credits)
- Netlify Blobs for storage
- Netlify Scheduled Functions for the automation

## Optional environment variables (Netlify → Project configuration → Environment variables)
| Variable | Purpose |
|---|---|
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | Publish Bluesky posts for real (use an app password from Bluesky settings) |
| `NOTIFY_WEBHOOK_URL` | Also send owner notifications to a Discord or Slack channel |
| `AGENT_MODEL` | Override the Claude model (default `claude-haiku-4-5`) |
| `FORCE_OFFLINE=1` | Backup demo mode with scripted agents (no AI calls) |

## Where it can fail and how much to trust it
- **Invented facts** (prices, deals): caught by code checks twice. These checks are only as accurate as the business profile.
- **Tone or cultural misstep:** the owner reviews every post.
- **Photo mismatch:** the post describes a photo the owner still has to take.
- **API outage:** the post is held and the owner is notified.

**Trust level:** high for planning and fact-checking, medium for the writing itself, low for posting with no human review. The system does about 90% of the work, and the owner keeps the final 10%: approval.
