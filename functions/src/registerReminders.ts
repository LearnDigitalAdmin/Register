import { onSchedule } from "firebase-functions/scheduler";
import * as admin from "firebase-admin";
import { isDateBlockedForSchool, todayEAT, BoardingType } from "./kenyanHolidays";
import { sendHostPinnacleSms, normalizeSmsPhone, HP_SMS_USERID, HP_SMS_PASSWORD, HP_SMS_APIKEY, HP_SMS_SENDERID } from "./smsSender";
import { getHolidayRangesForDate } from "./holidayLookup";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function sendReminderSms(mobile: string, message: string): Promise<void> {
  if (!mobile) return;
  const result = await sendHostPinnacleSms({ mobile, message });
  if (!result.success) {
    console.error(`Register-reminder SMS failed for ${mobile}:`, result.error);
  }
}

interface SchoolDoc {
  id: string;
  name: string;
  boardingType?: BoardingType;
  adminUid: string;
  adminPhone?: string;
  phone?: string;
}
interface ClassStructureDoc { classes: string[] }
interface TeacherAssignmentDoc { teacherUid: string; teacherName: string; classCode: string; active: boolean }
interface UserDoc { displayName: string; phone?: string | null; role: string }

/**
 * Every class, at every school, that doesn't have a `registers` doc for today yet — skipping
 * day schools entirely on weekends/public holidays (boarding schools are always checked).
 */
async function findUnmarkedClassesBySchool(): Promise<Map<string, { school: SchoolDoc; classes: string[] }>> {
  const today = todayEAT();
  const result = new Map<string, { school: SchoolDoc; classes: string[] }>();

  const schoolsSnap = await db.collection("schools").get();
  for (const schoolDoc of schoolsSnap.docs) {
    const school = { id: schoolDoc.id, ...(schoolDoc.data() as any) } as SchoolDoc;
    const customHolidays = await getHolidayRangesForDate(db, school.id, today);
    const blocked = isDateBlockedForSchool(today, school.boardingType, customHolidays);
    if (blocked.blocked) continue;

    const structureSnap = await db.collection("classStructures").doc(school.id).get();
    const classes = (structureSnap.data() as ClassStructureDoc | undefined)?.classes || [];
    if (classes.length === 0) continue;

    const unmarked: string[] = [];
    for (const classCode of classes) {
      const regId = `${school.id}_${classCode}_${today}`.replace(/\s/g, "_");
      const regSnap = await db.collection("registers").doc(regId).get();
      if (!regSnap.exists) unmarked.push(classCode);
    }
    if (unmarked.length > 0) result.set(school.id, { school, classes: unmarked });
  }
  return result;
}

/**
 * 10:00 EAT daily — soft reminder. A teacher with several unmarked classes gets ONE SMS
 * listing all of them, not one per class; each school gets ONE consolidated SMS to its admin
 * listing every unmarked class school-wide. This bundling is deliberate — see issue #7's
 * "avoid spamming" requirement.
 */
export const registerReminder10am = onSchedule(
  { schedule: "0 10 * * *", timeZone: "Africa/Nairobi", region: "europe-west1", memory: "256MiB", timeoutSeconds: 300, secrets: [HP_SMS_USERID, HP_SMS_PASSWORD, HP_SMS_APIKEY, HP_SMS_SENDERID] },
  async () => {
    const bySchool = await findUnmarkedClassesBySchool();

    for (const [schoolId, { school, classes }] of bySchool) {
      // Teachers — bundled per teacher. Firestore `in` supports up to 30 values; schools with
      // more unmarked classes than that in one day are effectively not using registers at all,
      // so the first 30 is a reasonable cap rather than a real limitation.
      const assignSnap = await db.collection("teacherAssignments")
        .where("schoolId", "==", schoolId)
        .where("active", "==", true)
        .where("classCode", "in", classes.slice(0, 30))
        .get();

      const byTeacher = new Map<string, { name: string; classes: string[] }>();
      assignSnap.docs.forEach(d => {
        const a = d.data() as TeacherAssignmentDoc;
        const entry = byTeacher.get(a.teacherUid) || { name: a.teacherName, classes: [] };
        entry.classes.push(a.classCode);
        byTeacher.set(a.teacherUid, entry);
      });

      for (const [teacherUid, info] of byTeacher) {
        const userSnap = await db.collection("users").doc(teacherUid).get();
        const teacher = userSnap.data() as UserDoc | undefined;
        if (!teacher?.phone) continue;
        const msg = `MyRegister: today's register for ${info.classes.join(', ')} at ${school.name} isn't marked yet. Please mark it when you can.`;
        await sendReminderSms(normalizeSmsPhone(teacher.phone), msg);
      }

      // Admin(s) — one consolidated SMS, not one per unmarked class.
      const adminPhone = school.adminPhone || school.phone;
      if (adminPhone) {
        const msg = `MyRegister: ${classes.length} class(es) at ${school.name} haven't marked today's register — ${classes.join(', ')}.`;
        await sendReminderSms(normalizeSmsPhone(adminPhone), msg);
      }
    }

    console.log(`registerReminder10am: ${bySchool.size} school(s) had unmarked classes.`);
  },
);

/**
 * 12:00 EAT daily — anything STILL unmarked is written as an explicit `unmarked` register
 * (locked: false, autoUnmarked: true) rather than left silently blank or assumed present.
 * `locked: false` means a teacher can still mark it properly later in the day — this only
 * records that it was NOT marked in time, it doesn't close the class out.
 */
export const registerFinaliseUnmarkedNoon = onSchedule(
  { schedule: "0 12 * * *", timeZone: "Africa/Nairobi", region: "europe-west1", memory: "256MiB", timeoutSeconds: 300 },
  async () => {
    const bySchool = await findUnmarkedClassesBySchool();
    const today = todayEAT();
    let written = 0;

    for (const [schoolId, { classes }] of bySchool) {
      for (const classCode of classes) {
        const regId = `${schoolId}_${classCode}_${today}`.replace(/\s/g, "_");
        const regRef = db.collection("registers").doc(regId);
        // Re-check right before writing — a teacher may have marked it between the scan above
        // and this write running.
        const regSnap = await regRef.get();
        if (regSnap.exists) continue;

        const studentsSnap = await db.collection("students")
          .where("schoolId", "==", schoolId).where("classCode", "==", classCode).get();
        const total = studentsSnap.size;

        await regRef.set({
          date: today, classCode, schoolId,
          savedBy: "system", savedAt: new Date().toISOString(),
          locked: false, present: 0, absent: 0, late: 0, excused: 0, unmarked: total, total,
          autoUnmarked: true,
        });

        const batch = db.batch();
        studentsSnap.docs.forEach(sdoc => {
          const s = sdoc.data() as any;
          const attRef = db.collection("attendance").doc(`${regId}_${sdoc.id}`);
          batch.set(attRef, {
            studentId: sdoc.id, studentName: s.name, admissionNo: s.admissionNo,
            date: today, classCode, schoolId,
            status: "unmarked", note: "",
            savedBy: "system", savedAt: new Date().toISOString(), locked: false,
            autoUnmarked: true,
          });
        });
        await batch.commit();
        written++;
      }
    }

    console.log(`registerFinaliseUnmarkedNoon: wrote ${written} unmarked register(s).`);
  },
);
