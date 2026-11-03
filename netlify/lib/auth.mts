// Owner sign-in. The owner password lives only in the OWNER_PASSWORD environment
// variable (set in Netlify). Protections:
// - minimum length of 14 characters; shorter passwords disable sign-in entirely (fail closed)
// - attempt limits: 5 wrong guesses per network in 15 minutes locks that network out for
//   15 minutes, and 20 wrong guesses from anywhere locks all sign-ins for 15 minutes
// - sessions are stored on the server, so signing out (or changing the password) ends them
//   everywhere, even if someone copied the cookie
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { deleteSession, getAttempts, getSession, saveAttempts, saveSession, type Attempts } from "./store.mts";

const COOKIE = "gt_session";
const SESSION_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 14;
const WINDOW_MS = 15 * 60 * 1000;
const PER_NETWORK_LIMIT = 5;
const GLOBAL_LIMIT = 20;

function ownerPassword(): string | undefined {
  const p = Netlify.env.get("OWNER_PASSWORD");
  return p && p.length >= MIN_PASSWORD_LENGTH ? p : undefined;
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

// ---------------------------------------------------------------- attempt limits
const networkKey = (context: Context) => createHash("sha256").update(`got-tiger:${context.ip || "unknown"}`).digest("hex").slice(0, 24);

function locked(a: Attempts | null) {
  return !!a?.lockedUntil && a.lockedUntil > Date.now();
}

/** Returns the number of minutes the caller must wait, or 0 if they may try. */
export async function signInWait(context: Context) {
  const [mine, all] = await Promise.all([getAttempts(networkKey(context)), getAttempts("global")]);
  const until = Math.max(locked(mine) ? mine!.lockedUntil! : 0, locked(all) ? all!.lockedUntil! : 0);
  return until ? Math.ceil((until - Date.now()) / 60000) : 0;
}

async function bump(key: string, limit: number) {
  const now = Date.now();
  const a = await getAttempts(key);
  const fresh = !a || now - a.first > WINDOW_MS;
  const next: Attempts = fresh ? { count: 1, first: now } : { ...a, count: a.count + 1 };
  if (next.count >= limit) next.lockedUntil = now + WINDOW_MS;
  await saveAttempts(key, next);
}

export async function recordFailure(context: Context) {
  await Promise.all([bump(networkKey(context), PER_NETWORK_LIMIT), bump("global", GLOBAL_LIMIT)]);
}

export async function recordSuccess(context: Context) {
  await saveAttempts(networkKey(context), null);
}

export function checkPassword(candidate: unknown) {
  const pw = ownerPassword();
  if (!pw || typeof candidate !== "string") return false;
  // Compare HMACs so the comparison is constant-time regardless of length.
  return safeEqual(sign("pw", candidate), sign("pw", pw));
}

// ---------------------------------------------------------------- sessions
function readCookie(context: Context) {
  const raw = context.cookies.get(COOKIE);
  if (!raw) return null;
  const [sid, exp, sig] = raw.split(".");
  if (!sid || !exp || !sig || !/^[A-Za-z0-9_-]{20,64}$/.test(sid)) return null;
  return { sid, exp: Number(exp), sig, value: `${sid}.${exp}` };
}

export async function createSession() {
  const sid = randomBytes(24).toString("base64url");
  const exp = Date.now() + SESSION_DAYS * 86400000;
  await saveSession(sid, exp);
  return `${COOKIE}=${sid}.${exp}.${sign("session", `${sid}.${exp}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export async function endSession(context: Context) {
  const c = readCookie(context);
  if (c) await deleteSession(c.sid);
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function isOwner(context: Context) {
  if (!authConfigured()) return false;
  const c = readCookie(context);
  if (!c || !(c.exp > Date.now()) || !safeEqual(c.sig, sign("session", c.value))) return false;
  const stored = await getSession(c.sid);
  return !!stored && stored.exp === c.exp && stored.exp > Date.now();
}

/** Returns a 401/503 Response if the caller is not the signed-in owner, otherwise null. */
export async function requireOwner(context: Context): Promise<Response | null> {
  if (!authConfigured()) {
    return Response.json(
      { error: `Owner sign-in is off until OWNER_PASSWORD (${MIN_PASSWORD_LENGTH}+ characters) is set in Netlify and the site is redeployed.` },
      { status: 503 },
    );
  }
  if (!(await isOwner(context))) return Response.json({ error: "Sign in as the owner to do this." }, { status: 401 });
  return null;
}

// ---------------------------------------------------------------- internal pipeline steps
/** Signs internal pipeline steps so only this server can trigger them. */
export function stepToken(payload: string) {
  return sign("step", payload);
}
export function verifyStepToken(payload: string, token: string | null) {
  if (!authConfigured() || !token) return false;
  return safeEqual(token, stepToken(payload));
}
