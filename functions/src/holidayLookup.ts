import * as admin from "firebase-admin";
import { HolidayPeriodRange } from "./kenyanHolidays";

/** All of a school's custom holiday periods that overlap [rangeStart, rangeEnd] (inclusive). */
export async function getHolidayRangesOverlapping(
  db: admin.firestore.Firestore,
  schoolId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<HolidayPeriodRange[]> {
  // Firestore can't express "startDate <= rangeEnd AND endDate >= rangeStart" in one query
  // without a composite range on two different fields, so fetch by startDate <= rangeEnd and
  // filter the endDate >= rangeStart half in memory. Holiday-period counts per school are
  // small (single digits to low tens per year), so this is cheap.
  const snap = await db.collection("schoolHolidays")
    .where("schoolId", "==", schoolId)
    .where("startDate", "<=", rangeEnd)
    .get();
  return snap.docs
    .map(d => d.data() as { startDate: string; endDate: string })
    .filter(h => h.endDate >= rangeStart)
    .map(h => ({ startDate: h.startDate, endDate: h.endDate }));
}

/** A school's custom holiday periods covering a single date. */
export async function getHolidayRangesForDate(
  db: admin.firestore.Firestore,
  schoolId: string,
  dateStr: string,
): Promise<HolidayPeriodRange[]> {
  return getHolidayRangesOverlapping(db, schoolId, dateStr, dateStr);
}
