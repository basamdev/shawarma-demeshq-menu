// Firebase Configuration and Initialization

// Firebase config - using CDN versions loaded in HTML
const firebaseConfig = {
    apiKey: "AIzaSyCPJ5fx88XnG_8xo_hb7y_DnHE3h_QntP0",
    authDomain: "shawarma-demashq-menu.firebaseapp.com",
    projectId: "shawarma-demashq-menu",
    storageBucket: "shawarma-demashq-menu.firebasestorage.app",
    messagingSenderId: "954186813753",
    appId: "1:954186813753:web:ef0b07813a9fdeccb118e8",
    measurementId: "G-HWB8F12K7K"
};

// Initialize Firebase (only if not already initialized)
try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log('Firebase initialized successfully');
    } else {
        console.log('Firebase already initialized');
    }
} catch (error) {
    console.error('Firebase initialization error:', error);
}

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Mobile browsers / PWA (iOS Safari, in-app WebViews) often fail with WebChannel;
// long polling is more reliable on hosted HTTPS sites (Vercel, Netlify).
try {
    db.settings({
        experimentalForceLongPolling: true,
        merge: true
    });
} catch (error) {
    console.warn('Firestore settings:', error);
}

// Export config for REST fallback (mobile hosts where SDK WebChannel hangs).
window.firebaseConfig = firebaseConfig;

function isMobileBrowser() {
    return /Android|webOS|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
}

function isAdminAppPage() {
    var path = (window.location && window.location.pathname) || '';
    return /admin\.html/i.test(path) || /login\.html/i.test(path);
}

// Let the app know when Firestore is ready (persistence is optional).
// Admin must work offline on mobile — enable persistence on admin/login pages.
window.dbReady = Promise.resolve(db);
var shouldEnablePersistence = isAdminAppPage() || !isMobileBrowser();
if (shouldEnablePersistence) {
    try {
        var persistenceOpts = (isAdminAppPage() && isMobileBrowser())
            ? {}
            : { synchronizeTabs: true };
        var persistencePromise = db.enablePersistence(persistenceOpts)
            .then(function () {
                console.log('Firestore offline persistence enabled');
                return db;
            })
            .catch(function (error) {
                if (error.code === 'failed-precondition') {
                    console.log('Persistence unavailable (another tab owns it) — running online only.');
                } else if (error.code === 'unimplemented') {
                    console.log('Persistence not supported by browser');
                } else {
                    console.error('Persistence error:', error);
                }
                return db;
            });
        var persistenceSettled = false;
        window.dbReady = Promise.race([
            persistencePromise.then(function (db) {
                persistenceSettled = true;
                return db;
            }),
            new Promise(function (resolve) {
                setTimeout(function () {
                    if (!persistenceSettled) {
                        console.log('Firebase ready — offline cache still loading in background (normal on mobile).');
                    }
                    resolve(db);
                }, 4000);
            })
        ]);
    } catch (error) {
        console.error('Persistence setup error:', error);
    }
} else {
    console.log('Menu page on mobile — Firestore persistence skipped');
}

// Firebase Storage is not used in this app; images are stored as public URL strings.
let storage = null;

// Set up persistence
try {
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => {
            console.log('Auth persistence set to LOCAL');
        })
        .catch((error) => {
            console.error('Error setting auth persistence:', error);
        });
} catch (error) {
    console.error('Auth persistence setup error:', error);
}

// Export for global use
window.firebase = firebase;
window.auth = auth;
window.db = db;
window.storage = storage;

console.log('Firebase Storage disabled; using direct image URLs only');

// Auth state observer (for debugging)
auth.onAuthStateChanged((user) => {
    if (user) {
        console.log('User is signed in:', user.email);
    } else {
        console.log('User is signed out');
    }
});