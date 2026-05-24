export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type UserRole = 'schoolAdmin' | 'teacherAdmin';

export interface UserProfile {
  uid: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: UserRole;
  schoolId: string;
  schoolName: string;
  classCode?: string;
  createdAt: string;
  messageTokens: number;
}

export interface School {
  id: string;
  name: string;
  county: string;
  type: string;
  adminUid: string;
  createdAt: string;
}

export interface Student {
  id: string;
  name: string;
  admissionNo: string;
  classCode: string;
  schoolId: string;
  parentName: string;
  parentPhone: string;
  parentWhatsApp: string;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  date: string;
  classCode: string;
  schoolId: string;
  status: AttendanceStatus;
  note: string;
  savedBy: string;
  savedAt: string;
  locked: boolean;
}

/** SMS pricing tiers based on recipient count snapshot */
export type SmsTier = 'small' | 'medium' | 'large';

export function getSmsTier(recipientCount: number): SmsTier {
  if (recipientCount <= 100) return 'small';
  if (recipientCount <= 300) return 'medium';
  return 'large';
}

/**
 * KES cost per token by tier.
 * 1 SMS part (140 chars) per recipient = 1 token.
 * Token value in KES depends on school size.
 */
export const KES_RATE_PER_TOKEN: Record<SmsTier, number> = {
  small: 0.7,   // ≤100 recipients → 0.7 KES/token
  medium: 0.5,  // 101–300 recipients → 0.5 KES/token
  large: 0.4,   // >300 recipients → 0.4 KES/token
};

export const SMS_SEGMENT_LENGTH = 140;
export const SMS_MAX_LENGTH = 400; // 3 segments max

/** Count how many 140-char segments a message uses */
export function countSmsSegments(text: string): number {
  const len = text.length;
  if (len === 0) return 0;
  return Math.ceil(len / SMS_SEGMENT_LENGTH);
}

/** Strip emojis and non-text characters */
export function sanitiseSmsText(raw: string): string {
  return raw
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u024F\r\n]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Calculate total token cost.
 * 1 token = 1 SMS part per recipient (regardless of tier).
 * Tier only affects KES price of tokens, not how many tokens are used.
 */
export function calcTokenCost(cleanedText: string, recipientCount: number): number {
  const segments = countSmsSegments(cleanedText);
  return segments * recipientCount; // 1 token per SMS part per recipient
}

/**
 * Calculate KES price for a given number of tokens at a tier.
 */
export function tokensToKes(tokens: number, tier: SmsTier): number {
  return Math.round(tokens * KES_RATE_PER_TOKEN[tier] * 100) / 100;
}

/**
 * Reverse calculation: given KES amount, how many tokens?
 * Truncated to nearest whole token.
 */
export function kesToTokens(kes: number, tier: SmsTier): number {
  return Math.floor(kes / KES_RATE_PER_TOKEN[tier]);
}

/** Fixed token package sizes */
export const TOKEN_PACKAGES = [50, 100, 200, 500, 1000];

export interface Message {
  id: string;
  schoolId: string;
  sentBy: string;
  type: 'attendance' | 'assignment' | 'notice' | 'activity' | 'alert' | 'custom';
  channel: 'sms';
  recipients: string;
  recipientCount: number;
  rawContent: string;
  content: string;
  smsSegments: number;
  smsTier: SmsTier;
  costPerSegment: number;
  tokensUsed: number;
  sentAt: string;
  delivered: number;
  total: number;
  status: 'sent' | 'failed' | 'partial';
}

export interface RegisterDay {
  date: string;
  classCode: string;
  schoolId: string;
  savedBy: string;
  savedAt: string;
  locked: boolean;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
}