# 🐯 Got Tiger Social Studio

An AI social media team for **Got Tiger** (K-Dog · Boba · Good Vibes, [@got_tiger_k.dog.boba](https://www.instagram.com/got_tiger_k.dog.boba/)), a family-owned Korean corn dog and boba shop in the Denver area.
Built for the AI Club / CU Boulder Applied AI Development Program capstone.

**User:** the owner of a small family restaurant.
**Problem:** posting consistently takes hours every week, so it doesn't happen, and slow afternoons stay slow.
**Product:** three AI agents plan, write and fact-check a week of posts, a designer step makes the graphics, the owner approves them in about two minutes, and an automation publishes them on schedule.

**Live site:** https://got-tiger-social.netlify.app (anyone can view; only the signed-in owner can change anything)

## How it works

```
Owner goal -> 1. Strategist -> 2. Writer <-> 3. Brand Reviewer -> Designer -> Owner approval -> Publishing automation
              weather,         brand voice,     verifies prices,    poster      (human in       every 15 min or "publish now":
              holidays, menu,  platform rules,  promos, tone,       graphic     the loop)       collect due, safety gate,
              slow hours,      self-check       length, copies;                                 publish, log and notify owner
              past posts                        approve/revise/reject
```

### AI agents (3)
Each agent is an LLM tool-use loop (`netlify/lib/llm.mts`). It decides which tools to call and when it has enough information to submit a decision. Every final answer is validated with zod before it is used.

| Agent | Tools it can call | Decision it makes |
|---|---|---|
| **Strategist** | `get_business_profile`, `get_menu`, `get_weather_forecast` (live Open-Meteo), `get_calendar`, `get_posting_insights`, `get_recent_posts` | What to post, on which platform, at what time, and why |
| **Writer** | `get_brand_voice`, `get_platform_rules`, `get_menu_details`, `check_draft` | The caption, hashtags, poster headline and visual idea, revised from reviewer feedback |
| **Brand Reviewer** | `verify_menu_claims`, `check_brand_rules`, `check_against_recent_posts`, `get_brand_voice` | Approve, revise (sends it back to the Writer, up to 2 more rounds) or reject |

**Guardrail:** if the deterministic checks find a wrong price, an inactive promotion, a banned phrase or a near-copy of an existing post, the code overrides an AI "approve" to "revise".

**Designer:** `netlify/lib/designer.mts` sends the shop's real logo and two of its real Instagram posts as references to Google's image model, and stores the finished graphic.

### The pipeline runs on the server
The browser can only start a run (`POST /api/runs`) and watch it (`GET /api/runs/:id`). The work happens in `netlify/lib/pipeline.mts` as a chain of short steps (plan, write, review, design). Each step runs in its own function call (`/api/internal/step`), finishes after responding with `context.waitUntil`, and starts the next step with an HMAC-signed request, so:
- no single call hits Netlify's 60 second limit,
- the browser never supplies drafts, reviews or posts (posts are created only by the server),
- a step that arrives twice, or out of order, is ignored.

### Automation (1)
`netlify/lib/automation.mts`, separate from the agents, with no AI decisions.
- **Triggers:** a schedule (every 15 minutes, `netlify/functions/publish-scheduled.mts`) or an event (the owner clicks "Approve & publish now").
- **Steps:** 1) collect approved posts that are due, 2) run the final safety check again (the owner may have edited the text), 3) publish (Bluesky live if connected; Instagram, TikTok and Facebook go to a preview feed inside the app), 4) log the run and notify the owner.

## Security
- **Owner sign-in:** every action that changes data or spends AI credits (start a run, edit, approve, reject, delete, generate graphics, save the profile, run or reset the automation) requires the owner session. Reads are public so the project can be reviewed.
- The password lives only in the `OWNER_PASSWORD` environment variable. Sign-in sets a signed, HttpOnly, Secure, SameSite=Strict cookie that lasts 7 days. Wrong passwords are slowed down.
- **Fails closed:** if `OWNER_PASSWORD` is missing, every protected action is refused.
- **Validated input:** every request body is parsed with a zod schema (`netlify/lib/validate.mts`). Invalid input gets a clear 400 error instead of a crash.
- `/api/status` shows only whether the AI and Bluesky are on, never setting names or values.
- No social media accounts are connected. The app cannot post to Instagram, Facebook or TikTok.

## Development
```bash
npm install
npm run typecheck   # strict TypeScript check of every function and library file
```
Deploys happen automatically from the `main` branch on Netlify.

## Environment variables (Netlify: Project configuration > Environment variables)
| Variable | Required | Purpose |
|---|---|---|
| `OWNER_PASSWORD` | Yes | Owner sign-in password (8+ characters). Without it nothing can be changed. |
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | No | Publish Bluesky posts for real (use an app password from Bluesky settings) |
| `NOTIFY_WEBHOOK_URL` | No | Also send owner notifications to a Discord or Slack channel |
| `AGENT_MODEL`, `IMAGE_MODEL` | No | Override the AI models |
| `FORCE_OFFLINE=1` | No | Backup demo mode with scripted agents (no AI calls) |

The AI models are reached through the Netlify AI Gateway, so no AI API keys are needed.

## Where it can fail and how much to trust it
- **Invented facts** (prices, deals): caught by code checks twice. These checks are only as accurate as the business profile.
- **Tone or cultural misstep:** the owner reviews every post.
- **Graphic accuracy:** the AI draws from the menu description, and its copy of the logo can be slightly off, so the owner checks each graphic.
- **API outage:** the post is held and the owner is notified.

**Trust level:** high for planning and fact-checking, medium for the writing and graphics, low for posting with no human review. The system does about 90% of the work, and the owner keeps the final 10%: approval.
