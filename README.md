# Savi Beauty Studio (PWA)

A free, installable app for logging customer visits, expenses, and seeing
monthly profit & loss. No account, no subscription, no server cost.

## How your data is stored

Records are saved in **Firebase Firestore**, on Firebase's free "Spark"
plan — no credit card, no subscription, and this app is far below the free
daily limits. Sign in with the same email and password on any phone or
computer and you'll see the same customers and expenses everywhere.
See **`FIREBASE_SETUP.md`** for the one-time setup (create a free Firebase
project, paste your config into `firebase-config.js`, publish the security
rules in `firestore.rules`).

Your data is protected so only your signed-in account can read or write it.
The app also caches data on-device, so it keeps working with no signal and
syncs automatically once you're back online. Still worth exporting a CSV
backup from the **Backup** tab now and then.

## Put it online for free (so you can install it like an app)

A PWA needs to be served over HTTPS to be installable — opening the HTML
file directly (double-click) will still work as a plain webpage, but the
"Add to Home Screen" / offline features need real hosting. All of these
are free, no credit card:

**Easiest — Netlify Drop (no account needed)**
1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page.
3. You'll get a free `.netlify.app` link instantly — open it on your phone.

**GitHub Pages (free, permanent link, needs a free GitHub account)**
1. Create a new repository on https://github.com and upload all files in
   this folder (keep the `icons` folder structure).
2. Go to Settings → Pages → set source to the `main` branch, root folder.
3. GitHub gives you a link like `https://yourname.github.io/reponame/`.

**Vercel** (https://vercel.com) also has a free tier with the same
drag-and-drop style deploy.

## Installing it on your phone

Once it's hosted (link starts with `https://`):

- **Android (Chrome):** open the link → menu (⋮) → "Add to Home screen" /
  "Install app".
- **iPhone (Safari):** open the link → Share button → "Add to Home Screen".

It then opens full-screen like a normal app, and works offline.

## Files

- `index.html` — app screens (sign in, Overview, Customers, Expenses, Backup)
- `styles.css` — styling
- `firebase-config.js` — **edit this** with your own Firebase project keys
- `firestore.rules` — paste into Firebase console → Firestore → Rules
- `FIREBASE_SETUP.md` — step-by-step setup guide, start here
- `db.js` — Firestore + sign-in read/write helpers
- `app.js` — app logic (forms, lists, totals, CSV export/import)
- `manifest.json` — app name/icon/colors for installation
- `sw.js` — service worker, caches the app shell so it loads offline
- `icons/` — app icons
