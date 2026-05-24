import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBSQJAnled1_jZb9h_uBT10pKfg0gumwc4",
  authDomain: "learn-000111.firebaseapp.com",
  databaseURL: "https://learn-000111-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "learn-000111",
  storageBucket: "learn-000111.appspot.com",
  messagingSenderId: "446897435741",
  appId: "1:446897435741:web:1f217252605854031e09b4",
  measurementId: "G-6WZ9QDSVFG"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);
export default app;
