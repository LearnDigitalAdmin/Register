// ============================================================================
// FILE: src/services/smsPayment.ts   (NEW FILE – add to your project)
//
// Wraps the chargeSmsTopUp Cloud Function call.
// ============================================================================
 
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../firebase";
 
const functions = getFunctions(app, "africa-south1");
 
export interface SmsTopUpPayload {
  phone:     string;
  tokens:    number;
  amountKes: number;
  tier:      "small" | "medium" | "large";
  //userId:    string;
  schoolId:  string;
  schoolName: string;
}
 
export interface SmsTopUpResult {
  success:          boolean;
  message:          string;
  data: {
    reference:        string;
    status:           string;
    displayText:      string;
    accountReference: string | null;
  };
}
 
/**
 * Initiate a real M-Pesa STK push for SMS token purchase.
 * Throws an Error (with a user-readable message) on failure.
 */
export async function initiateSmsTopUp(payload: SmsTopUpPayload): Promise<SmsTopUpResult> {
  const fn = httpsCallable<SmsTopUpPayload, SmsTopUpResult>(functions, "chargeSmsTopUp");
  const result = await fn(payload);
  return result.data;
}
 
/**
 * Poll Firestore (project-2) for transaction status.
 * The caller should invoke this every ~3 s while waiting.
 * We read from the client-facing project-2 app (same Firestore you expose
 * via your normal firebase.ts – if project-2 is a different Firebase project
 * you will need a second initializeApp here).
 */
export type TopUpStatus = "pending" | "success" | "failed" | "unknown";
 
import { getFirestore, doc, getDoc } from "firebase/firestore";
 
// ⚠️  If your MyRegister frontend app already points at project-2's Firebase
//     config in src/firebase.ts, just use `db` from there.
//     Otherwise initialise a second app here pointing at project-2.
import { db } from "../firebase";
 
export async function pollTopUpStatus(reference: string): Promise<TopUpStatus> {
  try {
    const snap = await getDoc(doc(db, "sms-topup-transactions", reference));
    if (!snap.exists()) return "pending";
    return (snap.data()?.status as TopUpStatus) ?? "unknown";
  } catch {
    return "unknown";
  }
}