import { onDocumentUpdated } from "firebase-functions/firestore";
import * as admin from "firebase-admin";
import { ScheduledMessage } from "./scheduleTypes";
import { sendHostPinnacleSms, HP_SMS_USERID, HP_SMS_PASSWORD, HP_SMS_APIKEY, HP_SMS_SENDERID } from "./smsSender";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface UserDoc {
  messageTokens: number;
  phone?: string | null;
  displayName?: string;
}

/** Tries to reserve up to `want` more tokens from uid's current balance in one transaction.
 * Returns however much it actually reserved (0 if the balance is exhausted). */
async function reserveMore(uid: string, want: number): Promise<number> {
  if (want <= 0) return 0;
  return db.runTransaction(async (tx) => {
    const ref = db.collection("users").doc(uid);
    const snap = await tx.get(ref);
    if (!snap.exists) return 0;
    const balance = (snap.data() as UserDoc).messageTokens || 0;
    const reserve = Math.min(balance, want);
    if (reserve > 0) tx.update(ref, { messageTokens: balance - reserve });
    return reserve;
  });
}

export const recheckInsufficientSchedulesOnTopUp = onDocumentUpdated(
  { document: "users/{uid}", region: "africa-south1", memory: "256MiB", timeoutSeconds: 120, secrets: [HP_SMS_USERID, HP_SMS_PASSWORD, HP_SMS_APIKEY, HP_SMS_SENDERID] },
  async (event) => {
    const before = event.data?.before.data() as UserDoc | undefined;
    const after = event.data?.after.data() as UserDoc | undefined;
    if (!before || !after) return;

    const balanceIncreased = (after.messageTokens || 0) > (before.messageTokens || 0);
    if (!balanceIncreased) return;

    const uid = event.params.uid;
    const pendingSnap = await db.collection("scheduledMessages")
      .where("fundingSourceUid", "==", uid)
      .where("status", "==", "insufficientTokens")
      .get();

    if (pendingSnap.empty) return;

    for (const doc of pendingSnap.docs) {
      const schedule = doc.data() as ScheduledMessage;
      const shortfall = schedule.tokensRequired - schedule.tokensAllocated;
      if (shortfall <= 0) {
        // Already fully funded somehow — just clear the flag.
        await doc.ref.update({ insufficientTokens: false, status: "active", updatedAt: new Date().toISOString() });
        continue;
      }

      const reserved = await reserveMore(uid, shortfall);
      if (reserved <= 0) continue; // still nothing available — leave flagged for next top-up

      const newAllocated = schedule.tokensAllocated + reserved;
      const nowFullyFunded = newAllocated >= schedule.tokensRequired;

      await doc.ref.update({
        tokensAllocated: newAllocated,
        insufficientTokens: !nowFullyFunded,
        status: nowFullyFunded ? "active" : "insufficientTokens",
        // Nudge nextRunAt to right now so the next poller pass picks it straight up —
        // the poller itself decides whether "now" is still a valid send moment.
        nextRunAt: nowFullyFunded ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      });

      if (nowFullyFunded && after.phone) {
        await sendHostPinnacleSms({
          mobile: after.phone,
          message: `MyRegister: your scheduled message is now fully funded after your top-up and will resume shortly.`,
        });
      }
    }
  },
);
