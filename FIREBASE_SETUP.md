# Setting up free cross-device sync (Firebase)

Your data now lives in Firebase's free "Spark" plan — no credit card, no
subscription. This app is nowhere near the free limits (50,000 reads and
20,000 writes a day, 1GB storage). You sign in with an email + password you
choose, and the same account shows the same data on every phone/browser.

## 1. Create the project

1. Go to https://console.firebase.google.com and sign in with any Google account.
2. Click **Add project** → name it (e.g. "savi-parlour") → you can turn
   off Google Analytics, it's not needed → **Create project**.

## 2. Register a web app and get your config

1. On the project's home page, click the **</>** (web) icon.
2. Give it a nickname (e.g. "Savi Beauty Studio") → **Register app**.
3. Firebase shows a `firebaseConfig` object with `apiKey`, `authDomain`, etc.
   Copy the whole thing.
4. Open **`firebase-config.js`** in this folder and paste your values in,
   replacing the `PASTE_YOUR_...` placeholders. This key is safe to be
   public — Firebase protects your data with the security rules below, not
   by hiding the key.

## 3. Turn on Email/Password sign-in

1. In the left sidebar: **Build → Authentication → Get started**.
2. Under **Sign-in method**, click **Email/Password** → enable it → **Save**.

## 4. Turn on Firestore (the database)

1. Left sidebar: **Build → Firestore Database → Create database**.
2. Pick a location close to you → **Start in production mode** → **Create**.
3. Go to the **Rules** tab and replace the contents with what's in
   **`firestore.rules`** in this folder → **Publish**.
   (This makes sure only you, signed in, can ever read or write your data.)

## 5. Re-deploy and sign in

1. Upload the updated folder to wherever you're hosting it (Netlify Drop,
   GitHub Pages, etc. — same as before).
2. Open the app on your phone → **Create account** with an email and
   password → you're in.
3. Open the app on a second device → **Sign in** with the same email and
   password → you'll see the same customers and expenses.

## Notes

- Forgot your password: tap **Forgot password?** on the sign-in screen —
  Firebase emails you a reset link.
- The app still works offline (Firestore caches data on the device and
  syncs automatically once you're back online).
- To add a second person (e.g. a staff member) with their own login who
  sees the *same* shared data, that needs a small rules change — ask if
  you'd like that set up.
