import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  AcademicYear, ClassStructure, Curriculum, CURRICULUM_LEVELS, StreamMode,
} from '../types';

/** Normalise a raw KNEC code into a Firestore-safe doc id. */
export function normaliseKnecCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidKnecCode(raw: string): boolean {
  const code = normaliseKnecCode(raw);
  return code.length >= 3 && /^[A-Z0-9-]+$/.test(code);
}

/** Whether a KNEC code is already registered to a school. */
export async function isKnecCodeTaken(knecCode: string): Promise<boolean> {
  const code = normaliseKnecCode(knecCode);
  const snap = await getDoc(doc(db, 'schools', code));
  return snap.exists();
}

/** Slice the full curriculum level list down to startingClass..graduatingClass inclusive. */
export function resolveLevels(curriculum: Curriculum, startingClass: string, graduatingClass: string): string[] {
  const all = CURRICULUM_LEVELS[curriculum];
  const startIdx = all.indexOf(startingClass);
  const endIdx = all.indexOf(graduatingClass);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error('Starting class must come before graduating class for the selected curriculum.');
  }
  return all.slice(startIdx, endIdx + 1);
}

/** Build the final resolved class list from levels + stream configuration. */
export function buildClassList(
  levels: string[],
  streamsEnabled: boolean,
  streamMode: StreamMode,
  uniformStreams?: string[],
  perClassStreams?: Record<string, string[]>,
): string[] {
  if (!streamsEnabled || streamMode === 'none') return [...levels];

  if (streamMode === 'uniform') {
    const streams = (uniformStreams || []).map(s => s.trim()).filter(Boolean);
    if (streams.length === 0) throw new Error('Add at least one stream (e.g. A, B).');
    return levels.flatMap(level => streams.map(s => `${level}${s}`));
  }

  // perClass
  const classes: string[] = [];
  for (const level of levels) {
    const streams = (perClassStreams?.[level] || []).map(s => s.trim()).filter(Boolean);
    if (streams.length === 0) throw new Error(`Add at least one stream for ${level}.`);
    for (const s of streams) classes.push(`${level}${s}`);
  }
  return classes;
}

export interface AcademicSetupParams {
  schoolId: string; // KNEC code
  curriculum: Curriculum;
  startingClass: string;
  graduatingClass: string;
  streamsEnabled: boolean;
  streamMode: StreamMode;
  uniformStreams?: string[];
  perClassStreams?: Record<string, string[]>;
  yearLabel?: string; // defaults to current year
}

/** Writes classStructures/{schoolId} and an initial active academicYears doc. Called once, at registration. */
export async function createAcademicSetup(params: AcademicSetupParams): Promise<{
  classStructure: ClassStructure;
  academicYear: AcademicYear;
}> {
  const {
    schoolId, curriculum, startingClass, graduatingClass,
    streamsEnabled, streamMode, uniformStreams, perClassStreams,
  } = params;

  const levels = resolveLevels(curriculum, startingClass, graduatingClass);
  const classes = buildClassList(levels, streamsEnabled, streamMode, uniformStreams, perClassStreams);

  const now = new Date().toISOString();

  const classStructure: ClassStructure = {
    schoolId, curriculum, startingClass, graduatingClass, levels,
    streamsEnabled, streamMode,
    ...(streamMode === 'uniform' ? { uniformStreams: uniformStreams?.map(s => s.trim()).filter(Boolean) } : {}),
    ...(streamMode === 'perClass' ? { perClassStreams } : {}),
    classes,
    updatedAt: now,
  };

  const yearLabel = params.yearLabel || String(new Date().getFullYear());
  const academicYearId = `${schoolId}_${yearLabel}`;

  const academicYear: AcademicYear = {
    id: academicYearId,
    schoolId,
    label: yearLabel,
    status: 'active',
    startDate: now,
    createdAt: now,
  };

  await setDoc(doc(db, 'classStructures', schoolId), classStructure);
  await setDoc(doc(db, 'academicYears', academicYearId), academicYear);

  return { classStructure, academicYear };
}

/**
 * Reverse a resolved class code (e.g. 'Grade 10A') back into its base level ('Grade 10')
 * and stream suffix ('A'), using the school's known level list. Longest-prefix match handles
 * cases like 'Grade 1' vs 'Grade 10' correctly. Returns stream '' when streams are disabled.
 */
export function classToLevelAndStream(structure: ClassStructure, classCode: string): { level: string; stream: string } {
  if (!structure.streamsEnabled) {
    if (!structure.levels.includes(classCode)) throw new Error(`Unknown class "${classCode}" for this school.`);
    return { level: classCode, stream: '' };
  }
  const matches = structure.levels.filter(l => classCode.startsWith(l));
  if (matches.length === 0) throw new Error(`Unknown class "${classCode}" for this school.`);
  const level = matches.reduce((longest, l) => (l.length > longest.length ? l : longest), matches[0]);
  return { level, stream: classCode.slice(level.length) };
}

/** Fetch a school's resolved class list (used by teacher signup to populate the class picker). */
export async function getClassStructure(schoolId: string): Promise<ClassStructure | null> {
  const code = normaliseKnecCode(schoolId);
  const snap = await getDoc(doc(db, 'classStructures', code));
  return snap.exists() ? (snap.data() as ClassStructure) : null;
}
