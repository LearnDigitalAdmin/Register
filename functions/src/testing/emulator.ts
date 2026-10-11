import * as admin from "firebase-admin";

/** True only when the Firestore emulator is running (`firebase emulators:exec --only firestore "..."`). */
export const emulatorEnabled = !!process.env.FIRESTORE_EMULATOR_HOST;

export function initEmulatorApp(): admin.firestore.Firestore {
  if (!emulatorEnabled) throw new Error("Firestore emulator is not running.");
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-register" });
  return admin.firestore();
}

export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT || "demo-register";
  const res = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Could not clear the emulator (${res.status}).`);
}
