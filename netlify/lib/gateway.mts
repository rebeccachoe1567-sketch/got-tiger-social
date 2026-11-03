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

/**
 * Google image client. If Netlify didn't pass the Google-specific settings (this can happen when the
 * site's settings get close to Netlify's ~4 KB limit), fall back to the gateway's general key and
 * address, which every provider shares.
 */
export function geminiClient(useGatewayKey = false) {
  const apiKey = useGatewayKey
    ? env("NETLIFY_AI_GATEWAY_KEY") ?? env("GEMINI_API_KEY")
    : env("GEMINI_API_KEY") ?? env("NETLIFY_AI_GATEWAY_KEY") ?? env("ANTHROPIC_API_KEY");
  const baseUrl = env("GOOGLE_GEMINI_BASE_URL") ?? gatewayBaseUrl();
  // Names only (never values), so the logs show which settings Netlify passed in.
  const present = ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL", "NETLIFY_AI_GATEWAY_KEY", "NETLIFY_AI_GATEWAY_URL", "ANTHROPIC_API_KEY", "URL"].filter((k) => !!env(k));
  console.log(`[ai-gateway] image client settings present: ${present.join(", ") || "none"}`);
  return new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
}

/** The gateway lives at <site>/.netlify/ai for every provider. */
function gatewayBaseUrl() {
  const fromEnv = env("NETLIFY_AI_GATEWAY_URL") ?? env("ANTHROPIC_BASE_URL");
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const site = env("URL");
  return site ? `${site.replace(/\/+$/, "")}/.netlify/ai` : undefined;
}

export function geminiAvailable() {
  return !!(env("GEMINI_API_KEY") || env("NETLIFY_AI_GATEWAY_KEY") || env("ANTHROPIC_API_KEY"));
}

export function isUnauthorized(e: unknown) {
  const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: unknown }).status : undefined;
  return status === 401 || /\b401\b|unauthori[sz]ed/i.test(e instanceof Error ? e.message : String(e));
}
