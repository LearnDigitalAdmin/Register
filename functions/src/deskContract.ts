/**
 * The part of Samuhia Desk CONTRACT v4 that a product repository implements, copied from the desk repo's
 * `functions-desk/src/contract.ts` (DESK_CONTRACT_VERSION 4). Products never import from desk and never call desk; this file
 * only mirrors the shapes so that desk (which calls `deskdelegate` and reads this project's `desk_requests`) and Register agree.
 * If desk bumps the contract version, update this file by hand and `DESK_CONTRACT_VERSION` below.
 */

export const DESK_CONTRACT_VERSION = 4;

/** Desk codes are COG-0001, COG-0002 … (zero-padded, at least 4 digits). COG-0000 is the company's top desk. */
export const DESK_CODE_PREFIX = "COG-";
export const DESK_TOP_CODE = "COG-0000";

export type RequestStatus = "new" | "open" | "answered" | "closed";
export const REQUEST_CATEGORIES = ["setup", "import", "sms", "payments", "reports", "account", "other"] as const;
export type RequestCategory = typeof REQUEST_CATEGORIES[number];
export interface RequestResponse { at: number; byDeskCode: string; text: string }

/** Written by Register into its OWN `desk_requests` collection; desk's sweeper pulls it and writes deskStatus/responses back. */
export type OutboxStatus = "new" | "pulled" | "rejected";
export interface OutboxSupportItem {
  kind: "support"; status: OutboxStatus; entityCode: string; entityName: string;
  requesterName: string; requesterPhone: string; category: string; subject: string; message: string;
  targetDeskCodes: string[]; createdAt: number; pulledAt?: number; error?: string;
  deskStatus?: RequestStatus; responses?: RequestResponse[];
}

// ---- delegate API (implemented by this repo's `deskdelegate`)
export type DelegateAction =
  | "entity_info" | "validate_records" | "commit_records"
  | "schedule_sms" | "send_sms_now" | "run_report" | "export_data";
export const DELEGATE_ACTIONS: readonly DelegateAction[] = [
  "entity_info", "validate_records", "commit_records", "schedule_sms", "send_sms_now", "run_report", "export_data",
];
export interface DelegateRequest {
  action: DelegateAction;
  entityCode: string;
  agentCode: string;
  requestId: string;
  payload: Record<string, unknown>;
}
export interface DelegateError { code: string; message: string }
export type DelegateResponse<T> = { ok: true; result: T } | { ok: false; error: DelegateError };

export interface ImportRowRecord { [column: string]: string | number | null }
export interface ImportErrorRecord { row: number; field: string; reason: string; suggestion?: string }

export interface DelegateEntityInfo {
  displayName: string; adminName: string; adminPhone: string; agentAuthorised: boolean; plan: string;
  creditsBalance: number; audiences: string[]; reportTypes: string[]; exportKinds: string[];
}
export interface DelegateValidateResult { valid: ImportRowRecord[]; errors: ImportErrorRecord[] }
export interface DelegateCommitResult { created: number; skipped: number; errors: ImportErrorRecord[] }
export interface DelegateScheduleResult { scheduleId: string; recipients: number; creditsPerRun: number }
export interface DelegateSendResult { queued: number; creditsUsed: number; creditsRemaining: number }
export interface DelegateFileResult { downloadUrl: string; expiresAt: number }

/** Product-side callables */
export interface SupportAgentView { agentCode: string; name: string; addedAt: number }
