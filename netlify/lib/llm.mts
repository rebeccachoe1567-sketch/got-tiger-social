// A small, dependency-light agent loop on top of the Anthropic SDK.
// On Netlify, the AI Gateway injects ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL,
// so `new Anthropic()` works with no key of our own.
import Anthropic from "@anthropic-ai/sdk";

export type AgentTool = {
  name: string;
  description: string;
  input_schema: any;
  run: (input: any) => Promise<any> | any;
  summarize?: (output: any, input: any) => string;
};

export type TraceStep =
  | { type: "thought"; text: string }
  | { type: "tool"; tool: string; input: any; summary: string }
  | { type: "final"; tool: string };

export function llmMode(): "live" | "offline" {
  if (Netlify.env.get("FORCE_OFFLINE") === "1") return "offline";
  return Netlify.env.get("ANTHROPIC_BASE_URL") || Netlify.env.get("ANTHROPIC_API_KEY") ? "live" : "offline";
}

function models() {
  return [Netlify.env.get("AGENT_MODEL"), "claude-haiku-4-5", "claude-sonnet-4-5", "claude-3-5-haiku-latest"].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );
}

function defaultSummary(out: any) {
  const s = typeof out === "string" ? out : JSON.stringify(out);
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}

export async function runAgent(opts: {
  system: string;
  userMessage: string;
  tools: AgentTool[];
  finalTool: AgentTool; // calling this ends the loop; its input is the agent's result
  maxTurns?: number;
}) {
  const { system, userMessage, tools, finalTool } = opts;
  const maxTurns = opts.maxTurns ?? 8;
  const client = new Anthropic();
  const allTools = [...tools, finalTool];
  const apiTools = allTools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const trace: TraceStep[] = [];
  const messages: any[] = [{ role: "user", content: userMessage }];
  const modelList = models();
  let mi = 0;
  const started = Date.now();

  for (let turn = 0; turn < maxTurns; turn++) {
    const forceFinal = turn === maxTurns - 1 || Date.now() - started > 38000;
    let resp: any;
    for (;;) {
      try {
        resp = await client.messages.create({
          model: modelList[mi],
          max_tokens: 1800,
          system,
          tools: apiTools as any,
          tool_choice: forceFinal ? { type: "tool", name: finalTool.name } : { type: "auto" },
          messages,
        });
        break;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if ((e?.status === 404 || (e?.status === 400 && /model/i.test(msg))) && mi < modelList.length - 1) {
          mi++;
          continue;
        }
        throw e;
      }
    }
    messages.push({ role: "assistant", content: resp.content });
    const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
    if (text) trace.push({ type: "thought", text: text.length > 400 ? text.slice(0, 397) + "…" : text });

    const uses = resp.content.filter((b: any) => b.type === "tool_use");
    if (!uses.length) {
      messages.push({ role: "user", content: `Continue. Use your tools, then call ${finalTool.name} with your final answer.` });
      continue;
    }
    const results: any[] = [];
    for (const u of uses) {
      if (u.name === finalTool.name) {
        trace.push({ type: "final", tool: u.name });
        return { result: u.input, trace, model: modelList[mi], turns: turn + 1 };
      }
      const tool = allTools.find((t) => t.name === u.name);
      let out: any;
      try {
        out = tool ? await tool.run(u.input || {}) : { error: `Unknown tool ${u.name}` };
      } catch (e: any) {
        out = { error: String(e?.message || e) };
      }
      trace.push({ type: "tool", tool: u.name, input: u.input, summary: (tool?.summarize || defaultSummary)(out, u.input) });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("Agent ran out of turns without a final answer");
}
