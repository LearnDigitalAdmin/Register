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
  classCode?: string; // for teachers
  createdAt: string;
  messageTokens: number; // free platform, tokens for messages only
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
  date: string; // YYYY-MM-DD
  classCode: string;
  schoolId: string;
  status: AttendanceStatus;
  note: string;
  savedBy: string;
  savedAt: string;
  locked: boolean;
}

export interface Message {
  id: string;
  schoolId: string;
  sentBy: string;
  type: 'attendance' | 'assignment' | 'notice' | 'activity' | 'alert' | 'custom';
  channel: 'whatsapp' | 'sms' | 'both';
  recipients: string; // "All School" | "Grade 7A" etc.
  content: string;
  fileLink?: string;
  tokensUsed: number;
  sentAt: string;
  delivered: number;
  total: number;
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
