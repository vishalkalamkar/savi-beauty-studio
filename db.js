/* db.js — data now lives in Firebase Firestore (cloud), synced across every
   device you sign in on, with the free Spark plan. Firestore's SDK also
   caches data locally, so the app keeps working offline and syncs once
   you're back online.

   Same DB.* interface as before, so app.js barely changed:
   DB.add(store, record) / DB.put(store, record) / DB.delete(store, id)
   DB.getAll(store) / DB.clear(store)

   Auth.* handles email/password sign-in so each owner only ever sees
   their own data (enforced by Firestore security rules, not just this code). */

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const firestore = firebase.firestore();

firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {
  /* Persistence unavailable (e.g. private browsing) — app still works online. */
});

function userCollection(storeName) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) throw new Error("Not signed in");
  return firestore.collection("users").doc(uid).collection(storeName);
}

const DB = {
  async add(storeName, record) {
    const ref = await userCollection(storeName).add({ ...record, createdAt: Date.now() });
    return ref.id;
  },

  async put(storeName, record) {
    const { id, ...rest } = record;
    await userCollection(storeName).doc(String(id)).set(rest, { merge: true });
    return id;
  },

  async delete(storeName, id) {
    await userCollection(storeName).doc(String(id)).delete();
  },

  async getAll(storeName) {
    const snap = await userCollection(storeName).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  },

  async clear(storeName) {
    const snap = await userCollection(storeName).get();
    const batch = firestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
};

const Auth = {
  onChange(cb) {
    auth.onAuthStateChanged(cb);
  },
  signIn(email, password) {
    return auth.signInWithEmailAndPassword(email, password);
  },
  signUp(email, password) {
    return auth.createUserWithEmailAndPassword(email, password);
  },
  signOut() {
    return auth.signOut();
  },
  resetPassword(email) {
    return auth.sendPasswordResetEmail(email);
  },
  get currentUser() {
    return auth.currentUser;
  }
};
