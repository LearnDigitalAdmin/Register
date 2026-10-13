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

## Support desk integration (`deskdelegate`, Support Agents, Desk requests)

New Cloud Functions (region `africa-south1`): `addSupportAgent`, `removeSupportAgent`, `listSupportAgents`,
`createDeskRequest`, `listDeskRequests` (callables, school admin only) and `deskdelegate` (HTTPS, **private**).

Register never calls the desk. The desk reads this project's `desk_requests` collection and calls `deskdelegate`.

1. **Deploy**: `firebase deploy --only functions`.
2. **Let the desk call `deskdelegate`** (Cloud Run IAM; no public access). Grant the desk's service account the invoker role:
   ```bash
   gcloud run services add-iam-policy-binding deskdelegate \
     --region=africa-south1 --project=<REGISTER_PROJECT> \
     --member=serviceAccount:<DESK_SERVICE_ACCOUNT> --role=roles/run.invoker
   ```
   Check it is private: `curl -i https://<deskdelegate-url>` must return **403**.
3. **Let the desk read AND update `desk_requests`**: grant the same account `roles/datastore.user`. The sweeper marks each
   item `status: "pulled"` and writes `deskStatus`/`responses` back, so `roles/datastore.viewer` is not enough (items would
   stay `new` and be pulled again every 30 minutes). `scripts/desk-iam.sh <project> <desk-project-number>` does steps 2 and 3.
   Then set `projects.school` and `delegate.school` in the desk project's `desk_config/global` (the script prints both values).
   Deploy the indexes too: `firebase deploy --only firestore:indexes`. The sweeper's query needs `desk_requests (status, createdAt)`.
4. **Desk commission on SMS top-ups** (optional, fails open): `chargeSmsTopUp` asks PAY's private `deskSmsCommission` function
   to plan the desk split when a desk agent owns the school (`school:<KNEC code>`). Run `scripts/desk-iam.sh` with the 4th
   argument (the desk project id) to grant MyRegister's service account invoker on that function, then set
   `DESK_SMS_PLAN_URL` (the script prints it) in `functions/.env.<project>`. Left empty, or on any desk failure, the
   purchase is charged normally. The buyer's `users/{uid}.schoolId` must equal the school being topped up.

4. **Exports** (`export_data`, `run_report`) upload a CSV under `desk-exports/<school>/<uuid>/` and return a 15-minute signed URL.
   Signing needs the function's service account to hold `roles/iam.serviceAccountTokenCreator` on itself.
   Add a bucket lifecycle rule that deletes objects with prefix `desk-exports/` after 1 day.
5. **SMS secrets**: `deskdelegate` uses the existing `HP_SMS_*` secrets.
6. Audit rows are in `desk_audit` (counts only, never phone numbers or message text).

## How Login Works
- Users sign up with **both email AND phone**
- Phone is stored in a `phone_index` collection mapping `+2547xx...` → email
- At login, entering a phone number automatically looks up the email and authenticates
- Both email AND phone number work at the Sign In screen

## Token System
- Platform is **100% free**
- Each school gets **50 free tokens** when its admin registers it (teachers joining a school start with 0; the admin can share tokens with them). Existing balances are unchanged.
- 1 token = 1 message send (to all parents in selected group)
- Top up via M-Pesa (integration point for Africa's Talking / M-Pesa API)

## Local Development
```bash
npm install
npm run dev
```
