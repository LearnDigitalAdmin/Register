import { test } from "node:test";
import assert from "node:assert/strict";
import { planDeskSms, releaseDeskSms, deskEntityKey, deskAudience } from "./deskCommission";

const URL_OK = "https://deskSmsCommission-abc-ew.a.run.app";
const getIdToken = async () => "tok";
const plan = { schoolId: "12345", reference: "SMS_u1_1", tier: "medium", tokens: 400 };
const commission = { agentCode: "COG-0001", agentId: "ag1", sharePct: 28.4, rule: "sms_standard", entityKey: "school:12345" };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("entity key is school:<schoolId> (the school document id is the KNEC code)", () => {
  assert.equal(deskEntityKey("12345"), "school:12345");
});

test("a desk-owned school gets the split and the commission, sent with an ID token and no client-side price", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ applied: true, splitCode: "SPL_x", commission })); }) as unknown as typeof fetch;
  const out = await planDeskSms(plan, { url: URL_OK, getIdToken, fetchImpl });
  assert.deepEqual(out, { splitCode: "SPL_x", commission });
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(seen!.init.body as string), { action: "plan", entityKey: "school:12345", reference: "SMS_u1_1", tier: "medium", tokens: 400 });
});

test("every failure mode degrades to null (plain charge)", async () => {
  const opts = { url: URL_OK, getIdToken };
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: reply(200, { applied: false, reason: "no_desk_owner" }) }), null);
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: reply(500, { error: "internal" }) }), null);
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: reply(403, {}) }), null);
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: (async () => { throw new Error("network"); }) as unknown as typeof fetch }), null);
  assert.equal(await planDeskSms(plan, { ...opts, getIdToken: async () => { throw new Error("no creds"); }, fetchImpl: reply(200, {}) }), null);
  assert.equal(await planDeskSms(plan, { url: "", getIdToken, fetchImpl: reply(200, {}) }), null, "not configured");
  assert.equal(await planDeskSms(plan, { url: "http://insecure.example/x", getIdToken, fetchImpl: reply(200, {}) }), null, "https only");
});

test("a malformed or mismatched answer is never trusted", async () => {
  const opts = { url: URL_OK, getIdToken };
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: reply(200, { applied: true, splitCode: "ACCT_x", commission }) }), null, "not a split code");
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: reply(200, { applied: true, splitCode: "SPL_x", commission: { ...commission, entityKey: "school:99999" } }) }), null, "commission for another school");
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: reply(200, { applied: true, splitCode: "SPL_x", commission: { ...commission, sharePct: "28" } }) }), null);
  assert.equal(await planDeskSms(plan, { ...opts, fetchImpl: reply(200, [1]) }), null);
});

test("a slow desk is abandoned after the timeout", async () => {
  const slow = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
  const t0 = Date.now();
  assert.equal(await planDeskSms(plan, { url: URL_OK, getIdToken, fetchImpl: slow, timeoutMs: 40 }), null);
  assert.ok(Date.now() - t0 < 1000);
});

test("release sends the release action and never throws", async () => {
  let body = "";
  const ok = (async (_u: string, init: RequestInit) => { body = init.body as string; return new Response("{}"); }) as unknown as typeof fetch;
  await releaseDeskSms({ schoolId: "12345", reference: "SMS_u1_1" }, { url: URL_OK, getIdToken, fetchImpl: ok });
  assert.deepEqual(JSON.parse(body), { action: "release", entityKey: "school:12345", reference: "SMS_u1_1" });
  await releaseDeskSms({ schoolId: "12345", reference: "SMS_u1_1" }, { url: URL_OK, getIdToken, fetchImpl: (async () => { throw new Error("x"); }) as unknown as typeof fetch });
});

test("ID-token audience: run.app uses the origin, cloudfunctions.net the full URL", () => {
  assert.equal(deskAudience("https://svc-abc-ew.a.run.app/path?x=1"), "https://svc-abc-ew.a.run.app");
  assert.equal(deskAudience("https://africa-south1-p.cloudfunctions.net/fn"), "https://africa-south1-p.cloudfunctions.net/fn");
});
