import { onCall, CallableRequest, HttpsError } from "firebase-functions/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import axios from "axios";

if (!admin.apps.length) {
  admin.initializeApp();
}


const db = admin.firestore();


const PAYSTACK_SECRET_KEY = defineSecret('PAYSTACK_SECRET_KEY');
const PAYSTACK_API_BASE = "https://api.paystack.co";



// ─── Config ───────────────────────────────────────────────────────────────────
 
const SMS_CONFIG = {
  API_URL:    "https://smsportal.hostpinnacle.co.ke/SMSApi/send",
  USERID:     process.env.HP_SMS_USERID    || "",
  PASSWORD:   process.env.HP_SMS_PASSWORD  || "",
  APIKEY:     process.env.HP_SMS_APIKEY    || "",
  SENDER_ID:  process.env.HP_SMS_SENDERID  || "",
  MAX_LENGTH: 400,
};
 
// ─── Types ────────────────────────────────────────────────────────────────────
 
interface SmsSendOptions {
  /** One number or a pre-joined comma-separated string of numbers. */
  mobile:          string;
  message:         string;
  senderId?:       string;
  duplicateCheck?: boolean;
}
 
interface SmsSendResult {
  success: boolean;
  raw?:    unknown;
  error?:  string;
}
 
interface SendSmsRequest {
  /** Single phone number or array of phone numbers. */
  phone:           string | string[];
  message:         string;
  senderId?:       string;
  duplicateCheck?: boolean;
  schoolId:        string;
  schoolName:      string;
}
 
interface SendSmsResponse {
  success:        boolean;
  message:        string;
  reference:      string;
  recipientCount: number;
  raw?:           unknown;
}
 
// ─── Utils ────────────────────────────────────────────────────────────────────
 
function normalizeSmsPhone(raw: string): string {
  const clean = raw.replace(/[\s\-\+]/g, "");
  if (clean.startsWith("254"))                         return clean;
  if (clean.startsWith("0"))                           return "254" + clean.substring(1);
  if (clean.startsWith("7") || clean.startsWith("1")) return "254" + clean;
  return clean;
}
 
function sanitizeSmsText(text: string): string {
  const stripped = text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
 
  return stripped.length > SMS_CONFIG.MAX_LENGTH
    ? stripped.substring(0, SMS_CONFIG.MAX_LENGTH - 3) + "..."
    : stripped;
}
 
async function sendHostPinnacleSms(opts: SmsSendOptions): Promise<SmsSendResult> {
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
 
// ─── Cloud Function ───────────────────────────────────────────────────────────
 
export const sendSms = onCall(
  {
    timeoutSeconds: 30,
    memory:         "256MiB",
    maxInstances:   10,
    region:         "africa-south1",
    cors:           true,
  },
  async (request: CallableRequest<SendSmsRequest>): Promise<SendSmsResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }
 
    const userId = request.auth.uid;
    const { phone, message, senderId, duplicateCheck, schoolId, schoolName } = request.data;
 
    if (!phone || (Array.isArray(phone) && phone.length === 0) || !message?.trim() || !schoolId) {
      throw new HttpsError("invalid-argument", "phone, message, and schoolId are required.");
    }
 
    // Normalise to array, deduplicate, then join for HostPinnacle bulk format
    const rawPhones       = Array.isArray(phone) ? phone : [phone];
    const normalizedPhones = [...new Set(rawPhones.map(normalizeSmsPhone))];
    const mobileParam     = normalizedPhones.join(",");
 
    const sanitizedMessage = sanitizeSmsText(message);
 
    if (!sanitizedMessage) {
      throw new HttpsError("invalid-argument", "Message is empty after sanitisation.");
    }
 
    const reference = `SMS_${userId}_${Date.now()}`;
    const logRef    = db.collection("sms-logs").doc(reference);
 
    await logRef.set({
      reference,
      userId,
      schoolId,
      schoolName:     schoolName || null,
      phones:         normalizedPhones,
      recipientCount: normalizedPhones.length,
      message:        sanitizedMessage,
      senderId:       senderId || SMS_CONFIG.SENDER_ID,
      status:         "pending",
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    });
 
    const result = await sendHostPinnacleSms({
      mobile:         mobileParam,
      message:        sanitizedMessage,
      senderId,
      duplicateCheck,
    });
 
    await logRef.update({
      status:    result.success ? "sent" : "failed",
      raw:       result.raw   ?? null,
      error:     result.error ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
 
    if (!result.success) {
      console.error(`SMS failed [${reference}]:`, result.error);
      throw new HttpsError("internal", `SMS delivery failed: ${result.error || "Unknown error"}`);
    }
 
    console.log(`SMS sent [${reference}] → ${normalizedPhones.length} recipient(s)`);
 
    return {
      success:        true,
      message:        `SMS sent to ${normalizedPhones.length} recipient(s).`,
      reference,
      recipientCount: normalizedPhones.length,
      raw:            result.raw,
    };
  },
);
 
















interface ChargeSmsTopUpRequest {
  phone:    string;   // customer M-Pesa phone
  tokens:   number;   // tokens being purchased
  amountKes: number;  // KES amount (client should derive from tier, but we re-validate server-side)
  tier:     'small' | 'medium' | 'large';
  userId:   string;
  schoolId: string;
  schoolName: string;
}
 
/**
 * KES rate per token (must mirror frontend types.ts)
 */
const KES_RATE_PER_TOKEN: Record<'small'|'medium'|'large', number> = {
  small:  0.7,
  medium: 0.5,
  large:  0.4,
};
 
export const chargeSmsTopUp = onCall({
  timeoutSeconds: 60,
  memory: "512MiB",
  maxInstances: 10,
  region: "africa-south1",
  cors: true,
  secrets: [PAYSTACK_SECRET_KEY],
}, async (request: CallableRequest<ChargeSmsTopUpRequest>) => {
  try {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const userId = request.auth.uid;
    const email = request.auth.token.email || `${userId}@myregister.co.ke`; // fallback to userId;
 
    const { phone, tokens, tier, schoolId, schoolName } = request.data;
 
    // Server-side re-derive amount so the client can't fake a lower price
    const expectedKes = Math.round(tokens * KES_RATE_PER_TOKEN[tier] * 100) / 100;
    const amountKes   = expectedKes; // ignore whatever the client sent
 
    if (!phone || !tokens || tokens < 1 || !tier || !userId || !schoolId) {
      throw new HttpsError("invalid-argument", "phone, tokens, tier, userId, and schoolId are required");
    }
 
    // Normalise phone to +254XXXXXXXXX
    let formattedPhone = phone.replace(/[\s\-]/g, '');
    if (formattedPhone.startsWith('+254')) {
      // already good
    } else if (formattedPhone.startsWith('254')) {
      formattedPhone = '+' + formattedPhone;
    } else if (formattedPhone.startsWith('0')) {
      formattedPhone = '+254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('7') || formattedPhone.startsWith('1')) {
      formattedPhone = '+254' + formattedPhone;
    }
 
    const amountInCents = Math.round(amountKes * 100);
    const reference     = `SMS_${userId}_${Date.now()}`;
 
    const chargePayload = {
      email:    email,   // Paystack requires an email
      amount:   amountInCents,
      currency: "KES",
      mobile_money: {
        phone:    formattedPhone,
        provider: "mpesa",
      },
      reference,
      metadata: {
        chargeType:  "sms_topup",
        targetProject: "project2",            // ← tells webhook to settle in project 2
        userId,
        schoolId,
        schoolName,
        tokens,
        tier,
        amountKes,
        phone: formattedPhone,
      },
    };
 
    console.log("SMS top-up charge request:", JSON.stringify(chargePayload, null, 2));
 
    const paystackResponse = await axios.post(
      `${PAYSTACK_API_BASE}/charge`,
      chargePayload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}`,
          "Content-Type": "application/json",
        },
      }
    );
 
    if (!paystackResponse.data.status) {
      throw new HttpsError("internal", `Paystack error: ${paystackResponse.data.message}`);
    }
 
    const txData = paystackResponse.data.data;
 
    // Write a pending record to project-2 Firestore
    await db.collection("sms-topup-transactions").doc(reference).set({
      reference,
      userId,
      schoolId,
      schoolName,
      tokens,
      tier,
      amountKes,
      phone: formattedPhone,
      status: txData.status || "pending",
      displayText: txData.display_text || null,
      accountReference: txData.account_reference || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
 
    console.log(`SMS top-up initiated: ${reference}, status: ${txData.status}`);
 
    return {
      success:     true,
      message:     "M-Pesa STK push sent",
      data: {
        reference,
        status:      txData.status,
        displayText: txData.display_text || "Check your phone for the M-Pesa prompt",
        accountReference: txData.account_reference,
      },
    };
  } catch (error: any) {
    console.error("Error in chargeSmsTopUp:", error);
    if (error.response) {
      console.error("Paystack error response:", error.response.data);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to charge: ${error.response?.data?.message || error.message}`);
  }
});
