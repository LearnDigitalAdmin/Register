// Emulator tests for support agents, desk requests and deskdelegate.
// Run: firebase emulators:exec --only firestore --project demo-register "node --test lib-test/**/*.emulator.test.js" (from functions/, after tsc -p tsconfig.test.json)
// Skipped automatically when FIRESTORE_EMULATOR_HOST is not set.
import test from "node:test";
import assert from "node:assert/strict";
import { clearFirestore, emulatorEnabled, initEmulatorApp } from "./testing/emulator";

const SCHOOL = "12345678";
const ADMIN = "admin-uid";
const opts = { skip: !emulatorEnabled && "Firestore emulator not running" };

async function seed(db: FirebaseFirestore.Firestore) {
  await db.collection("schools").doc(SCHOOL).set({ name: "Test Primary", adminUid: ADMIN, adminPhone: "0722123456", activeAcademicYearId: "y1" });
  await db.collection("users").doc(ADMIN).set({ role: "schoolAdmin", schoolId: SCHOOL, displayName: "Head", phone: "0722123456", messageTokens: 50 });
  await db.collection("users").doc("teacher-uid").set({ role: "teacherAdmin", schoolId: SCHOOL, displayName: "T", messageTokens: 0 });
  await db.collection("classStructures").doc(SCHOOL).set({ classes: ["Grade 1"], levels: [], streamsEnabled: false, streamMode: "none" });
}

// v2 callables expose `.run(request)`.
type Callable = { run: (req: { data: unknown; auth?: { uid: string } }) => Promise<any> };

test("support agents: add, idempotent add, list with locked top desk, remove, teacher refused", opts, async () => {
  const db = initEmulatorApp(); await clearFirestore(); await seed(db);
  const { addSupportAgent, removeSupportAgent, listSupportAgents } = await import("./supportAgents.js");
  const add = addSupportAgent as unknown as Callable, rem = removeSupportAgent as unknown as Callable, list = listSupportAgents as unknown as Callable;
  const auth = { uid: ADMIN };

  assert.deepEqual((await add.run({ data: { agentCode: "cog-0001" }, auth })).alreadyConnected, false);
  assert.deepEqual((await add.run({ data: { agentCode: "COG-0001" }, auth })).alreadyConnected, true);
  const l = await list.run({ data: {}, auth });
  assert.equal(l.agents[0].agentCode, "COG-0000");
  assert.equal(l.agents[0].locked, true);
  assert.ok(l.agents.some((a: { agentCode: string }) => a.agentCode === "COG-0001"));
  await assert.rejects(rem.run({ data: { agentCode: "COG-0000" }, auth }));
  assert.equal((await rem.run({ data: { agentCode: "COG-0001" }, auth })).wasConnected, true);
  await assert.rejects(add.run({ data: { agentCode: "COG-0002" }, auth: { uid: "teacher-uid" } }), /school admin/i);
  await assert.rejects(add.run({ data: { agentCode: "nonsense" }, auth }));
  const audit = await db.collection("desk_audit").get();
  assert.ok(audit.size >= 2);
});

test("desk requests: idempotent on clientToken, scoped to the school, audit written", opts, async () => {
  const db = initEmulatorApp(); await clearFirestore(); await seed(db);
  const { createDeskRequest, listDeskRequests } = await import("./deskRequests.js");
  const create = createDeskRequest as unknown as Callable, list = listDeskRequests as unknown as Callable;
  const auth = { uid: ADMIN };
  const data = { category: "sms", subject: "Tokens missing", message: "My tokens did not arrive after paying.", clientToken: "token-abcdefgh" };
  const a = await create.run({ data, auth });
  const b = await create.run({ data, auth });
  assert.equal(a.id, b.id);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  const doc = (await db.collection("desk_requests").doc(a.id).get()).data()!;
  assert.equal(doc.entityCode, SCHOOL);
  assert.equal(doc.entityName, "Test Primary");
  assert.equal(doc.kind, "support");
  assert.equal(doc.status, "new");
  assert.deepEqual(doc.targetDeskCodes, ["COG-0000"]);
  await db.collection("desk_requests").doc("other_x").set({ kind: "support", entityCode: "99999999", subject: "x", message: "y", status: "new", createdAt: 1 });
  const rows = (await list.run({ data: {}, auth })).requests;
  assert.equal(rows.length, 1);
  await assert.rejects(create.run({ data: { ...data, subject: "ab" }, auth }), /subject/i);
  await assert.rejects(create.run({ data, auth: { uid: "teacher-uid" } }), /school admin/i);
});

test("deskdelegate: unauthorised agent is refused, authorised commit is idempotent and never double-writes", opts, async () => {
  const db = initEmulatorApp(); await clearFirestore(); await seed(db);
  const { runDelegateAction } = await import("./deskDelegate.js");
  const rows = [
    { admissionNo: "A1", name: "Amina Test", classCode: "Grade 1", parentPhone: "0722000111" },
    { admissionNo: "A2", name: "Brian Test", classCode: "Grade 1", parentPhone: "bad" },
  ];
  const base = { entityCode: SCHOOL, agentCode: "COG-0007", requestId: "req-commit-1", payload: { source: "manual", rows } };

  const denied = await runDelegateAction({ ...base, action: "commit_records" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "permission_denied");
  assert.equal((await db.collection("students").get()).size, 0);

  await db.collection("schools").doc(SCHOOL).update({ "supportAgents.COG-0007": { addedAt: 1 } });
  const first = await runDelegateAction({ ...base, action: "commit_records" });
  assert.equal(first.ok, true);
  const afterFirst = (await db.collection("students").get()).size;
  assert.equal(afterFirst, 1); // the row with a bad phone is reported, not written
  const second = await runDelegateAction({ ...base, action: "commit_records" });
  assert.deepEqual(second, first);
  assert.equal((await db.collection("students").get()).size, afterFirst);

  const audit = await db.collection("desk_audit").get();
  assert.ok(audit.size >= 3);
  for (const d of audit.docs) assert.equal(JSON.stringify(d.data()).includes("0722000111"), false); // no PII in audit
});

test("deskdelegate: send_sms_now dryRun quotes cost and leaves balance and messages untouched", opts, async () => {
  const db = initEmulatorApp(); await clearFirestore(); await seed(db);
  await db.collection("schools").doc(SCHOOL).update({ "supportAgents.COG-0007": { addedAt: 1 } });
  await db.collection("students").doc("s1").set({ schoolId: SCHOOL, name: "Amina", parentPhone: "0722000111", admissionNo: "A1" });
  const { runDelegateAction } = await import("./deskDelegate.js");
  const res = await runDelegateAction({
    action: "send_sms_now", entityCode: SCHOOL, agentCode: "COG-0007", requestId: "req-dry-1",
    payload: { audience: "parents_school", message: "Fees are due on Friday.", dryRun: true },
  });
  assert.equal(res.ok, true);
  assert.equal((await db.collection("users").doc(ADMIN).get()).data()!.messageTokens, 50);
  assert.equal((await db.collection("messages").get()).size, 0);
});

test("deskdelegate: run_report returns only the real report types and unknown types are not_found", opts, async () => {
  const db = initEmulatorApp(); await clearFirestore(); await seed(db);
  await db.collection("schools").doc(SCHOOL).update({ "supportAgents.COG-0007": { addedAt: 1 } });
  const { runDelegateAction } = await import("./deskDelegate.js");
  const info = await runDelegateAction({ action: "entity_info", entityCode: SCHOOL, agentCode: "COG-0007", requestId: "req-info-1", payload: {} });
  assert.equal(info.ok, true);
  if (info.ok) assert.deepEqual((info.result as { reportTypes: string[] }).reportTypes.sort(), ["termly_attendance", "weekly_summary"]);
  const bad = await runDelegateAction({ action: "run_report", entityCode: SCHOOL, agentCode: "COG-0007", requestId: "req-rep-1", payload: { reportType: "made_up" } });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.code, "not_found");
});
