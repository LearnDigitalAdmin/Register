/**
 * Pure rules for `deskdelegate` (no Firebase imports; unit-tested in deskDelegateCore.test.ts).
 * Request parsing, audience/schedule/import payload mapping, SMS message and cost maths, CSV building and the idempotency decision.
 * The Firestore/HostPinnacle side lives in deskDelegate.ts; message cleaning (`sanitizeSmsText`, `containsLink`) is injected so this
 * file stays import-light and Register's own sanitiser is the one that runs.
 */
import { createHash } from "node:crypto";
import {
  DELEGATE_ACTIONS, DelegateAction, DelegateRequest, ImportErrorRecord, ImportRowRecord,
} from "./deskContract";
import { isDeskCode, normaliseDeskCode } from "./deskAgents";
import { countSmsSegments } from "./scheduleTypes";
import type { ScheduleAudienceType, ScheduleFrequency } from "./scheduleTypes";
import {
  autoDetectMapping, ImportFieldKey, ImportRow, IMPORT_OPTIONAL_FIELDS, IMPORT_REQUIRED_FIELDS, rowsFromRecords,
} from "./shared/importValidation";
import { normalisePhone } from "./shared/phone";

export type FaultCode = "invalid_argument" | "permission_denied" | "not_found" | "failed_precondition" | "internal";

/** An expected failure, returned to desk as `{ ok:false, error:{ code, message } }`. The message is shown to the agent. */
export class DelegateFault extends Error {
  constructor(public readonly code: FaultCode, message: string) { super(message); }
}

export const LIMITS = {
  importRows: 5000,
  sendRecipients: 5000,
  memberIds: 500,
  messageChars: 400,
  smsChunk: 100,
  scheduleDaysMax: 366,
} as const;

// ─── request envelope ──────────────────────────────────────────────────────

export function normaliseKnecCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";
}

export function parseDelegateRequest(body: unknown): DelegateRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DelegateFault("invalid_argument", "The request body must be a JSON object.");
  const b = body as Record<string, unknown>;
  if (typeof b.action !== "string" || !(DELEGATE_ACTIONS as readonly string[]).includes(b.action)) {
    throw new DelegateFault("invalid_argument", `Unknown action. Supported: ${DELEGATE_ACTIONS.join(", ")}.`);
  }
  const entityCode = normaliseKnecCode(b.entityCode);
  if (!/^[A-Z0-9-]{3,40}$/.test(entityCode)) throw new DelegateFault("invalid_argument", "entityCode must be the school's KNEC code.");
  const agentCode = normaliseDeskCode(b.agentCode);
  if (!isDeskCode(agentCode)) throw new DelegateFault("invalid_argument", "agentCode must be a desk code such as COG-0042.");
  const requestId = typeof b.requestId === "string" ? b.requestId.trim() : "";
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(requestId)) throw new DelegateFault("invalid_argument", "requestId must be 8-128 characters (letters, digits, _ . : -).");
  const payload = b.payload === undefined ? {} : b.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new DelegateFault("invalid_argument", "payload must be an object.");
  return { action: b.action as DelegateAction, entityCode, agentCode, requestId, payload: payload as Record<string, unknown> };
}

/** Document id for a requestId in `desk_delegate_requests` (hashed: ids may contain ':' or be long). */
export function requestDocId(requestId: string): string {
  return createHash("sha256").update(requestId).digest("hex").slice(0, 40);
}

/** Deterministic id for the Nth imported student of a request, so a resumed commit can never create a student twice. */
export function importStudentId(requestId: string, rowIndex: number): string {
  return "dsk" + createHash("sha256").update(`${requestId}#${rowIndex}`).digest("hex").slice(0, 24);
}

export function scheduleDocId(requestId: string): string {
  return "dsk" + createHash("sha256").update(`schedule#${requestId}`).digest("hex").slice(0, 24);
}

// ─── idempotency ───────────────────────────────────────────────────────────

export interface DelegateLogDoc {
  requestId: string; action: DelegateAction; entityCode: string; agentCode: string;
  status: "processing" | "done"; startedAt: number; updatedAt: number; result?: unknown;
}
export type IdempotencyDecision =
  | { kind: "new" }
  | { kind: "replay"; result: unknown }
  | { kind: "busy" }
  | { kind: "resume" };

export const STALE_PROCESSING_MS = 120_000;

export function decideIdempotency(
  existing: DelegateLogDoc | undefined,
  expect: { action: DelegateAction; entityCode: string; agentCode: string },
  now: number,
): IdempotencyDecision {
  if (!existing) return { kind: "new" };
  if (existing.action !== expect.action || existing.entityCode !== expect.entityCode || existing.agentCode !== expect.agentCode) {
    throw new DelegateFault("invalid_argument", "This requestId was already used for a different request.");
  }
  if (existing.status === "done") return { kind: "replay", result: existing.result };
  return now - existing.updatedAt < STALE_PROCESSING_MS ? { kind: "busy" } : { kind: "resume" };
}

// ─── audiences ─────────────────────────────────────────────────────────────

export interface ParsedAudience {
  audienceType: ScheduleAudienceType; classCode?: string; recipientUids?: string[]; recipientStudentIds?: string[];
  /** true when messages go to teachers (prefixed "MyRegister:") rather than parents. */
  teachers: boolean;
}

/** Audience strings the delegate offers. `parents_class:<class>` carries the class code after the colon. */
export function audienceOptions(classes: string[]): string[] {
  return ["parents_school", ...classes.map(c => `parents_class:${c}`), "parents_selected", "teachers_all", "teachers_selected"];
}

function parseMemberIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new DelegateFault("invalid_argument", "memberIds is required for a selected audience.");
  if (raw.length > LIMITS.memberIds) throw new DelegateFault("invalid_argument", `Select at most ${LIMITS.memberIds} people.`);
  const ids = raw.map(v => (typeof v === "string" ? v.trim() : ""));
  if (ids.some(v => !v || v.includes("/") || v.length > 128)) throw new DelegateFault("invalid_argument", "memberIds contains an invalid id.");
  return Array.from(new Set(ids));
}

export function parseAudience(audience: unknown, memberIds: unknown, classes: string[]): ParsedAudience {
  if (typeof audience !== "string" || !audience.trim()) throw new DelegateFault("invalid_argument", "audience is required.");
  const a = audience.trim();
  const hasIds = memberIds !== undefined && memberIds !== null;
  if (a === "parents_school") {
    if (hasIds) throw new DelegateFault("invalid_argument", "memberIds only applies to a selected audience.");
    return { audienceType: "parents_school", teachers: false };
  }
  if (a.startsWith("parents_class:")) {
    const classCode = a.slice("parents_class:".length);
    if (!classes.includes(classCode)) throw new DelegateFault("invalid_argument", `"${classCode}" is not a class at this school.`);
    if (hasIds) throw new DelegateFault("invalid_argument", "memberIds only applies to a selected audience.");
    return { audienceType: "parents_class", classCode, teachers: false };
  }
  if (a === "parents_selected") return { audienceType: "parents_selected", recipientStudentIds: parseMemberIds(memberIds), teachers: false };
  if (a === "teachers_all") {
    if (hasIds) throw new DelegateFault("invalid_argument", "memberIds only applies to a selected audience.");
    return { audienceType: "teachers_all", teachers: true };
  }
  if (a === "teachers_selected") return { audienceType: "teachers_selected", recipientUids: parseMemberIds(memberIds), teachers: true };
  throw new DelegateFault("invalid_argument", `Unknown audience "${a}".`);
}

// ─── SMS text and cost ─────────────────────────────────────────────────────

export type Clean = (text: string) => string;

/** Cleans a message body the way every Register send does, rejecting empty text and links (links are never allowed in parent messages). */
export function prepareBody(raw: unknown, clean: Clean, hasLink: (t: string) => boolean): string {
  if (typeof raw !== "string") throw new DelegateFault("invalid_argument", "message is required.");
  const body = clean(raw).trim();
  if (!body) throw new DelegateFault("invalid_argument", "The message is empty after removing unsupported characters.");
  if (hasLink(body)) throw new DelegateFault("invalid_argument", "Links are not allowed in messages to parents or teachers. Remove any web addresses.");
  return body;
}

/** `Dear Parent,\n{body}\n{school}: {phone}` — the broadcast format of src/services/messagingService.ts buildMessage. */
export function parentBroadcastText(body: string, schoolName: string, schoolPhone: string, clean: Clean): string {
  const safePhone = (schoolPhone || "").replace(/[^\d+\s\-()[\]]/g, "").trim();
  return `Dear Parent,\n${body}\n${clean(schoolName)}: ${safePhone}`;
}

export function teacherText(body: string): string {
  return `MyRegister: ${body}`;
}

export interface SendQuote { text: string; segments: number; recipients: number; tokens: number }

/** 1 token per SMS part per recipient (src/types.ts calcTokenCost). */
export function quoteSend(text: string, recipients: number): SendQuote {
  const segments = countSmsSegments(text);
  return { text, segments, recipients, tokens: segments * recipients };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** SMS pricing tier by recipient count (src/types.ts getSmsTier / KES_RATE_PER_TOKEN). */
export function smsTier(recipients: number): { tier: "small" | "medium" | "large"; kesPerToken: number } {
  if (recipients <= 100) return { tier: "small", kesPerToken: 0.7 };
  if (recipients <= 300) return { tier: "medium", kesPerToken: 0.5 };
  return { tier: "large", kesPerToken: 0.4 };
}

// ─── scheduling ────────────────────────────────────────────────────────────

export interface ParsedSchedule {
  label: string; body: string; frequency: ScheduleFrequency; startDate: string; timeOfDay: string; endDate?: string;
}

const AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

function validYmd(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Nairobi (UTC+3) calendar fields for `at`. A string without an offset is already Nairobi local time. */
export function parseAtNairobi(at: string): { date: string; time: string; epochMs: number } {
  const m = AT_PATTERN.exec(at.trim());
  if (!m) throw new DelegateFault("invalid_argument", "schedule.at must look like 2026-11-02T08:30 (Nairobi time).");
  const [, ys, mos, ds, hs, mis, tz] = m;
  const y = +ys, mo = +mos, d = +ds, h = +hs, mi = +mis;
  if (!validYmd(y, mo, d) || h > 23 || mi > 59) throw new DelegateFault("invalid_argument", "schedule.at is not a real date and time.");
  let epochMs = Date.UTC(y, mo - 1, d, h, mi) - NAIROBI_OFFSET_MS; // as if Nairobi local
  if (tz) {
    const sign = tz.startsWith("-") ? -1 : 1;
    const digits = tz === "Z" ? "0000" : tz.slice(1).replace(":", "");
    const offsetMs = sign * (+digits.slice(0, 2) * 60 + +digits.slice(2)) * 60_000;
    epochMs = Date.UTC(y, mo - 1, d, h, mi) - offsetMs;
  }
  const n = new Date(epochMs + NAIROBI_OFFSET_MS);
  const p = (v: number) => String(v).padStart(2, "0");
  return { date: `${n.getUTCFullYear()}-${p(n.getUTCMonth() + 1)}-${p(n.getUTCDate())}`, time: `${p(n.getUTCHours())}:${p(n.getUTCMinutes())}`, epochMs };
}

export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Maps the contract's schedule payload onto Register's scheduler (once | daily | weekly). Register has no "monthly".
 * `schedule.endDate` (YYYY-MM-DD) is required for daily/weekly because Register's scheduler plans a fixed number of runs;
 * the v4 contract has no such field, so until it does only one-off schedules can be created without it.
 * `schedule.days` (0 = Sunday … 6 = Saturday) may only repeat the start date's weekday, since weekly means "every 7 days".
 */
export function parseSchedule(payload: Record<string, unknown>, clean: Clean, hasLink: (t: string) => boolean, nowMs: number): ParsedSchedule {
  const label = typeof payload.name === "string" ? payload.name.trim() : "";
  if (label.length < 2 || label.length > 80) throw new DelegateFault("invalid_argument", "name must be 2-80 characters.");
  const body = prepareBody(payload.message, clean, hasLink);
  const sch = payload.schedule;
  if (!sch || typeof sch !== "object" || Array.isArray(sch)) throw new DelegateFault("invalid_argument", "schedule is required.");
  const s = sch as Record<string, unknown>;
  const kind = s.kind;
  if (kind === "monthly") throw new DelegateFault("invalid_argument", "MyRegister supports one-off, daily and weekly schedules. Monthly schedules are not available.");
  if (kind !== "once" && kind !== "daily" && kind !== "weekly") throw new DelegateFault("invalid_argument", "schedule.kind must be once, daily or weekly.");
  if (typeof s.at !== "string") throw new DelegateFault("invalid_argument", "schedule.at is required.");
  const at = parseAtNairobi(s.at);
  if (at.epochMs < nowMs - 60_000) throw new DelegateFault("invalid_argument", "schedule.at is in the past.");

  let endDate: string | undefined;
  if (kind === "once") {
    if (s.endDate !== undefined) throw new DelegateFault("invalid_argument", "A one-off schedule has no end date.");
    if (Array.isArray(s.days) && s.days.length > 0) throw new DelegateFault("invalid_argument", "A one-off schedule has no weekdays.");
  } else {
    if (typeof s.endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.endDate) || !validYmd(+s.endDate.slice(0, 4), +s.endDate.slice(5, 7), +s.endDate.slice(8, 10))) {
      throw new DelegateFault("invalid_argument", "Daily and weekly schedules need schedule.endDate (YYYY-MM-DD).");
    }
    if (s.endDate < at.date) throw new DelegateFault("invalid_argument", "schedule.endDate is before the start.");
    if (daysBetween(at.date, s.endDate) > LIMITS.scheduleDaysMax) throw new DelegateFault("invalid_argument", "A schedule can run for at most one year.");
    endDate = s.endDate;
    if (Array.isArray(s.days) && s.days.length > 0) {
      const wd = weekdayOf(at.date);
      if (kind !== "weekly" || s.days.length !== 1 || s.days[0] !== wd) {
        throw new DelegateFault("invalid_argument", `Weekly schedules repeat on the start date's weekday (${wd}, with 0 = Sunday). Remove days or use days: [${wd}].`);
      }
    }
  }
  return { label, body, frequency: kind, startDate: at.date, timeOfDay: at.time, ...(endDate ? { endDate } : {}) };
}

// ─── records import ────────────────────────────────────────────────────────

const FIELD_KEYS: ImportFieldKey[] = [...IMPORT_REQUIRED_FIELDS, ...IMPORT_OPTIONAL_FIELDS];

export interface ImportPlan { rows: ImportRow[]; mapping: Partial<Record<ImportFieldKey, string>>; scope: "singleClass" | "wholeSchool"; targetClassCode?: string }

/**
 * Turns desk's records into importer rows. Columns named exactly like the importer's fields (admissionNo, name, classCode,
 * streamCode, parentName, parentPhone, parentWhatsApp, nationalId, upiNumber) map straight through; anything else is mapped with
 * the importer's own header recognition (`autoDetectMapping`, including the school's taught aliases).
 */
export function planImport(
  records: unknown, targetClassCode: unknown, customAliases: Partial<Record<ImportFieldKey, string[]>>,
): ImportPlan {
  if (!Array.isArray(records) || records.length === 0) throw new DelegateFault("invalid_argument", "rows must be a non-empty list.");
  if (records.length > LIMITS.importRows) throw new DelegateFault("invalid_argument", `Send at most ${LIMITS.importRows} rows per request.`);
  const recs: Array<Record<string, unknown>> = records.map((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new DelegateFault("invalid_argument", `Row ${i + 1} is not an object.`);
    return r as Record<string, unknown>;
  });
  const columns = Array.from(recs.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set<string>()));
  const mapping: Partial<Record<ImportFieldKey, string>> = {};
  for (const f of FIELD_KEYS) if (columns.includes(f)) mapping[f] = f;
  const used = new Set(Object.values(mapping));
  const detected = autoDetectMapping(columns.filter(c => !used.has(c)), customAliases);
  for (const f of FIELD_KEYS) if (!mapping[f] && detected[f]) mapping[f] = detected[f];

  let scope: "singleClass" | "wholeSchool" = "wholeSchool";
  let target: string | undefined;
  if (targetClassCode !== undefined && targetClassCode !== null && targetClassCode !== "") {
    if (typeof targetClassCode !== "string") throw new DelegateFault("invalid_argument", "targetClassCode must be text.");
    scope = "singleClass";
    target = targetClassCode;
  }
  const required = scope === "singleClass" ? IMPORT_REQUIRED_FIELDS.filter(f => f !== "classCode") : IMPORT_REQUIRED_FIELDS;
  const missing = required.filter(f => !mapping[f]);
  if (missing.length) {
    throw new DelegateFault("invalid_argument", `Could not find a column for: ${missing.join(", ")}. Columns received: ${columns.join(", ") || "none"}.`);
  }
  return { rows: rowsFromRecords(recs, mapping), mapping, scope, targetClassCode: target };
}

const SUGGESTIONS: Partial<Record<string, string>> = {
  invalid_phone: "Use a Kenyan number such as 0722 123 456.",
  missing_admission_no: "Add the student's admission number.",
  unknown_class: "Use a class that exists at this school.",
};

export function rowErrors(rows: ImportRow[]): ImportErrorRecord[] {
  const out: ImportErrorRecord[] = [];
  for (const r of rows) {
    for (const i of r.issues) {
      const suggestion = SUGGESTIONS[i.type];
      out.push({ row: r.rowIndex, field: i.field || "row", reason: i.message, ...(suggestion ? { suggestion } : {}) });
    }
  }
  return out;
}

/** Canonical, normalised record for a valid row (class resolved, phone in local format). */
export function validRecord(row: ImportRow): ImportRowRecord {
  const v = row.values;
  const rec: ImportRowRecord = {
    admissionNo: (v.admissionNo || "").trim(),
    name: (v.name || "").trim(),
    classCode: row.resolvedClassCode || "",
    parentName: (v.parentName || "").trim(),
    parentPhone: normalisePhone(v.parentPhone || "") || (v.parentPhone || "").trim(),
  };
  if (v.parentWhatsApp) rec.parentWhatsApp = normalisePhone(v.parentWhatsApp) || v.parentWhatsApp.trim();
  if (v.nationalId) rec.nationalId = v.nationalId.trim();
  if (v.upiNumber) rec.upiNumber = v.upiNumber.trim();
  return rec;
}

// ─── CSV ───────────────────────────────────────────────────────────────────

/** RFC 4180 CSV with every cell quoted, CRLF rows, and spreadsheet-formula injection neutralised. */
export function toCsv(rows: string[][]): string {
  const cell = (raw: unknown): string => {
    let s = raw === null || raw === undefined ? "" : String(raw);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map(r => r.map(cell).join(",")).join("\r\n");
}

export function safeFileName(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return s || "export";
}

export const STUDENT_EXPORT_HEADER = ["Admission No.", "Student Name", "Class", "Parent Name", "Parent Phone", "Parent WhatsApp", "National ID / Birth Cert"];

// ─── reports ───────────────────────────────────────────────────────────────

export const REPORT_TYPES = ["termly_attendance", "weekly_summary"] as const;
export type ReportType = typeof REPORT_TYPES[number];

export type ReportParams =
  | { type: "termly_attendance"; startDate: string; endDate: string; termLabel: string; classCode?: string; absenteeThreshold: number }
  | { type: "weekly_summary"; date: string; classCode?: string };

const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && validYmd(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));

export function parseReportParams(reportType: unknown, params: unknown, todayYmd: string, classes: string[]): ReportParams {
  if (typeof reportType !== "string" || !(REPORT_TYPES as readonly string[]).includes(reportType)) {
    throw new DelegateFault("not_found", `Unknown report type. Available: ${REPORT_TYPES.join(", ")}.`);
  }
  const p = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, unknown>;
  let classCode: string | undefined;
  if (p.classCode !== undefined && p.classCode !== null && p.classCode !== "") {
    if (typeof p.classCode !== "string" || !classes.includes(p.classCode)) throw new DelegateFault("invalid_argument", `"${String(p.classCode)}" is not a class at this school.`);
    classCode = p.classCode;
  }
  if (reportType === "weekly_summary") {
    const date = p.date === undefined ? todayYmd : p.date;
    if (!isYmd(date)) throw new DelegateFault("invalid_argument", "date must be YYYY-MM-DD.");
    return { type: "weekly_summary", date, ...(classCode ? { classCode } : {}) };
  }
  if (!isYmd(p.startDate) || !isYmd(p.endDate)) throw new DelegateFault("invalid_argument", "startDate and endDate (YYYY-MM-DD) are required.");
  if (p.endDate < p.startDate) throw new DelegateFault("invalid_argument", "endDate is before startDate.");
  if (daysBetween(p.startDate, p.endDate) > 370) throw new DelegateFault("invalid_argument", "A termly report can cover at most one year.");
  const thr = p.absenteeThreshold === undefined ? 80 : p.absenteeThreshold;
  if (typeof thr !== "number" || !Number.isFinite(thr) || thr < 1 || thr > 100) throw new DelegateFault("invalid_argument", "absenteeThreshold must be between 1 and 100.");
  const termLabel = typeof p.termLabel === "string" && p.termLabel.trim() ? p.termLabel.trim().slice(0, 60) : `${p.startDate} to ${p.endDate}`;
  return { type: "termly_attendance", startDate: p.startDate, endDate: p.endDate, termLabel, absenteeThreshold: thr, ...(classCode ? { classCode } : {}) };
}
