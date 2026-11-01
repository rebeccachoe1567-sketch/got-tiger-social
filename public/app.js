// Got Tiger Social Studio — front end.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LIMITS = { Instagram: 2200, TikTok: 2200, Facebook: 2000, Bluesky: 300 };
let PROFILE = null;
let STATUS = {};

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), ms);
}

function fmtWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: PROFILE?.timezone });
}
const fullText = (d) => `${d.caption}${d.hashtags?.length ? "\n\n" + d.hashtags.map((h) => "#" + h).join(" ") : ""}`;

// ------------------------------------------------------------------ navigation
function show(view) {
  $$("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  if (view === "approvals") loadApprovals();
  if (view === "automation") loadAutomation();
  if (view === "feed") loadFeed();
  if (view === "profile") loadProfile();
  history.replaceState(null, "", `#${view}`);
  window.scrollTo(0, 0);
}
$$("nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

// ------------------------------------------------------------------ status
async function loadStatus() {
  try {
    STATUS = await api("/api/status");
  } catch {
    STATUS = { ai: "offline" };
  }
  $("#status").innerHTML = `
    <div class="status-row"><i class="dot ${STATUS.ai === "live" ? "on" : "sim"}"></i>${STATUS.ai === "live" ? `AI live · ${esc(STATUS.model)}` : "AI offline demo mode"}</div>
    <div class="status-row"><i class="dot ${STATUS.bluesky ? "on" : "sim"}"></i>${STATUS.bluesky ? `Bluesky connected` : "Bluesky not connected (simulated)"}</div>
    <div class="status-row"><i class="dot on"></i>Automation every 15 min</div>`;
}

async function refreshCount() {
  try {
    const posts = await api("/api/posts");
    const n = posts.filter((p) => p.status === "awaiting_owner" || p.status === "held").length;
    const pill = $("#approvalCount");
    pill.textContent = n;
    pill.classList.toggle("hidden", !n);
    return posts;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ agents pipeline
function traceHTML(steps) {
  return steps
    .map((s) => {
      if (s.type === "thought") return `<li><span class="thought">“${esc(s.text)}”</span></li>`;
      if (s.type === "tool") return `<li><span class="k">${esc(s.tool)}</span><span>${esc(s.summary)}</span></li>`;
      return `<li class="final"><span class="k">${esc(s.tool)}</span><span>decision submitted</span></li>`;
    })
    .join("");
}
function setState(el, cls, text) {
  el.className = `state ${cls}`;
  el.textContent = text;
}

$("#planForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#runBtn");
  btn.disabled = true;
  btn.textContent = "Agents working…";
  $("#pipeline").classList.remove("hidden");
  $("#strategistTrace").innerHTML = "";
  $("#strategySummary").classList.add("hidden");
  $("#postLanes").innerHTML = "";
  $("#pipelineDone").classList.add("hidden");
  const st = $("#strategistState");
  setState(st, "running", "thinking");
  try {
    const strat = await api("/api/agents/strategist", { goal: $("#goal").value.trim(), count: Number($("#count").value) });
    $("#strategistTrace").innerHTML = traceHTML(strat.trace);
    if (strat.mode === "offline") toast("⚠️ The AI wasn't reachable, so this run used backup mode (scripted captions). Wait a minute and run it again.", 9000);
    setState(st, "done", `planned ${strat.posts.length}`);
    $("#strategySummary").innerHTML = `<b>Strategy:</b> ${esc(strat.summary)}`;
    $("#strategySummary").classList.remove("hidden");
    const batchId = Date.now().toString(36);
    const results = await Promise.allSettled(strat.posts.map((plan, i) => runPost(plan, i, batchId, strat.summary)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const banner = $("#pipelineDone");
    banner.innerHTML = `<div><b>${ok} post${ok === 1 ? "" : "s"} ready for your approval</b><div style="opacity:.75;font-size:14px">The agents never publish on their own — you approve each one.</div></div><button class="btn orange" onclick="show('approvals')">Review &amp; approve →</button>`;
    banner.classList.remove("hidden");
    banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    refreshCount();
  } catch (err) {
    setState(st, "error", "error");
    toast(err.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run the agents 🐯";
  }
});

async function runPost(plan, i, batchId, strategySummary) {
  const lane = document.createElement("div");
  lane.className = "lane";
  lane.innerHTML = `
    <div class="lane-head">
      <b>Post ${i + 1}</b><span class="chip ${esc(plan.platform)}">${esc(plan.platform)}</span>
      <span class="chip">${esc(fmtWhen(plan.publish_at))}</span>
      <span class="chip">${esc((plan.menu_items || []).join(", ") || plan.goal)}</span>
      <span style="color:var(--ink-2);font-size:13.5px;flex-basis:100%">${esc(plan.angle)} — <i style="color:var(--muted)">${esc(plan.reasoning)}</i></span>
    </div>
    <div class="lane-body">
      <div class="lane-col">
        <div class="agent-head"><div class="agent-icon w">2</div><div><h3>Writer agent</h3></div><span class="state" data-w>waiting</span></div>
        <div data-wout></div>
      </div>
      <div class="lane-col">
        <div class="agent-head"><div class="agent-icon r">3</div><div><h3>Brand Reviewer agent</h3></div><span class="state" data-r>waiting</span></div>
        <div data-rout></div>
      </div>
    </div>`;
  $("#postLanes").appendChild(lane);
  const wState = $("[data-w]", lane), rState = $("[data-r]", lane);
  const wOut = $("[data-wout]", lane), rOut = $("[data-rout]", lane);

  let draft = null, review = null;
  const rounds = [];
  try {
    for (let round = 1; round <= 3; round++) {
      setState(wState, "running", round === 1 ? "writing" : `revising (${round - 1})`);
      const w = await api("/api/agents/writer", { plan, previous: draft, feedback: review?.feedback_for_writer });
      draft = w.draft;
      wOut.insertAdjacentHTML("beforeend", `<div class="round">Round ${round}</div><ol class="trace">${traceHTML(w.trace)}</ol><div class="draft-preview">${esc(fullText(draft))}</div>`);
      setState(wState, "done", "draft ready");

      setState(rState, "running", "reviewing");
      const r = await api("/api/agents/reviewer", { plan, draft });
      review = r.review;
      const issues = (review.issues || []).filter((x) => x.severity !== "low");
      rOut.insertAdjacentHTML(
        "beforeend",
        `<div class="round">Round ${round}</div><ol class="trace">${traceHTML(r.trace)}</ol>
         <div class="verdict ${esc(review.decision)}"><b>${esc(review.decision.toUpperCase())}</b> · score ${esc(review.score)}/10
         ${review.guardrail_override ? `<div><b>🛡 ${esc(review.guardrail_override)}</b></div>` : ""}
         ${review.decision === "revise" ? `<div>→ ${esc(review.feedback_for_writer)}</div>` : issues.length ? `<div>${issues.map((x) => esc(x.problem)).join("<br>")}</div>` : ""}</div>`,
      );
      rounds.push({ round, decision: review.decision, score: review.score, feedback: review.feedback_for_writer, changes: draft.changes_made, guardrail: review.guardrail_override || null });
      if (review.decision !== "revise") break;
    }
    setState(rState, review.decision === "approve" ? "done" : "warn", review.decision === "approve" ? "approved" : review.decision === "reject" ? "rejected" : "needs owner");
    await api("/api/posts", { plan, draft, review, rounds, batchId, strategySummary });
  } catch (err) {
    setState(wState.classList.contains("running") ? wState : rState, "error", "error");
    wOut.insertAdjacentHTML("beforeend", `<div class="verdict reject">${esc(err.message)}</div>`);
    throw err;
  }
}

// ------------------------------------------------------------------ approvals
function scoreColor(s) {
  return s >= 8 ? "var(--green)" : s >= 6 ? "var(--amber)" : "var(--red)";
}
function toLocalInput(iso) {
  // "YYYY-MM-DDTHH:mm" in the business time zone
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PROFILE?.timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

async function loadApprovals() {
  if (!PROFILE) PROFILE = await api("/api/profile");
  const posts = await refreshCount();
  const pending = posts.filter((p) => p.status === "awaiting_owner" || p.status === "held").sort((a, b) => (a.scheduledFor || "").localeCompare(b.scheduledFor || ""));
  const list = $("#approvalList");
  list.innerHTML = pending.length ? "" : `<div class="empty">Nothing waiting. Go to <b>Plan posts</b> and run the agents.</div>`;
  for (const p of pending) list.appendChild(postCard(p));

  const others = posts.filter((p) => !(p.status === "awaiting_owner" || p.status === "held"));
  const label = { approved: ["Scheduled", "ok"], published: ["Published", "ok"], rejected: ["Rejected by you", "bad"], rejected_by_agent: ["Rejected by AI reviewer", "bad"] };
  $("#otherList").innerHTML = others.length
    ? others
        .map((p) => {
          const [t, c] = label[p.status] || [p.status, ""];
          return `<div class="row"><span class="chip ${esc(p.platform)}">${esc(p.platform)}</span><span class="chip ${c}">${t}</span><span class="txt">${esc(p.draft?.caption)}</span><span class="when">${esc(fmtWhen(p.publishedAt || p.scheduledFor))}</span><button class="btn ghost danger" data-del="${esc(p.id)}">Delete</button></div>`;
        })
        .join("")
    : `<div class="empty" style="padding:20px">No scheduled or past posts yet.</div>`;
  $$("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/api/posts/${b.dataset.del}`, undefined, "DELETE");
      loadApprovals();
    }),
  );
}

function postCard(p) {
  const el = document.createElement("div");
  el.className = "card post-card";
  const r = p.review || {};
  const issues = r.issues || [];
  const roundsTxt = (p.rounds || [])
    .map((x) => `<li>Round ${x.round}: reviewer said <b>${esc(x.decision)}</b> (${esc(x.score)}/10)${x.feedback ? ` — “${esc(x.feedback)}”` : ""}${x.guardrail ? ` <b>🛡 ${esc(x.guardrail)}</b>` : ""}</li>`)
    .join("");
  el.innerHTML = `
    <div class="post-top">
      <span class="chip ${esc(p.platform)}">${esc(p.platform)}</span>
      <span class="chip">${esc(p.plan?.format || "")}</span>
      ${p.status === "held" ? `<span class="chip bad">Held by automation</span>` : r.decision === "approve" ? `<span class="chip ok">AI reviewer approved</span>` : `<span class="chip warn">AI reviewer: needs your eye</span>`}
      <span class="score" style="color:${scoreColor(r.score)}">${esc(r.score ?? "–")}<small>/10</small></span>
    </div>
    ${p.heldReason ? `<div class="meta" style="background:var(--red-soft)"><b>Held:</b> ${esc(p.heldReason)}</div>` : ""}
    <textarea data-caption>${esc(p.draft?.caption)}</textarea>
    <input class="tags" data-tags value="${esc((p.draft?.hashtags || []).map((h) => "#" + h).join(" "))}" placeholder="#hashtags" />
    <div class="charcount" data-count></div>
    <div class="meta"><b>🎨 Visual to create:</b> ${esc(p.draft?.visual_idea)}</div>
    <div class="meta"><b>Why this post:</b> ${esc(p.plan?.reasoning)}</div>
    ${r.owner_should_check ? `<div class="meta" style="background:var(--orange-soft)"><b>👀 Double-check:</b> ${esc(r.owner_should_check)}</div>` : ""}
    <details><summary>Agent review details (${issues.length} note${issues.length === 1 ? "" : "s"}, ${(p.rounds || []).length} round${(p.rounds || []).length === 1 ? "" : "s"})</summary>
      <ul>${issues.map((i) => `<li class="issue-${esc(i.severity)}">[${esc(i.severity)}] ${esc(i.problem)}</li>`).join("") || "<li>No issues found.</li>"}</ul>
      <ul>${roundsTxt}</ul>
    </details>
    <div class="actions">
      <input type="datetime-local" data-when value="${esc(toLocalInput(p.scheduledFor))}" />
      <button class="btn primary" data-approve>Approve &amp; schedule</button>
      <button class="btn orange" data-now>Approve &amp; publish now</button>
      <button class="btn ghost danger" data-reject>Reject</button>
    </div>`;
  const cap = $("[data-caption]", el), tags = $("[data-tags]", el), count = $("[data-count]", el);
  const parseTags = () => tags.value.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
  const upd = () => {
    const n = [...fullText({ caption: cap.value, hashtags: parseTags() })].length;
    const lim = LIMITS[p.platform] || 2200;
    count.textContent = `${n} / ${lim} characters`;
    count.classList.toggle("over", n > lim);
  };
  cap.addEventListener("input", upd);
  tags.addEventListener("input", upd);
  upd();
  const send = async (action, extra = {}) => {
    $$("button", el).forEach((b) => (b.disabled = true));
    try {
      const out = await api(`/api/posts/${p.id}/${action}`, { caption: cap.value, hashtags: parseTags(), scheduledLocal: $("[data-when]", el).value, ...extra });
      if (action === "approve" && extra.publishNow) {
        const st = out.post?.status;
        toast(st === "published" ? `Published to ${out.post.publishTarget} ✅` : `Held: ${out.post?.heldReason || "see Automation"}`, 5000);
      } else toast(action === "approve" ? `Scheduled for ${fmtWhen(out.post.scheduledFor)}` : "Post rejected");
      loadApprovals();
    } catch (e) {
      toast(e.message, 6000);
      $$("button", el).forEach((b) => (b.disabled = false));
    }
  };
  $("[data-approve]", el).onclick = () => send("approve");
  $("[data-now]", el).onclick = () => send("approve", { publishNow: true });
  $("[data-reject]", el).onclick = () => send("reject");
  return el;
}

// ------------------------------------------------------------------ automation
async function loadAutomation() {
  if (!PROFILE) PROFILE = await api("/api/profile");
  const data = await api("/api/automation");
  $("#runLog").innerHTML = data.runs.length
    ? data.runs
        .map(
          (r) => `<div class="run"><div class="run-head">${esc(r.trigger)}<span>${esc(fmtWhen(r.startedAt))}</span></div>
          <ol>${r.steps.map((s) => `<li><b>${esc(s.name)}:</b> ${esc(s.detail)}${s.errors?.length ? ` <span class="issue-high">${esc(s.errors.join("; "))}</span>` : ""}</li>`).join("")}</ol></div>`,
        )
        .join("")
    : `<div class="empty" style="padding:20px">No runs with activity yet. ${data.lastRun ? `Last check: ${esc(fmtWhen(data.lastRun.startedAt))} (nothing due).` : ""}</div>`;
  $("#inbox").innerHTML = data.notifications.length
    ? data.notifications.map((n) => `<div class="note-item ${esc(n.kind)}">${esc(n.message)}<small>${esc(fmtWhen(n.at))}</small></div>`).join("")
    : `<div class="empty" style="padding:20px">No notifications yet.</div>`;
}
$("#runAutomation").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    const run = await api("/api/automation/run", {});
    toast(`Automation ran: ${run.published} published, ${run.held} held`);
    loadAutomation();
    refreshCount();
  } catch (err) {
    toast(err.message, 6000);
  } finally {
    e.target.disabled = false;
  }
});

// ------------------------------------------------------------------ feed
async function loadFeed() {
  if (!PROFILE) PROFILE = await api("/api/profile");
  const posts = (await api("/api/posts")).filter((p) => p.status === "published").sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  const menu = Object.fromEntries((PROFILE.menu || []).map((m) => [m.name, m.category]));
  $("#feed").innerHTML = posts.length
    ? posts
        .map((p) => {
          const cat = menu[(p.plan?.menu_items || [])[0]] || "K-Dog";
          const drink = cat !== "K-Dog" && cat !== "Add-on";
          const cls = drink ? "boba" : "";
          const emoji = drink ? "🧋" : "🌽";
          const body = esc(p.draft.caption) + (p.draft.hashtags?.length ? `\n\n<span class="ht">${p.draft.hashtags.map((h) => "#" + esc(h)).join(" ")}</span>` : "");
          return `<article class="phone">
            <div class="phone-head"><div class="avatar">🐯</div><div><b>${esc(PROFILE.instagram || PROFILE.name)}</b><small>${esc(PROFILE.city)}</small></div><span class="chip ${esc(p.platform)}">${esc(p.platform)}</span></div>
            ${p.platform === "Bluesky" ? "" : `<div class="visual ${cls}"><div class="emoji">${emoji}</div><div class="idea"><b>Graphic concept</b>${esc(p.draft.visual_idea)}</div></div>`}
            <div class="phone-body">${body}</div>
            <div class="phone-foot"><span>${esc(fmtWhen(p.publishedAt))} · ${esc(p.publishTarget)}</span>${p.externalUrl ? `<a href="${esc(p.externalUrl)}" target="_blank" rel="noopener">View live ↗</a>` : ""}</div>
          </article>`;
        })
        .join("")
    : `<div class="empty">Nothing published yet. Approve a post with <b>publish now</b>, or wait for its scheduled time.</div>`;
}

// ------------------------------------------------------------------ profile
async function loadProfile() {
  PROFILE = await api("/api/profile");
  const p = PROFILE;
  $("#sampleNote").classList.toggle("hidden", !(p.menu || []).some((m) => !m.price));
  $("#profileForm").innerHTML = `
    <div class="card">
      <h3>Basics</h3>
      <label>Business name<input name="name" value="${esc(p.name)}"></label>
      <label>Former name <small>(may still appear on cups/signs)</small><input name="former_name" value="${esc(p.former_name || "")}"></label>
      <label>Tagline<input name="tagline" value="${esc(p.tagline)}"></label>
      <label>Instagram handle<input name="instagram" value="${esc(p.instagram || "")}"></label>
      <label>Locations<input name="locations" value="${esc(p.locations || "")}"></label>
      <label>City <small>(used for the weather forecast)</small><input name="city" value="${esc(p.city)}"></label>
      <div class="inline">
        <label>Latitude<input name="latitude" value="${esc(p.latitude)}"></label>
        <label>Longitude<input name="longitude" value="${esc(p.longitude)}"></label>
        <label>Time zone<input name="timezone" value="${esc(p.timezone)}"></label>
      </div>
      <label>Hours<input name="hours" value="${esc(p.hours)}"></label>
      <label>Slow times <small>(the strategist tries to fill these)</small><input name="slow_times" value="${esc(p.slow_times)}"></label>
    </div>
    <div class="card">
      <h3>Brand</h3>
      <label>Audience<textarea name="audience" rows="2">${esc(p.audience)}</textarea></label>
      <label>Brand voice<textarea name="voice" rows="4">${esc(p.voice)}</textarea></label>
      <label>Example captions <small>(one per line — the Writer copies this style)</small><textarea name="example_posts" rows="4">${esc((p.example_posts || []).join("\n"))}</textarea></label>
      <label>Hashtag bank <small>(comma separated, no #)</small><input name="hashtags" value="${esc((p.hashtags || []).join(", "))}"></label>
      <label>Banned phrases <small>(comma separated — posts using these are blocked)</small><input name="banned_phrases" value="${esc(p.banned_phrases.join(", "))}"></label>
      <label>Active promotions <small>(one per line — any deal not listed here is blocked)</small><textarea name="promotions" rows="3">${esc(p.promotions.join("\n"))}</textarea></label>
      <label>Local events <small>(one per line: YYYY-MM-DD | event)</small><textarea name="events" rows="3" placeholder="2026-11-27 | Colorado Mills Black Friday sale">${esc((p.events || []).map((e) => `${e.date} | ${e.name}`).join("\n"))}</textarea></label>
    </div>
    <div class="card full">
      <h3>Menu &amp; prices</h3>
      <table class="menu-table"><thead><tr><th>Item</th><th>Price ($)</th><th>Other sizes <small>(e.g. Large 6, Bulb Cup 12.50)</small></th><th>Category</th><th>Tags</th><th>Description / flavors</th><th></th></tr></thead><tbody id="menuRows"></tbody></table>
      <div><button type="button" class="btn" id="addItem">+ Add item</button> <button type="button" class="btn ghost danger" id="resetDemo">Clear all demo posts &amp; logs</button></div>
    </div>`;
  const rows = $("#menuRows");
  const addRow = (m = { name: "", price: "", category: "K-Dog", tags: [] }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input data-k="name" value="${esc(m.name)}"></td><td class="price"><input data-k="price" type="number" step="0.01" placeholder="not set" value="${m.price ? esc(m.price) : ""}"></td><td><input data-k="sizes" placeholder="—" value="${esc((m.sizes || []).map((x) => `${x.label} ${x.price}`).join(", "))}"></td><td><input data-k="category" value="${esc(m.category)}"></td><td><input data-k="tags" value="${esc((m.tags || []).join(", "))}"></td><td><input data-k="description" value="${esc(m.description || "")}"></td><td><button type="button" class="x" title="Remove">×</button></td>`;
    $(".x", tr).onclick = () => tr.remove();
    rows.appendChild(tr);
  };
  p.menu.forEach(addRow);
  $("#addItem").onclick = () => addRow();
  $("#resetDemo").onclick = async () => {
    if (!confirm("Delete all posts, run logs and notifications? The business profile is kept.")) return;
    await api("/api/automation/reset", {});
    toast("Demo data cleared");
    refreshCount();
  };
}
$("#saveProfile").addEventListener("click", async () => {
  const f = $("#profileForm");
  const v = (n) => f.elements[n].value;
  const body = {
    name: v("name"), former_name: v("former_name"), tagline: v("tagline"), instagram: v("instagram"), locations: v("locations"), city: v("city"),
    example_posts: v("example_posts").split("\n").map((s) => s.trim()).filter(Boolean),
    hashtags: v("hashtags").split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean), latitude: v("latitude"), longitude: v("longitude"), timezone: v("timezone"),
    hours: v("hours"), slow_times: v("slow_times"), audience: v("audience"), voice: v("voice"),
    banned_phrases: v("banned_phrases").split(",").map((s) => s.trim()).filter(Boolean),
    promotions: v("promotions").split("\n").map((s) => s.trim()).filter(Boolean),
    events: v("events").split("\n").map((l) => l.split("|").map((s) => s.trim())).filter((x) => x[0] && x[1]).map(([date, name]) => ({ date, name })),
    menu: $$("#menuRows tr").map((tr) => {
      const g = (k) => $(`[data-k=${k}]`, tr).value;
      const sizes = g("sizes").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const m = s.match(/^(.*?)\s*\$?\s*(\d+(?:\.\d+)?)$/);
        return m ? { label: m[1].trim(), price: Number(m[2]) } : null;
      }).filter(Boolean);
      return { name: g("name"), price: Number(g("price")), sizes, category: g("category"), tags: g("tags").split(",").map((s) => s.trim()).filter(Boolean), description: g("description") };
    }),
    platforms: PROFILE.platforms,
    sample: false,
  };
  try {
    PROFILE = await api("/api/profile", body, "PUT");
    $("#sampleNote").classList.toggle("hidden", !(PROFILE.menu || []).some((m) => !m.price));
    toast("Profile saved — the agents will use it from now on");
  } catch (e) {
    toast(e.message, 6000);
  }
});

// ------------------------------------------------------------------ boot
(async () => {
  loadStatus();
  try { PROFILE = await api("/api/profile"); } catch {}
  refreshCount();
  const v = location.hash.slice(1);
  if (v && $(`#view-${v}`)) show(v);
})();
