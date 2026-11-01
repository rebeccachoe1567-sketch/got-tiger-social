// Owner sign-in. The owner password lives only in the OWNER_PASSWORD environment
// variable (set in Netlify). A successful sign-in sets a signed, HttpOnly session cookie.
// If OWNER_PASSWORD is not set, every protected action is refused (fail closed).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

const COOKIE = "gt_session";
const SESSION_DAYS = 7;

function ownerPassword(): string | undefined {
  const p = Netlify.env.get("OWNER_PASSWORD");
  return p && p.length >= 8 ? p : undefined;
}

export function authConfigured() {
  return !!ownerPassword();
}

function key(purpose: string) {
  const pw = ownerPassword();
  if (!pw) throw new Error("OWNER_PASSWORD is not set");
  return createHmac("sha256", pw).update(`got-tiger:${purpose}`).digest();
}

function sign(purpose: string, value: string) {
  return createHmac("sha256", key(purpose)).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export function checkPassword(candidate: unknown) {
  const pw = ownerPassword();
  if (!pw || typeof candidate !== "string") return false;
  // Compare HMACs so the comparison is constant-time regardless of length.
  return safeEqual(sign("pw", candidate), sign("pw", pw));
}

export function sessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const value = `${exp}.${sign("session", String(exp))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function isOwner(context: Context) {
  if (!authConfigured()) return false;
  const raw = context.cookies.get(COOKIE);
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign("session", exp));
}

/** Returns a 401/503 Response if the caller is not the signed-in owner, otherwise null. */
export function requireOwner(context: Context): Response | null {
  if (!authConfigured()) {
    return Response.json(
      { error: "Owner password isn't set up yet. Add OWNER_PASSWORD (8+ characters) in Netlify's environment variables, then redeploy." },
      { status: 503 },
    );
  }
  if (!isOwner(context)) return Response.json({ error: "Sign in as the owner to do this." }, { status: 401 });
  return null;
}

/** Signs internal pipeline steps so only this server can trigger them. */
export function stepToken(payload: string) {
  return sign("step", payload);
}
export function verifyStepToken(payload: string, token: string | null) {
  if (!authConfigured() || !token) return false;
  return safeEqual(token, stepToken(payload));
}
