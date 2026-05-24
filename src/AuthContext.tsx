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
import type { UserProfile } from './types';

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
  schoolId?: string;
  classCode?: string;
  county?: string;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string) {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      setUserProfile(snap.data() as UserProfile);
    }
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.uid);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await loadProfile(u.uid);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  async function signUp(params: SignUpParams) {
    const { email, phone, password, displayName, role, schoolName, classCode, county } = params;

    // Create with email/password
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });

    // Generate schoolId for admins, or use provided one for teachers
    let schoolId = params.schoolId || '';
    if (role === 'schoolAdmin') {
      schoolId = `SCH-${Date.now().toString(36).toUpperCase()}`;
      // Create school document
      await setDoc(doc(db, 'schools', schoolId), {
        id: schoolId,
        name: schoolName,
        county: county || 'Kenya',
        type: 'Primary (CBC)',
        adminUid: cred.user.uid,
        adminEmail: email,
        adminPhone: phone,
        createdAt: new Date().toISOString(),
      });
    }

    // Store user profile linking both email and phone
      const profile: UserProfile = {
        uid: cred.user.uid,
        email,
        phone: phone || null,
        displayName,
        role,
        schoolId,
        schoolName,
        ...(classCode ? { classCode } : {}),
        createdAt: new Date().toISOString(),
        messageTokens: 100,
      };

    await setDoc(doc(db, 'users', cred.user.uid), profile);

    // Also store phone→uid mapping so we can look up by phone at login
    if (phone) {
      const normalised = normalisePhone(phone);
      await setDoc(doc(db, 'phone_index', normalised), {
        uid: cred.user.uid,
        email,
      });
    }

    setUserProfile(profile);
  }

  async function signIn(emailOrPhone: string, password: string) {
    let email = emailOrPhone;

    // If it looks like a phone number, look up the associated email
    if (!emailOrPhone.includes('@')) {
      const normalised = normalisePhone(emailOrPhone);
      const indexSnap = await getDoc(doc(db, 'phone_index', normalised));
      if (!indexSnap.exists()) throw new Error('No account found for this phone number.');
      email = indexSnap.data().email;
    }

    await signInWithEmailAndPassword(auth, email, password);
  }

  async function logOut() {
    await signOut(auth);
    setUserProfile(null);
  }

  function normalisePhone(phone: string): string {
    // Convert 07xx -> +2547xx, strip spaces/dashes
    let p = phone.replace(/[\s\-]/g, '');
    if (p.startsWith('07') || p.startsWith('01')) {
      p = '+254' + p.slice(1);
    } else if (p.startsWith('254')) {
      p = '+' + p;
    }
    return p;
  }

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, signUp, signIn, logOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
