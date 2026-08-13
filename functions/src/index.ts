import { onCall, CallableRequest, HttpsError } from "firebase-functions/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import axios from "axios";
import { sendHostPinnacleSms, normalizeSmsPhone as sharedNormalizeSmsPhone, sanitizeSmsText as sharedSanitizeSmsText, containsLink as sharedContainsLink, SMS_CONFIG as SHARED_SMS_CONFIG } from "./smsSender";

export { registerReminder10am, registerFinaliseUnmarkedNoon } from "./registerReminders";
export { scanSchoolForConflicts, onStudentWrittenCheckConflicts } from "./conflicts";
export { scheduledMessagesPoller } from "./scheduledMessagesPoller";
export { createScheduledMessage, editScheduledMessage, stopScheduledMessage, rescheduleCompletedMessage, deleteScheduledMessage, resetSchedulesForNewAcademicYear } from "./scheduleManagement";
export { allocateTokensToTeachers } from "./tokenAllocation";
export { recheckInsufficientSchedulesOnTopUp } from "./insufficientTokensRecheck";

if (!admin.apps.length) {
  admin.initializeApp();
}


const db = admin.firestore();


const PAYSTACK_SECRET_KEY = defineSecret('PAYSTACK_SECRET_KEY');
const PAYSTACK_API_BASE = "https://api.paystack.co";



// ─── Config ───────────────────────────────────────────────────────────────────
// SMS_CONFIG, sendHostPinnacleSms, normalizeSmsPhone, sanitizeSmsText, and containsLink now
// live in ./smsSender.ts (shared with registerReminders.ts and scheduledMessagesPoller.ts).
// Local aliases below keep the rest of this file's code unchanged.
const SMS_CONFIG = SHARED_SMS_CONFIG;
const normalizeSmsPhone = sharedNormalizeSmsPhone;
const sanitizeSmsText = sharedSanitizeSmsText;
const containsLink = sharedContainsLink;
 
// ─── Types ────────────────────────────────────────────────────────────────────
// SmsSendOptions/SmsSendResult now live in ./smsSender.ts.
 
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
// normalizeSmsPhone, sanitizeSmsText, containsLink, and sendHostPinnacleSms are now
// imported from ./smsSender.ts (aliased above) — this file no longer keeps its own copy.
 
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

    if (containsLink(sanitizedMessage)) {
      throw new HttpsError(
        "invalid-argument",
        "Links are not allowed in parent messages. Remove any URLs and try again.",
      );
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
