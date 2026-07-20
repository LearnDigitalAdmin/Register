import { onSchedule } from "firebase-functions/scheduler";
import * as admin from "firebase-admin";
import axios from "axios";
import { isRegisterRequired, todayEAT, BoardingType } from "./kenyanHolidays";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Same HostPinnacle credentials as the `sendSms` callable in index.ts, read from the same
// env vars — kept self-contained here (rather than importing from index.ts) to avoid a
// circular import between the two files.
const SMS_CONFIG = {
  API_URL:   "https://smsportal.hostpinnacle.co.ke/SMSApi/send",
  USERID:    process.env.HP_SMS_USERID   || "",
  PASSWORD:  process.env.HP_SMS_PASSWORD || "",
  APIKEY:    process.env.HP_SMS_APIKEY   || "",
  SENDER_ID: process.env.HP_SMS_SENDERID || "",
};

function normalizeSmsPhone(raw: string): string {
  const clean = (raw || "").replace(/[\s\-\+]/g, "");
  if (clean.startsWith("2540")) return "254" + clean.substring(4);
  if (clean.startsWith("254"))  return clean;
  if (clean.startsWith("0"))    return "254" + clean.substring(1);
  if (clean.startsWith("7") || clean.startsWith("1")) return "254" + clean;
  return clean;
}

async function sendReminderSms(mobile: string, message: string): Promise<void> {
  if (!mobile) return;
  if (!SMS_CONFIG.USERID || !SMS_CONFIG.APIKEY) {
    console.warn("HostPinnacle SMS credentials not configured — skipping register-reminder SMS.");
    return;
  }
  try {
    const params = new URLSearchParams({
      userid: SMS_CONFIG.USERID, password: SMS_CONFIG.PASSWORD, sendMethod: "quick",
      mobile, msg: message, senderid: SMS_CONFIG.SENDER_ID, msgType: "text",
      duplicatecheck: "true", output: "json",
    });
    await axios.post(SMS_CONFIG.API_URL, params.toString(), {
      headers: { apikey: SMS_CONFIG.APIKEY, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10_000,
    });
  } catch (err: any) {
    console.error(`Register-reminder SMS failed for ${mobile}:`, err?.response?.data || err.message);
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
    const availability = isRegisterRequired(today, school.boardingType);
    if (!availability.required) continue;

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
  { schedule: "0 10 * * *", timeZone: "Africa/Nairobi", region: "europe-west1", memory: "256MiB", timeoutSeconds: 300 },
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
