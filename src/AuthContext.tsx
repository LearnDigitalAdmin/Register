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
import type { UserProfile, Curriculum, StreamMode } from './types';
import { createAcademicSetup, isKnecCodeTaken, isValidKnecCode, normaliseKnecCode } from './services/academicYearService';

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
  schoolType?: string;
  /** The following are required for role === 'schoolAdmin' (new school registration) */
  knecCode?: string;
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
      schoolName, classCode, county, schoolPhone, schoolType,
      curriculum, startingClass, graduatingClass,
      streamsEnabled, streamMode, uniformStreams, perClassStreams,
    } = params;

    let schoolId = params.schoolId || '';

    if (role === 'schoolAdmin') {
      if (!params.knecCode || !isValidKnecCode(params.knecCode)) {
        throw new Error('Enter a valid KNEC school code (letters, numbers, and dashes only).');
      }
      if (!curriculum || !startingClass || !graduatingClass) {
        throw new Error('Select a curriculum, starting class, and graduating class.');
      }
      schoolId = normaliseKnecCode(params.knecCode);
      if (await isKnecCodeTaken(schoolId)) {
        throw new Error(`KNEC code ${schoolId} is already registered to a school.`);
      }
    } else if (role === 'teacherAdmin') {
      schoolId = normaliseKnecCode(params.schoolId || '');
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });

    if (role === 'schoolAdmin') {
      const { academicYear } = await createAcademicSetup({
        schoolId,
        curriculum: curriculum!,
        startingClass: startingClass!,
        graduatingClass: graduatingClass!,
        streamsEnabled: !!streamsEnabled,
        streamMode: streamMode || 'none',
        uniformStreams,
        perClassStreams,
      });

      await setDoc(doc(db, 'schools', schoolId), {
        id:         schoolId,
        knecCode:   schoolId,
        name:       schoolName,
        county:     county || 'Kenya',
        type:       schoolType || 'Primary',
        curriculum,
        startingClass,
        graduatingClass,
        streamsEnabled: !!streamsEnabled,
        activeAcademicYearId: academicYear.id,
        adminUid:   cred.user.uid,
        adminEmail: email,
        adminPhone: phone,
        // phone is the dedicated SMS-footer contact — defaults to admin phone
        phone:      schoolPhone || phone || '',
        createdAt:  new Date().toISOString(),
      });
    }

    const profile: UserProfile = {
      uid:           cred.user.uid,
      email,
      phone:         phone || null,
      displayName,
      role,
      schoolId,
      schoolName,
      ...(classCode ? { classCode } : {}),
      createdAt:     new Date().toISOString(),
      messageTokens: 100,
    };

    await setDoc(doc(db, 'users', cred.user.uid), profile);

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