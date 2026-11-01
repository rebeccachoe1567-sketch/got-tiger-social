// A small agent loop on top of the Anthropic SDK.
// On Netlify, the AI Gateway injects ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL,
// so `new Anthropic()` works with no key of our own.
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, isUnauthorized } from "./gateway.mts";
import type { TraceStep } from "./types.mts";

export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };

export type ToolInput = Record<string, unknown>;

export type AgentTool = {
  name: string;
  description: string;
  input_schema: JsonSchema;
  run: (input: ToolInput) => unknown;
  summarize?: (output: unknown, input: ToolInput) => string;
};

/** Define a tool with a typed output; the agent loop stores it type-erased. */
export function tool<O>(def: {
  name: string;
  description: string;
  input_schema?: JsonSchema;
  run: (input: ToolInput) => O | Promise<O>;
  summarize?: (output: O, input: ToolInput) => string;
}): AgentTool {
  const summarize = def.summarize;
  return {
    name: def.name,
    description: def.description,
    input_schema: def.input_schema ?? { type: "object", properties: {} },
    run: def.run,
    summarize: summarize ? (o, i) => summarize(o as O, i) : undefined,
  };
}

export function llmMode(): "live" | "offline" {
  if (Netlify.env.get("FORCE_OFFLINE") === "1") return "offline";
  return Netlify.env.get("ANTHROPIC_BASE_URL") || Netlify.env.get("ANTHROPIC_API_KEY") ? "live" : "offline";
}

function models() {
  return [Netlify.env.get("AGENT_MODEL"), "claude-haiku-4-5", "claude-sonnet-4-5"].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );
}

function defaultSummary(out: unknown) {
  const s = typeof out === "string" ? out : JSON.stringify(out);
  return s.length > 140 ? s.slice(0, 137) + "..." : s;
}

function errorStatus(e: unknown): number | undefined {
  return typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : undefined;
}

export async function runAgent<R>(opts: {
  system: string;
  userMessage: string;
  tools: AgentTool[];
  finalTool: AgentTool; // calling this ends the loop; its input is the agent's result
  maxTurns?: number;
}): Promise<{ result: R; trace: TraceStep[]; model: string; turns: number }> {
  const { system, userMessage, tools, finalTool } = opts;
  const maxTurns = opts.maxTurns ?? 8;
  let client = anthropicClient();
  let retriedAuth = false;
  const allTools = [...tools, finalTool];
  const apiTools: Anthropic.Tool[] = allTools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const trace: TraceStep[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  const modelList = models();
  let mi = 0;
  const started = Date.now();

  for (let turn = 0; turn < maxTurns; turn++) {
    const forceFinal = turn === maxTurns - 1 || Date.now() - started > 38000;
    let resp: Anthropic.Message | undefined;
    while (!resp) {
      try {
        resp = await client.messages.create({
          model: modelList[mi],
          max_tokens: 1800,
          system,
          tools: apiTools,
          tool_choice: forceFinal ? { type: "tool", name: finalTool.name } : { type: "auto" },
          messages,
        });
      } catch (e) {
        if (isUnauthorized(e) && !retriedAuth) {
          retriedAuth = true;
          client = anthropicClient(true); // retry once with the gateway's own key
          continue;
        }
        const status = errorStatus(e);
        const msg = e instanceof Error ? e.message : String(e);
        if ((status === 404 || (status === 400 && /model/i.test(msg))) && mi < modelList.length - 1) {
          mi++;
          continue;
        }
        throw e;
      }
    }
    messages.push({ role: "assistant", content: resp.content });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (text) trace.push({ type: "thought", text: text.length > 400 ? text.slice(0, 397) + "..." : text });

    const uses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      messages.push({ role: "user", content: `Continue. Use your tools, then call ${finalTool.name} with your final answer.` });
      continue;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      if (u.name === finalTool.name) {
        trace.push({ type: "final", tool: u.name });
        return { result: u.input as R, trace, model: modelList[mi], turns: turn + 1 };
      }
      const tool = allTools.find((t) => t.name === u.name);
      const input = (u.input ?? {}) as ToolInput;
      let out: unknown;
      try {
        out = tool ? await tool.run(input) : { error: `Unknown tool ${u.name}` };
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
      trace.push({ type: "tool", tool: u.name, input, summary: (tool?.summarize ?? defaultSummary)(out, input) });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("Agent ran out of turns without a final answer");
}
