// Netlify AI Gateway credentials. Read them per call with Netlify.env.get (fresh for each
// request) instead of letting the SDKs read process.env once at startup, which can go stale
// in a long-lived function instance and cause "401 Unauthorized" from the gateway.
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

const env = (k: string) => Netlify.env.get(k) || process.env[k] || undefined;

export function anthropicClient(useGatewayKey = false) {
  const apiKey = useGatewayKey ? env("NETLIFY_AI_GATEWAY_KEY") : env("ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey: apiKey ?? env("NETLIFY_AI_GATEWAY_KEY"), baseURL: env("ANTHROPIC_BASE_URL") });
}

export function geminiClient(useGatewayKey = false) {
  const apiKey = useGatewayKey ? env("NETLIFY_AI_GATEWAY_KEY") : env("GEMINI_API_KEY");
  const baseUrl = env("GOOGLE_GEMINI_BASE_URL");
  return new GoogleGenAI({ apiKey: apiKey ?? env("NETLIFY_AI_GATEWAY_KEY"), ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
}

export function isUnauthorized(e: unknown) {
  const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: unknown }).status : undefined;
  return status === 401 || /\b401\b|unauthori[sz]ed/i.test(e instanceof Error ? e.message : String(e));
}
