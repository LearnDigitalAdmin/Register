import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';

const functions = getFunctions(app, 'africa-south1');

export const DESK_TOP_CODE = 'COG-0000';
export const REQUEST_CATEGORIES: { id: string; label: string }[] = [
  { id: 'setup', label: 'Setting up my school' },
  { id: 'import', label: 'Importing students' },
  { id: 'sms', label: 'SMS and tokens' },
  { id: 'payments', label: 'Payments' },
  { id: 'reports', label: 'Reports' },
  { id: 'account', label: 'My account' },
  { id: 'other', label: 'Something else' },
];

export interface SupportAgentRow { agentCode: string; name: string; addedAt: number; locked: boolean }
export interface DeskResponseRow { at: number; byDeskCode: string; text: string }
export interface DeskRequestRow {
  id: string; category: string; subject: string; message: string;
  status: 'new' | 'pulled' | 'rejected';
  deskStatus: 'new' | 'open' | 'answered' | 'closed' | null;
  targetDeskCodes: string[]; responses: DeskResponseRow[]; createdAt: number; pulledAt: number | null;
}

export async function listSupportAgents(): Promise<{ agents: SupportAgentRow[]; max: number }> {
  const r = await httpsCallable<Record<string, never>, { agents: SupportAgentRow[]; max: number }>(functions, 'listSupportAgents')({});
  return r.data;
}
export async function addSupportAgent(agentCode: string): Promise<{ alreadyConnected: boolean }> {
  const r = await httpsCallable<{ agentCode: string }, { ok: true; alreadyConnected: boolean }>(functions, 'addSupportAgent')({ agentCode });
  return r.data;
}
export async function removeSupportAgent(agentCode: string): Promise<void> {
  await httpsCallable<{ agentCode: string }, { ok: true; wasConnected: boolean }>(functions, 'removeSupportAgent')({ agentCode });
}

export interface NewDeskRequest { category: string; subject: string; message: string; clientToken: string; targetDeskCodes?: string[] }
export async function createDeskRequest(input: NewDeskRequest): Promise<{ id: string; created: boolean }> {
  const r = await httpsCallable<NewDeskRequest, { id: string; created: boolean; targetDeskCodes: string[] }>(functions, 'createDeskRequest')(input);
  return r.data;
}
export async function listDeskRequests(): Promise<DeskRequestRow[]> {
  const r = await httpsCallable<Record<string, never>, { requests: DeskRequestRow[] }>(functions, 'listDeskRequests')({});
  return r.data.requests;
}

/** Fresh token per form session; resubmitting the same token never creates a second request. */
export function newClientToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Firebase callable errors carry a readable message after "functions/xyz:"; strip any prefix. */
export function readableError(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : '';
  if (!m || m.toLowerCase() === 'internal') return fallback;
  return m.replace(/^functions\/[a-z-]+:\s*/i, '');
}
