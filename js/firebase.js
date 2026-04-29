// ============================================================
// firebase.js
// Firebase initialization at connection para sa AgriSense PH.
// Ito ang unang JS file na kailangang i-load sa lahat ng pages.
//
// Kasama dito:
//   - Firebase App initialization
//   - Firestore database connection
//   - Firebase Auth connection
//   - Firebase Storage connection
//   - Helper functions para sa database operations
// ============================================================

// ── FIREBASE CONFIG ───────────────────────────────────────────
// Ang iyong personal na Firebase project credentials.
// Huwag i-share ito sa publiko.
const firebaseConfig = {
  apiKey:            "AIzaSyChVEVmIax_LLpuG3Dozx3__hGAVBJMx-w",
  authDomain:        "agrisense-ph.firebaseapp.com",
  projectId:         "agrisense-ph",
  storageBucket:     "agrisense-ph.firebasestorage.app",
  messagingSenderId: "419328194682",
  appId:             "1:419328194682:web:89426b39e1358c5d17a3c3"
};

// ── FIREBASE INITIALIZATION ───────────────────────────────────
// I-initialize ang Firebase gamit ang config sa itaas.
// Ginagamit ang compat version (v8 style) para mas madaling
// gamitin — walang import/export syntax kailangan.
firebase.initializeApp(firebaseConfig);

// ── SERVICE INSTANCES ─────────────────────────────────────────
// Mga global na reference sa Firebase services.
// Ginagamit ng lahat ng ibang JS files.

// Firestore — ang database para sa lahat ng detection data
const db = firebase.firestore();

// Auth — para sa login at user management
const auth = firebase.auth();

// Storage — para sa mga larawan ng dahon
const storage = firebase.storage();

// ── FIRESTORE COLLECTIONS ─────────────────────────────────────
// Mga reference sa bawat collection sa database.
// Mas madaling gamitin kaysa paulit-ulit na i-type ang string.
const COLLECTIONS = {
  users:           db.collection('users'),
  detections:      db.collection('detections'),
  communityStats:  db.collection('community_stats'),
  alerts:          db.collection('alerts'),
  offlineQueue:    db.collection('offline_queue')
};

// ── USER ROLES ────────────────────────────────────────────────
// Tatlong uri ng users sa sistema.
// Ginagamit para ma-control ang access sa iba't ibang features.
const USER_ROLES = {
  FARMER:     'farmer',     // Mag-detect at makita ang sariling history
  ADMIN:      'admin',      // Community analytics at manage users
  DA_OFFICER: 'da_officer'  // Government — outbreak alerts at reports
};

// ── FIRESTORE SECURITY RULES (para malaman mo) ───────────────
// I-set ito sa Firebase Console → Firestore → Rules:
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users — makita lang ng sarili o ng admin/DA
    match /users/{userId} {
      allow read: if request.auth != null &&
        (request.auth.uid == userId ||
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'da_officer']);
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    // Detections — i-create ng farmer, basahin ng admin/DA
    match /detections/{detectionId} {
      allow create: if request.auth != null;
      allow read: if request.auth != null;
      allow update, delete: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'da_officer'];
    }

    // Community stats — basahin ng lahat, i-update ng admin lang
    match /community_stats/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // Alerts — basahin ng lahat, gumawa ng admin/DA
    match /alerts/{alertId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'da_officer'];
    }
  }
}
*/

// ── HELPER FUNCTIONS ─────────────────────────────────────────

/**
 * Kunin ang kasalukuyang logged-in user profile mula sa Firestore.
 * Ibinabalik ang user data kasama ang role (farmer/admin/da_officer).
 *
 * @returns {Promise<Object|null>} User profile o null kung hindi naka-login
 */
async function getCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const doc = await COLLECTIONS.users.doc(user.uid).get();
    if (doc.exists) {
      return { uid: user.uid, ...doc.data() };
    }
    return null;
  } catch (e) {
    console.error('Error getting user profile:', e);
    return null;
  }
}

/**
 * I-check kung ang kasalukuyang user ay may required na role.
 * Ginagamit para i-protect ang admin at DA officer pages.
 *
 * @param   {string|string[]} requiredRole - Role o array ng roles
 * @returns {Promise<boolean>} true kung may access, false kung wala
 */
async function checkUserRole(requiredRole) {
  const profile = await getCurrentUserProfile();
  if (!profile) return false;

  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  return roles.includes(profile.role);
}

/**
 * I-format ang Firestore timestamp sa readable na string.
 * Halimbawa: "Apr 15, 2025 · 2:30 PM"
 *
 * @param   {firebase.firestore.Timestamp} timestamp
 * @returns {string} Formatted date string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '—';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric'
  }) + ' · ' + date.toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * I-check kung online ang browser.
 * Ginagamit para malaman kung mag-si-sync agad o mag-queue.
 *
 * @returns {boolean} true kung online
 */
function isOnline() {
  return navigator.onLine;
}

// I-listen sa online/offline events para ma-update ang UI
window.addEventListener('online',  () => console.log('🟢 Online — syncing queued detections...'));
window.addEventListener('offline', () => console.log('🔴 Offline — detections will be queued'));
