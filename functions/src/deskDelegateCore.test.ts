import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DelegateFault, parseDelegateRequest, requestDocId, importStudentId, decideIdempotency, parseAudience, audienceOptions,
  prepareBody, parentBroadcastText, quoteSend, chunk, smsTier, parseAtNairobi, parseSchedule, planImport, rowErrors, validRecord,
  toCsv, safeFileName, parseReportParams, DelegateLogDoc,
} from "./deskDelegateCore";
import { validateRows } from "./shared/importValidation";

const clean = (t: string) => t.replace(/[^\x20-\x7E\n]/g, "").trim();
const noLink = (t: string) => /https?:\/\/|www\./i.test(t);
const fault = (code: string, re?: RegExp) => (e: unknown) => e instanceof DelegateFault && e.code === code && (!re || re.test(e.message));
const goodReq = { action: "entity_info", entityCode: " 12345 ", agentCode: "cog-0042", requestId: "req-12345678", payload: {} };

test("a valid envelope is normalised", () => {
  assert.deepEqual(parseDelegateRequest(goodReq), { action: "entity_info", entityCode: "12345", agentCode: "COG-0042", requestId: "req-12345678", payload: {} });
});

test("bad envelopes are refused with invalid_argument", () => {
  for (const bad of [null, [], { ...goodReq, action: "drop_tables" }, { ...goodReq, entityCode: "a b/c" }, { ...goodReq, agentCode: "AGT-1" },
    { ...goodReq, requestId: "short" }, { ...goodReq, payload: [] }]) {
    assert.throws(() => parseDelegateRequest(bad), fault("invalid_argument"));
  }
  assert.deepEqual(parseDelegateRequest({ ...goodReq, payload: undefined }).payload, {});
});

test("ids are deterministic and request-scoped", () => {
  assert.equal(requestDocId("a:b"), requestDocId("a:b"));
  assert.notEqual(requestDocId("a:b"), requestDocId("a:c"));
  assert.equal(importStudentId("r1", 3), importStudentId("r1", 3));
  assert.notEqual(importStudentId("r1", 3), importStudentId("r1", 4));
  assert.notEqual(importStudentId("r1", 3), importStudentId("r2", 3));
});

test("idempotency: new, replay, busy, resume and mismatched reuse", () => {
  const expect = { action: "send_sms_now" as const, entityCode: "1", agentCode: "COG-0001" };
  const doc = (over: Partial<DelegateLogDoc>): DelegateLogDoc => ({ requestId: "r", ...expect, status: "processing", startedAt: 0, updatedAt: 0, ...over });
  assert.deepEqual(decideIdempotency(undefined, expect, 1000), { kind: "new" });
  assert.deepEqual(decideIdempotency(doc({ status: "done", result: { queued: 3 } }), expect, 1000), { kind: "replay", result: { queued: 3 } });
  assert.deepEqual(decideIdempotency(doc({ updatedAt: 950 }), expect, 1000), { kind: "busy" });
  assert.deepEqual(decideIdempotency(doc({ updatedAt: 0 }), expect, 500_000), { kind: "resume" });
  assert.throws(() => decideIdempotency(doc({ agentCode: "COG-0002" }), expect, 1), fault("invalid_argument", /different request/));
});

test("audiences: school, class, selected and teacher forms", () => {
  const classes = ["Grade 1", "Grade 2"];
  assert.equal(parseAudience("parents_school", undefined, classes).audienceType, "parents_school");
  assert.deepEqual(parseAudience("parents_class:Grade 2", undefined, classes), { audienceType: "parents_class", classCode: "Grade 2", teachers: false });
  assert.deepEqual(parseAudience("teachers_selected", ["u1", "u1", "u2"], classes).recipientUids, ["u1", "u2"]);
  assert.equal(parseAudience("teachers_all", undefined, classes).teachers, true);
  assert.deepEqual(audienceOptions(classes), ["parents_school", "parents_class:Grade 1", "parents_class:Grade 2", "parents_selected", "teachers_all", "teachers_selected"]);
});

test("audience mistakes are refused", () => {
  const classes = ["Grade 1"];
  assert.throws(() => parseAudience("parents_class:Form 9", undefined, classes), fault("invalid_argument", /not a class/));
  assert.throws(() => parseAudience("parents_selected", undefined, classes), fault("invalid_argument", /memberIds/));
  assert.throws(() => parseAudience("parents_selected", ["a/b"], classes), fault("invalid_argument"));
  assert.throws(() => parseAudience("parents_school", ["x"], classes), fault("invalid_argument"));
  assert.throws(() => parseAudience("everyone", undefined, classes), fault("invalid_argument", /Unknown audience/));
  assert.throws(() => parseAudience("", undefined, classes), fault("invalid_argument"));
});

test("message body: cleaned, non-empty, link-free", () => {
  assert.equal(prepareBody("  Fees due Friday ✓ ", clean, noLink), "Fees due Friday");
  assert.throws(() => prepareBody("   ", clean, noLink), fault("invalid_argument", /empty/));
  assert.throws(() => prepareBody("see www.x.co.ke", clean, noLink), fault("invalid_argument", /Links/));
  assert.throws(() => prepareBody(5, clean, noLink), fault("invalid_argument"));
});

test("parent broadcast text and token cost follow the app's rules", () => {
  const text = parentBroadcastText("Fees due Friday.", "Sunrise Academy", "0722 123 456 ext", clean);
  assert.equal(text, "Dear Parent,\nFees due Friday.\nSunrise Academy: 0722 123 456");
  const q = quoteSend(text, 10);
  assert.equal(q.segments, 1);
  assert.equal(q.tokens, 10);
  assert.equal(quoteSend("x".repeat(141), 3).tokens, 6); // 2 segments x 3 recipients
  assert.equal(quoteSend("", 5).tokens, 0);
});

test("chunking and pricing tiers", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
  assert.equal(smsTier(100).tier, "small");
  assert.equal(smsTier(101).kesPerToken, 0.5);
  assert.equal(smsTier(301).tier, "large");
});

test("schedule time: Nairobi local, offsets and invalid dates", () => {
  assert.deepEqual(parseAtNairobi("2026-11-02T08:30").date, "2026-11-02");
  assert.equal(parseAtNairobi("2026-11-02T08:30").time, "08:30");
  const z = parseAtNairobi("2026-11-02T22:30:00Z");           // 01:30 next day in Nairobi
  assert.deepEqual([z.date, z.time], ["2026-11-03", "01:30"]);
  const plus3 = parseAtNairobi("2026-11-02T08:30+03:00");
  assert.equal(plus3.epochMs, parseAtNairobi("2026-11-02T08:30").epochMs);
  assert.throws(() => parseAtNairobi("2026-02-30T08:30"), fault("invalid_argument"));
  assert.throws(() => parseAtNairobi("tomorrow"), fault("invalid_argument"));
});

test("schedules: once, daily with end date, weekly weekday rule, monthly refused, past refused", () => {
  const now = Date.UTC(2026, 9, 11);
  const base = { name: "Fee reminder", message: "Fees due Friday." };
  const once = parseSchedule({ ...base, schedule: { kind: "once", at: "2026-11-02T08:30" } }, clean, noLink, now);
  assert.deepEqual(once, { label: "Fee reminder", body: "Fees due Friday.", frequency: "once", startDate: "2026-11-02", timeOfDay: "08:30" });
  const daily = parseSchedule({ ...base, schedule: { kind: "daily", at: "2026-11-02T08:30", endDate: "2026-11-13" } }, clean, noLink, now);
  assert.equal(daily.endDate, "2026-11-13");
  // 2 Nov 2026 is a Monday (1)
  assert.equal(parseSchedule({ ...base, schedule: { kind: "weekly", at: "2026-11-02T08:30", endDate: "2026-12-01", days: [1] } }, clean, noLink, now).frequency, "weekly");
  assert.throws(() => parseSchedule({ ...base, schedule: { kind: "weekly", at: "2026-11-02T08:30", endDate: "2026-12-01", days: [2] } }, clean, noLink, now), fault("invalid_argument", /weekday/));
  assert.throws(() => parseSchedule({ ...base, schedule: { kind: "daily", at: "2026-11-02T08:30" } }, clean, noLink, now), fault("invalid_argument", /endDate/));
  assert.throws(() => parseSchedule({ ...base, schedule: { kind: "monthly", at: "2026-11-02T08:30" } }, clean, noLink, now), fault("invalid_argument", /Monthly/));
  assert.throws(() => parseSchedule({ ...base, schedule: { kind: "once", at: "2026-01-02T08:30" } }, clean, noLink, now), fault("invalid_argument", /past/));
  assert.throws(() => parseSchedule({ ...base, schedule: { kind: "daily", at: "2026-11-02T08:30", endDate: "2028-01-01" } }, clean, noLink, now), fault("invalid_argument", /one year/));
  assert.throws(() => parseSchedule({ ...base, name: "x", schedule: { kind: "once", at: "2026-11-02T08:30" } }, clean, noLink, now), fault("invalid_argument", /name/));
});

test("import: canonical columns, detected headers, and missing columns", () => {
  const canonical = planImport([{ admissionNo: 1, name: "Amina", classCode: "Grade 1" }], undefined, {});
  assert.equal(canonical.scope, "wholeSchool");
  assert.deepEqual(canonical.rows[0].values, { admissionNo: "1", name: "Amina", classCode: "Grade 1" });
  const headers = planImport([{ "Adm No": "7", "Student Name": "Joy", "Class": "Grade 2", "Phone": "0722123456" }], undefined, {});
  assert.deepEqual(headers.mapping, { admissionNo: "Adm No", name: "Student Name", classCode: "Class", parentPhone: "Phone" });
  const single = planImport([{ admissionNo: "1", name: "A" }], "Grade 1", {});
  assert.equal(single.scope, "singleClass");
  assert.throws(() => planImport([{ admissionNo: "1", name: "A" }], undefined, {}), fault("invalid_argument", /classCode/));
  assert.throws(() => planImport([], undefined, {}), fault("invalid_argument"));
  assert.throws(() => planImport(["x"], undefined, {}), fault("invalid_argument"));
  assert.throws(() => planImport(new Array(5001).fill({ admissionNo: "1" }), undefined, {}), fault("invalid_argument", /5000/));
});

test("import errors and valid records are reported in the contract's shapes", () => {
  const plan = planImport([{ admissionNo: "1", name: "A", classCode: "Grade 1", parentPhone: "12" }, { admissionNo: "2", name: "B", classCode: "grade 1", parentPhone: "+254722123456" }], undefined, {});
  const rows = validateRows(plan.rows, {
    classStructure: { levels: ["Grade 1"], classes: ["Grade 1"], streamsEnabled: false, streamMode: "none" },
    existingStudents: [], activeAcademicYearId: "y", scope: "wholeSchool",
  });
  assert.deepEqual(rowErrors(rows), [{ row: 1, field: "parentPhone", reason: "\"12\" doesn't look like a valid Kenyan phone number.", suggestion: "Use a Kenyan number such as 0722 123 456." }]);
  assert.deepEqual(validRecord(rows[1]), { admissionNo: "2", name: "B", classCode: "Grade 1", parentName: "", parentPhone: "0722123456" });
});

test("CSV quotes every cell and neutralises formulas", () => {
  assert.equal(toCsv([["a", 'b"c'], ["=SUM(A1)", "+254"]]), '"a","b""c"\r\n"\'=SUM(A1)","\'+254"');
  assert.equal(safeFileName("Sunrise Acad/emy 2026!"), "Sunrise_Acad_emy_2026");
  assert.equal(safeFileName("///"), "export");
});

test("report params are validated", () => {
  const classes = ["Grade 1"];
  assert.deepEqual(parseReportParams("weekly_summary", {}, "2026-10-11", classes), { type: "weekly_summary", date: "2026-10-11" });
  const t = parseReportParams("termly_attendance", { startDate: "2026-09-01", endDate: "2026-11-30", classCode: "Grade 1" }, "2026-10-11", classes);
  assert.deepEqual(t, { type: "termly_attendance", startDate: "2026-09-01", endDate: "2026-11-30", termLabel: "2026-09-01 to 2026-11-30", absenteeThreshold: 80, classCode: "Grade 1" });
  assert.throws(() => parseReportParams("payroll", {}, "2026-10-11", classes), fault("not_found"));
  assert.throws(() => parseReportParams("termly_attendance", { startDate: "2026-09-01" }, "2026-10-11", classes), fault("invalid_argument"));
  assert.throws(() => parseReportParams("termly_attendance", { startDate: "2026-12-01", endDate: "2026-11-01" }, "2026-10-11", classes), fault("invalid_argument", /before/));
  assert.throws(() => parseReportParams("weekly_summary", { classCode: "Nope" }, "2026-10-11", classes), fault("invalid_argument", /not a class/));
  assert.throws(() => parseReportParams("termly_attendance", { startDate: "2026-09-01", endDate: "2026-11-01", absenteeThreshold: 0 }, "2026-10-11", classes), fault("invalid_argument"));
});
