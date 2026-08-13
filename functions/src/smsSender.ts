/**
 * Shared HostPinnacle SMS send helper. Extracted from index.ts so registerReminders.ts and
 * scheduledMessagesPoller.ts don't each carry their own slightly-different copy — this is
 * now the ONE place that talks to HostPinnacle. If you change credentials, retry behaviour,
 * or sanitisation here, every automated send (immediate, reminder, or scheduled) picks it up.
 */

import axios from "axios";

export const SMS_CONFIG = {
  API_URL:    "https://smsportal.hostpinnacle.co.ke/SMSApi/send",
  USERID:     process.env.HP_SMS_USERID    || "",
  PASSWORD:   process.env.HP_SMS_PASSWORD  || "",
  APIKEY:     process.env.HP_SMS_APIKEY    || "",
  SENDER_ID:  process.env.HP_SMS_SENDERID  || "",
  MAX_LENGTH: 400,
};

export interface SmsSendOptions {
  /** One number or a pre-joined comma-separated string of numbers. */
  mobile:          string;
  message:         string;
  senderId?:       string;
  duplicateCheck?: boolean;
}

export interface SmsSendResult {
  success: boolean;
  raw?:    unknown;
  error?:  string;
}

export function normalizeSmsPhone(raw: string): string {
  const clean = (raw || "").replace(/[\s\-\+]/g, "");
  if (clean.startsWith("2540")) return "254" + clean.substring(4);
  if (clean.startsWith("254"))  return clean;
  if (clean.startsWith("0"))    return "254" + clean.substring(1);
  if (clean.startsWith("7") || clean.startsWith("1")) return "254" + clean;
  return clean;
}

export function sanitizeSmsText(text: string): string {
  // Preserve \n as a real newline placeholder before collapsing spaces
  const stripped = text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/gu, "")  // allow \n through
    .replace(/[^\S\n]+/g, " ")                   // collapse spaces but NOT newlines
    .replace(/\n{3,}/g, "\n\n")                  // max 2 consecutive newlines
    .trim();

  return stripped.length > SMS_CONFIG.MAX_LENGTH
    ? stripped.substring(0, SMS_CONFIG.MAX_LENGTH - 3) + "..."
    : stripped;
}

// Mirrors LINK_PATTERN in src/types.ts (containsLink/stripLinks) — this is the final,
// server-side checkpoint before anything actually reaches HostPinnacle. Links are never
// allowed in outbound SMS, scheduled or immediate.
const LINK_PATTERN = /((https?:\/\/|www\.)\S+)|(\b[a-z0-9-]+\.(com|co\.ke|ke|org|net|info|xyz|link|io|me|ly|app|shop)\b\S*)/gi;

export function containsLink(text: string): boolean {
  LINK_PATTERN.lastIndex = 0;
  return LINK_PATTERN.test(text);
}

export async function sendHostPinnacleSms(opts: SmsSendOptions): Promise<SmsSendResult> {
  try {
    if (!SMS_CONFIG.USERID || !SMS_CONFIG.APIKEY) {
      console.warn("HostPinnacle SMS credentials not configured — skipping SMS.");
      return { success: false, error: "SMS credentials not configured" };
    }

    const params = new URLSearchParams({
      userid:         SMS_CONFIG.USERID,
      password:       SMS_CONFIG.PASSWORD,
      sendMethod:     "quick",
      mobile:         opts.mobile,
      msg:            opts.message,
      senderid:       opts.senderId || SMS_CONFIG.SENDER_ID,
      msgType:        "text",
      duplicatecheck: opts.duplicateCheck === false ? "false" : "true",
      output:         "json",
    });

    const response = await axios.post(
      SMS_CONFIG.API_URL,
      params.toString(),
      {
        headers: {
          "apikey":       SMS_CONFIG.APIKEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10_000,
      },
    );

    const data = response.data;
    console.log(`HostPinnacle SMS response for ${opts.mobile}:`, JSON.stringify(data));

    const isError =
      data?.status === "error" ||
      data?.ErrorCode !== undefined ||
      (typeof data?.status === "string" && data.status.toLowerCase().includes("fail"));

    if (isError) {
      return { success: false, raw: data, error: data?.message || "API error" };
    }

    return { success: true, raw: data };
  } catch (err: any) {
    const msg = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`HostPinnacle SMS send error for ${opts.mobile}:`, msg);
    return { success: false, error: msg };
  }
}
