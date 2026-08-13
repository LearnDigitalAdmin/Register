import * as admin from "firebase-admin";
import { ScheduleAudienceType } from "./scheduleTypes";

export interface AudienceInput {
  schoolId: string;
  audienceType: ScheduleAudienceType;
  classCode?: string;
  recipientUids?: string[];        // teachers_selected
  recipientStudentIds?: string[];  // parents_selected
}

export interface ResolvedRecipient {
  phone: string;
  name: string; // teacher's displayName, or the student's parentName
}

/** Recipient count only — used for token-cost estimation at create/edit time, cheaper
 * than resolving full phone lists. */
export async function resolveRecipientCount(
  db: admin.firestore.Firestore,
  input: AudienceInput,
): Promise<number> {
  const { schoolId, audienceType, classCode, recipientUids, recipientStudentIds } = input;

  switch (audienceType) {
    case "teachers_selected":
      return recipientUids?.length ?? 0;

    case "teachers_all": {
      const snap = await db.collection("users")
        .where("schoolId", "==", schoolId)
        .where("role", "==", "teacherAdmin")
        .get();
      return snap.size;
    }

    case "parents_selected":
      return recipientStudentIds?.length ?? 0;

    case "parents_class": {
      if (!classCode) return 0;
      const snap = await db.collection("students")
        .where("schoolId", "==", schoolId)
        .where("classCode", "==", classCode)
        .get();
      return snap.docs.filter(d => !!(d.data() as any).parentPhone?.trim()).length;
    }

    case "parents_school":
    case "holiday_notice": {
      if (classCode) {
        const snap = await db.collection("students")
          .where("schoolId", "==", schoolId)
          .where("classCode", "==", classCode)
          .get();
        return snap.docs.filter(d => !!(d.data() as any).parentPhone?.trim()).length;
      }
      const snap = await db.collection("students").where("schoolId", "==", schoolId).get();
      return snap.docs.filter(d => !!(d.data() as any).parentPhone?.trim()).length;
    }
  }
}

/** Full recipient list (phone + display name) — used by the poller at actual send time. */
export async function resolveRecipients(
  db: admin.firestore.Firestore,
  input: AudienceInput,
): Promise<ResolvedRecipient[]> {
  const { schoolId, audienceType, classCode, recipientUids, recipientStudentIds } = input;

  switch (audienceType) {
    case "teachers_selected": {
      if (!recipientUids?.length) return [];
      const docs = await Promise.all(recipientUids.map(uid => db.collection("users").doc(uid).get()));
      return docs
        .filter(d => d.exists && (d.data() as any).phone)
        .map(d => ({ phone: (d.data() as any).phone as string, name: (d.data() as any).displayName || "Teacher" }));
    }

    case "teachers_all": {
      const snap = await db.collection("users")
        .where("schoolId", "==", schoolId)
        .where("role", "==", "teacherAdmin")
        .get();
      return snap.docs
        .filter(d => !!(d.data() as any).phone)
        .map(d => ({ phone: (d.data() as any).phone as string, name: (d.data() as any).displayName || "Teacher" }));
    }

    case "parents_selected": {
      if (!recipientStudentIds?.length) return [];
      const docs = await Promise.all(recipientStudentIds.map(id => db.collection("students").doc(id).get()));
      return docs
        .filter(d => d.exists && (d.data() as any).parentPhone?.trim())
        .map(d => ({ phone: (d.data() as any).parentPhone as string, name: (d.data() as any).parentName || "Parent" }));
    }

    case "parents_class": {
      if (!classCode) return [];
      const snap = await db.collection("students")
        .where("schoolId", "==", schoolId)
        .where("classCode", "==", classCode)
        .get();
      return snap.docs
        .filter(d => !!(d.data() as any).parentPhone?.trim())
        .map(d => ({ phone: (d.data() as any).parentPhone as string, name: (d.data() as any).parentName || "Parent" }));
    }

    case "parents_school":
    case "holiday_notice": {
      let q = db.collection("students").where("schoolId", "==", schoolId) as admin.firestore.Query;
      if (classCode) q = q.where("classCode", "==", classCode);
      const snap = await q.get();
      return snap.docs
        .filter(d => !!(d.data() as any).parentPhone?.trim())
        .map(d => ({ phone: (d.data() as any).parentPhone as string, name: (d.data() as any).parentName || "Parent" }));
    }
  }
}
