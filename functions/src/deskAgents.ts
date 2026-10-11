/**
 * Pure rules for Support Agents and desk requests (no Firebase imports, unit-tested in deskAgents.test.ts).
 *
 * A school's connected desks live on the school document as `supportAgents.<COG-####>` = { addedAt, addedBy, name? }.
 * COG-0000 (the company's top desk) is ALWAYS authorised on every school and can never be removed by the customer: it is
 * not stored, it is implied here, so no write to the school document can revoke it.
 */
import {
  DESK_TOP_CODE, REQUEST_CATEGORIES, RequestCategory, SupportAgentView,
} from "./deskContract";

export class DeskInputError extends Error {}

const DESK_CODE_PATTERN = /^COG-\d{4,}$/;

export function normaliseDeskCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";
}

export function isDeskCode(code: string): boolean {
  return DESK_CODE_PATTERN.test(code);
}

export type SupportAgentsMap = Record<string, { addedAt?: number; addedBy?: string; name?: string } | undefined> | undefined | null;

/** Whether `agentCode` may act on a school. The top desk is always authorised. */
export function isAgentAuthorised(supportAgents: SupportAgentsMap, agentCode: string): boolean {
  if (agentCode === DESK_TOP_CODE) return true;
  return !!supportAgents && Object.prototype.hasOwnProperty.call(supportAgents, agentCode) && !!supportAgents[agentCode];
}

/** Connected (customer-chosen) desk codes, sorted, excluding the implied top desk. */
export function connectedAgentCodes(supportAgents: SupportAgentsMap): string[] {
  if (!supportAgents) return [];
  return Object.keys(supportAgents)
    .filter(code => isDeskCode(code) && code !== DESK_TOP_CODE && !!supportAgents[code])
    .sort();
}

/** What the customer sees: the locked top desk first, then connected desks in code order. */
export function agentViews(supportAgents: SupportAgentsMap): Array<SupportAgentView & { locked: boolean }> {
  const connected = connectedAgentCodes(supportAgents).map(code => ({
    agentCode: code, name: supportAgents?.[code]?.name || "", addedAt: supportAgents?.[code]?.addedAt || 0, locked: false,
  }));
  return [{ agentCode: DESK_TOP_CODE, name: "Samuhia Support", addedAt: 0, locked: true }, ...connected];
}

/** Validates an agent code supplied by the customer. Throws DeskInputError with a user-readable message. */
export function parseAgentCodeInput(raw: unknown): string {
  const code = normaliseDeskCode(raw);
  if (!code) throw new DeskInputError("Enter the support agent's desk code (for example COG-0042).");
  if (!isDeskCode(code)) throw new DeskInputError("That doesn't look like a desk code. Desk codes look like COG-0042.");
  return code;
}

/**
 * Which desks receive a support request. Always includes the top desk when the customer chose it or has no connected desk;
 * otherwise only the connected desks the customer picked (default: all connected desks). A code that isn't connected is rejected.
 */
export function resolveTargetDeskCodes(connected: string[], requested: unknown): string[] {
  const wanted = Array.isArray(requested) ? requested.map(normaliseDeskCode).filter(Boolean) : [];
  const unique = Array.from(new Set(wanted));
  for (const code of unique) {
    if (code !== DESK_TOP_CODE && !connected.includes(code)) {
      throw new DeskInputError(`${code} is not connected to your school. Add the agent in Settings → Support agents first.`);
    }
  }
  if (connected.length === 0) return [DESK_TOP_CODE];
  if (unique.length === 0) return [...connected];
  const targets = connected.filter(c => unique.includes(c));
  if (unique.includes(DESK_TOP_CODE)) targets.push(DESK_TOP_CODE);
  return targets;
}

export const REQUEST_LIMITS = { subject: 120, message: 2000, perDay: 20 } as const;

export interface CleanRequestInput { category: RequestCategory; subject: string; message: string; clientToken: string }

/** Validates a customer's support request. Throws DeskInputError with a user-readable message. */
export function parseRequestInput(data: unknown): CleanRequestInput {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const category = d.category;
  if (typeof category !== "string" || !(REQUEST_CATEGORIES as readonly string[]).includes(category)) {
    throw new DeskInputError("Choose what your request is about.");
  }
  const subject = typeof d.subject === "string" ? d.subject.trim().replace(/\s+/g, " ") : "";
  const message = typeof d.message === "string" ? d.message.trim() : "";
  if (subject.length < 3) throw new DeskInputError("Add a short subject (at least 3 characters).");
  if (subject.length > REQUEST_LIMITS.subject) throw new DeskInputError(`Keep the subject under ${REQUEST_LIMITS.subject} characters.`);
  if (message.length < 10) throw new DeskInputError("Describe the problem in a little more detail (at least 10 characters).");
  if (message.length > REQUEST_LIMITS.message) throw new DeskInputError(`Keep the message under ${REQUEST_LIMITS.message} characters.`);
  const clientToken = typeof d.clientToken === "string" ? d.clientToken.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientToken)) throw new DeskInputError("Missing request token. Reload the page and try again.");
  return { category: category as RequestCategory, subject, message, clientToken };
}
