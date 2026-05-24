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
