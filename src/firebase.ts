import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "my-register-728ff.firebaseapp.com",
  projectId: "my-register-728ff",
  storageBucket: "my-register-728ff.firebasestorage.app",
  messagingSenderId: "743321098039",
  appId: "1:743321098039:web:c029899bbbd8edcf53ecb2",
  measurementId: "G-8GTLD00Z4X"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);
export default app;
