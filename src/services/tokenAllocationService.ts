import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';

const functions = getFunctions(app, 'africa-south1');

export interface AllocateTokensInput {
  schoolId: string;
  teacherUids: string[] | 'all';
  amountPerTeacher: number;
}

export interface AllocateTokensResult {
  success: boolean;
  adminBalanceAfter: number;
  allocations: { teacherUid: string; balanceAfter: number }[];
}

export async function allocateTokensToTeachers(input: AllocateTokensInput): Promise<AllocateTokensResult> {
  const fn = httpsCallable<AllocateTokensInput, AllocateTokensResult>(functions, 'allocateTokensToTeachers');
  const result = await fn(input);
  return result.data;
}
