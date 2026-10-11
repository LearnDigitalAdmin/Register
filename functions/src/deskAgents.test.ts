import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAgentAuthorised, connectedAgentCodes, agentViews, parseAgentCodeInput, resolveTargetDeskCodes, parseRequestInput,
  normaliseDeskCode, DeskInputError,
} from "./deskAgents";

const agents = { "COG-0007": { addedAt: 5, name: "Wanjiku" }, "COG-0002": { addedAt: 3 } };

test("the top desk is always authorised, even when supportAgents is empty or missing", () => {
  assert.equal(isAgentAuthorised(undefined, "COG-0000"), true);
  assert.equal(isAgentAuthorised({}, "COG-0000"), true);
});

test("only connected desks are authorised, and prototype keys never are", () => {
  assert.equal(isAgentAuthorised(agents, "COG-0007"), true);
  assert.equal(isAgentAuthorised(agents, "COG-0003"), false);
  assert.equal(isAgentAuthorised(agents, "toString"), false);
  assert.equal(isAgentAuthorised(undefined, "COG-0007"), false);
});

test("connected desks are sorted and exclude the implied top desk", () => {
  assert.deepEqual(connectedAgentCodes({ ...agents, "COG-0000": { addedAt: 1 } }), ["COG-0002", "COG-0007"]);
});

test("agent views list the locked top desk first", () => {
  const v = agentViews(agents);
  assert.equal(v[0].agentCode, "COG-0000");
  assert.equal(v[0].locked, true);
  assert.deepEqual(v.slice(1).map(a => [a.agentCode, a.name, a.locked]), [["COG-0002", "", false], ["COG-0007", "Wanjiku", false]]);
});

test("agent code input is normalised and validated", () => {
  assert.equal(parseAgentCodeInput(" cog-0042 "), "COG-0042");
  assert.equal(normaliseDeskCode(12), "");
  assert.throws(() => parseAgentCodeInput(""), DeskInputError);
  assert.throws(() => parseAgentCodeInput("AGT-0042"), /desk code/);
  assert.throws(() => parseAgentCodeInput("COG-42"), DeskInputError);
});

test("requests go to the top desk when no desk is connected", () => {
  assert.deepEqual(resolveTargetDeskCodes([], undefined), ["COG-0000"]);
  assert.throws(() => resolveTargetDeskCodes([], ["COG-0009"]), /not connected/);
});

test("requests default to all connected desks, honour a pick, and add the top desk only when chosen", () => {
  const c = ["COG-0002", "COG-0007"];
  assert.deepEqual(resolveTargetDeskCodes(c, undefined), c);
  assert.deepEqual(resolveTargetDeskCodes(c, ["cog-0007"]), ["COG-0007"]);
  assert.deepEqual(resolveTargetDeskCodes(c, ["COG-0007", "COG-0000"]), ["COG-0007", "COG-0000"]);
  assert.deepEqual(resolveTargetDeskCodes(c, ["COG-0000"]), ["COG-0000"]);
});

test("requests cannot target a desk that is not connected", () => {
  assert.throws(() => resolveTargetDeskCodes(["COG-0002"], ["COG-0099"]), /not connected/);
});

test("request input is validated with user-readable messages", () => {
  const ok = { category: "sms", subject: "  Cannot   send ", message: "Messages stay pending for hours.", clientToken: "abcdefgh12" };
  assert.deepEqual(parseRequestInput(ok), { category: "sms", subject: "Cannot send", message: "Messages stay pending for hours.", clientToken: "abcdefgh12" });
  assert.throws(() => parseRequestInput({ ...ok, category: "nope" }), /what your request is about/);
  assert.throws(() => parseRequestInput({ ...ok, subject: "ab" }), /subject/);
  assert.throws(() => parseRequestInput({ ...ok, message: "short" }), /detail/);
  assert.throws(() => parseRequestInput({ ...ok, message: "x".repeat(2001) }), /2000/);
  assert.throws(() => parseRequestInput({ ...ok, clientToken: "bad token!" }), /token/);
  assert.throws(() => parseRequestInput(null), DeskInputError);
});
