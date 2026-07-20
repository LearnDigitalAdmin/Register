import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { UserProfile, Curriculum, StreamMode, BoardingType, SchoolLevel, TeacherAssignment } from './types';
import { createAcademicSetup, isKnecCodeTaken, isValidKnecCode, normaliseKnecCode } from './services/academicYearService';
import { assignmentId, getTeachersForClass } from './services/teacherAssignmentService';
import { isSafaricomPhone } from './utils/phoneValidation';

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signUp: (params: SignUpParams) => Promise<void>;
  signIn: (emailOrPhone: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

interface SignUpParams {
  email: string;
  /** Required for every account — used for the daily register-reminder SMS, so it must be a
   * genuine Safaricom number (validated in `signUp` below). */
  phone: string;
  password: string;
  displayName: string;
  role: 'schoolAdmin' | 'teacherAdmin';
  schoolName: string;
  schoolId?: string;         // teacherAdmin joining: the school's KNEC code
  classCode?: string;
  county?: string;
  /** School contact number shown in every SMS footer */
  schoolPhone?: string;
  /** The following are required for role === 'schoolAdmin' (new school registration) */
  knecCode?: string;
  boardingType?: BoardingType;
  schoolLevel?: SchoolLevel;
  curriculum?: Curriculum;
  startingClass?: string;
  graduatingClass?: string;
  streamsEnabled?: boolean;
  streamMode?: StreamMode;
  uniformStreams?: string[];
  perClassStreams?: Record<string, string[]>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]               = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading]         = useState(true);

  async function loadProfile(uid: string) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) setUserProfile(snap.data() as UserProfile);
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.uid);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) await loadProfile(u.uid);
      else setUserProfile(null);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function signUp(params: SignUpParams) {
    const {
      email, phone, password, displayName, role,
      schoolName, classCode, county, schoolPhone,
      boardingType, schoolLevel,
      curriculum, startingClass, graduatingClass,
      streamsEnabled, streamMode, uniformStreams, perClassStreams,
    } = params;

    let schoolId = params.schoolId || '';

    // Client-side shape validation only — no Firestore reads here, since the user
    // isn't authenticated yet and most collections (correctly) require auth to read.
    if (!isSafaricomPhone(phone)) {
      throw new Error('Enter a valid Safaricom phone number (e.g. 07XX XXX XXX) — it\'s used for daily register reminders.');
    }
    if (role === 'schoolAdmin') {
      if (!params.knecCode || !isValidKnecCode(params.knecCode)) {
        throw new Error('Enter a valid KNEC school code (letters, numbers, and dashes only).');
      }
      if (!curriculum || !startingClass || !graduatingClass) {
        throw new Error('Select a curriculum, starting class, and graduating class.');
      }
      if (!boardingType) throw new Error('Select whether the school is Day or Boarding.');
      if (!schoolLevel) throw new Error('Select the school level.');
      schoolId = normaliseKnecCode(params.knecCode);
    } else if (role === 'teacherAdmin') {
      schoolId = normaliseKnecCode(params.schoolId || '');
      if (!schoolId) throw new Error('Find your school before signing up.');
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });

    if (role === 'schoolAdmin') {
      // Now authenticated, so the KNEC-taken check (a `schools` read) is allowed to run.
      // If it's taken, tear down the auth account we just created rather than leaving an
      // orphaned, profile-less user behind.
      if (await isKnecCodeTaken(schoolId)) {
        await cred.user.delete();
        throw new Error(`KNEC code ${schoolId} is already registered to a school.`);
      }

      // The academicYear id is deterministic (`${schoolId}_${yearLabel}`), so we can compute
      // it up front and create the `schools` doc FIRST. classStructures/academicYears rules
      // both check `schools/{schoolId}.adminUid`, which only exists once this doc is written —
      // creating it any later denies those writes with "insufficient permissions".
      const yearLabel = String(new Date().getFullYear());
      const academicYearId = `${schoolId}_${yearLabel}`;

      await setDoc(doc(db, 'schools', schoolId), {
        id:         schoolId,
        knecCode:   schoolId,
        name:       schoolName,
        county:     county || 'Kenya',
        boardingType,
        schoolLevel,
        curriculum,
        startingClass,
        graduatingClass,
        streamsEnabled: !!streamsEnabled,
        activeAcademicYearId: academicYearId,
        adminUid:   cred.user.uid,
        adminEmail: email,
        adminPhone: phone,
        // phone is the dedicated SMS-footer contact — defaults to admin phone
        phone:      schoolPhone || phone || '',
        createdAt:  new Date().toISOString(),
      });

      await createAcademicSetup({
        schoolId,
        curriculum: curriculum!,
        startingClass: startingClass!,
        graduatingClass: graduatingClass!,
        streamsEnabled: !!streamsEnabled,
        streamMode: streamMode || 'none',
        uniformStreams,
        perClassStreams,
        yearLabel,
      });
    }

    // Class lock: a brand-new teacher can't claim a class another active teacher already
    // holds. Checked now (post-auth, since `teacherAssignments` reads require sign-in) and
    // BEFORE the profile is written, so a rejected signup never leaves a half-created account
    // behind — same pattern as the KNEC-taken check above.
    if (role === 'teacherAdmin' && classCode) {
      const holders = await getTeachersForClass(schoolId, classCode);
      if (holders.length > 0) {
        await cred.user.delete();
        throw new Error(`${classCode} already has a teacher assigned. Ask your school admin to check the class list, or pick a different class.`);
      }
    }

    const profile: UserProfile = {
      uid:           cred.user.uid,
      email,
      phone:         phone || null,
      displayName,
      role,
      schoolId,
      schoolName,
      ...(classCode ? { classCode, assignedClasses: [classCode], lastActiveClass: classCode } : {}),
      createdAt:     new Date().toISOString(),
      messageTokens: 100,
    };

    await setDoc(doc(db, 'users', cred.user.uid), profile);

    // Now that the profile exists (role/schoolId resolvable by the rules engine), record the
    // assignment itself — self-service, so it's tagged `assignedBy: self` and can never be
    // used to plant an assignment for someone else (enforced in firestore.rules).
    if (role === 'teacherAdmin' && classCode) {
      const id = assignmentId(schoolId, cred.user.uid, classCode);
      const assignment: TeacherAssignment = {
        id, schoolId, teacherUid: cred.user.uid, teacherName: displayName, classCode,
        assignedAt: new Date().toISOString(), assignedBy: cred.user.uid, active: true,
      };
      await setDoc(doc(db, 'teacherAssignments', id), assignment);
    }

    if (phone) {
      const normalised = normalisePhone(phone);
      await setDoc(doc(db, 'phone_index', normalised), {
        uid: cred.user.uid, email,
      });
    }

    setUserProfile(profile);
  }

  async function signIn(emailOrPhone: string, password: string) {
    let email = emailOrPhone;
    if (!emailOrPhone.includes('@')) {
      const normalised = normalisePhone(emailOrPhone);
      const snap = await getDoc(doc(db, 'phone_index', normalised));
      if (!snap.exists()) throw new Error('No account found for this phone number.');
      email = snap.data().email;
    }
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function logOut() {
    await signOut(auth);
    setUserProfile(null);
  }

  function normalisePhone(phone: string): string {
    let p = phone.replace(/[\s\-]/g, '');
    if (p.startsWith('07') || p.startsWith('01')) p = '+254' + p.slice(1);
    else if (p.startsWith('254'))                  p = '+' + p;
    return p;
  }

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, signUp, signIn, logOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}