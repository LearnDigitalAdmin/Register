# MyRegister — Deployment Guide

## What's in this package
- `dist/` — Production-ready build (deploy this to any static host)
- `src/` — Full React TypeScript source code
- Firebase already configured for `learn-000111`

## Deploy Options

### Option A: Firebase Hosting (Recommended — free, fast in Kenya)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # select dist as public dir, SPA: yes
firebase deploy
```
Your app will be live at: https://learn-000111.web.app

### Option B: Vercel (Zero-config)
```bash
npm install -g vercel
vercel --prod
```

### Option C: Netlify
Drag & drop the `dist/` folder at app.netlify.com

---

## Firebase Console Setup Required
Go to https://console.firebase.google.com → project: learn-000111

### 1. Enable Authentication
- Authentication → Sign-in method → Enable **Email/Password**

### 2. Set up Firestore
- Firestore Database → Create database (Europe-west region)
- Use these security rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    match /phone_index/{phone} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    match /schools/{schoolId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
        (resource == null || resource.data.adminUid == request.auth.uid);
    }
    match /students/{id} {
      allow read, write: if request.auth != null;
    }
    match /attendance/{id} {
      allow read, write: if request.auth != null;
    }
    match /registers/{id} {
      allow read, write: if request.auth != null;
    }
    match /messages/{id} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## How Login Works
- Users sign up with **both email AND phone**
- Phone is stored in a `phone_index` collection mapping `+2547xx...` → email
- At login, entering a phone number automatically looks up the email and authenticates
- Both email AND phone number work at the Sign In screen

## Token System
- Platform is **100% free**
- New accounts get **100 free tokens**
- 1 token = 1 message send (to all parents in selected group)
- Top up via M-Pesa (integration point for Africa's Talking / M-Pesa API)

## Local Development
```bash
npm install
npm run dev
```
