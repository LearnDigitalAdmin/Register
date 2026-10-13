// Asks PAY (the shared desk project) to plan the desk part of a school's SMS top-up, so a desk agent who owns the school
// earns their commission on MyRegister purchases. PAY does the owner lookup, the first-purchase reservation and the
// Paystack split; Register only attaches the returned split to its own charge and stores the commission on the pending
// document, which PAY's webhook reads at settlement to write the desk event.
//
// FAIL OPEN: every failure (not configured, timeout, 4xx/5xx, malformed answer) returns null and the purchase proceeds
// as a plain charge. A desk problem must never stop a school from buying tokens.
import { GoogleAuth } from "google-auth-library";
import { defineString } from "firebase-functions/params";

/** Full URL of PAY's private `deskSmsCommission` function. Empty = feature off (plain charges). */
export const DESK_SMS_PLAN_URL = defineString("DESK_SMS_PLAN_URL", { default: "" });

export interface DeskSmsPlan { splitCode: string; commission: Record<string, unknown> }

export interface DeskCallOptions {
  url?: string;
  /** Test override. Default: Google ID token for the audience, via the runtime service account. */
  getIdToken?: (audience: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** The school document id IS the KNEC code, so the desk entity key is simply school:<schoolId>. */
export const deskEntityKey = (schoolId: string): string => `school:${schoolId}`;

/** *.run.app uses the service origin as ID-token audience; a cloudfunctions.net URL uses the full URL. */
export function deskAudience(url: string): string {
  const u = new URL(url);
  return u.hostname.endsWith(".run.app") ? u.origin : `${u.origin}${u.pathname}`;
}

const auth = new GoogleAuth();
async function defaultIdToken(audience: string): Promise<string> {
  const client = await auth.getIdTokenClient(audience);
  return client.idTokenProvider.fetchIdToken(audience);
}

function configuredUrl(o: DeskCallOptions): string {
  if (o.url !== undefined) return o.url.trim();
  try { return DESK_SMS_PLAN_URL.value().trim(); } catch { return ""; }
}

async function call(body: Record<string, unknown>, o: DeskCallOptions): Promise<Record<string, unknown> | null> {
  const url = configuredUrl(o);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 8_000);
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const token = await (o.getIdToken ?? defaultIdToken)(deskAudience(url));
    const res = await (o.fetchImpl ?? fetch)(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.warn("desk sms call refused:", res.status); return null; }
    const json = await res.json();
    return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch (err) {
    console.warn("desk sms call failed:", (err as Error)?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A desk split for this purchase, or null for "charge normally". */
export async function planDeskSms(
  p: { schoolId: string; reference: string; tier: string; tokens: number }, o: DeskCallOptions = {},
): Promise<DeskSmsPlan | null> {
  const out = await call({ action: "plan", entityKey: deskEntityKey(p.schoolId), reference: p.reference, tier: p.tier, tokens: p.tokens }, o);
  if (!out || out.applied !== true) return null;
  const c = out.commission as Record<string, unknown> | undefined;
  if (typeof out.splitCode !== "string" || !out.splitCode.startsWith("SPL_")) return null;
  if (!c || typeof c !== "object" || c.entityKey !== deskEntityKey(p.schoolId) || typeof c.sharePct !== "number") return null;
  return { splitCode: out.splitCode, commission: { ...c } };
}

/** The charge never started: free the first-purchase reservation PAY took for it. Best effort (it also expires by itself). */
export async function releaseDeskSms(p: { schoolId: string; reference: string }, o: DeskCallOptions = {}): Promise<void> {
  await call({ action: "release", entityKey: deskEntityKey(p.schoolId), reference: p.reference }, o);
}
