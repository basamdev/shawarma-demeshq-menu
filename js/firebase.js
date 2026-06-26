// Firebase Configuration and Initialization

// Firebase config - using CDN versions loaded in HTML
const firebaseConfig = {
    apiKey: "AIzaSyAO2FU5CDt5o5EEMI-Hd2d04g4HSX62C8M",
    authDomain: "ali-cafe-menu.firebaseapp.com",
    projectId: "ali-cafe-menu",
    storageBucket: "ali-cafe-menu.appspot.com",
    messagingSenderId: "50748629603",
    appId: "1:50748629603:web:74a14f151d617c51b50e56",
    measurementId: "G-J8W87J7KLW"
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

// Let the app know when Firestore is ready (persistence is optional).
window.dbReady = Promise.resolve(db);
try {
    window.dbReady = db.enablePersistence({ synchronizeTabs: true })
        .then(function () {
            console.log('Firestore offline persistence enabled (multi-tab)');
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
} catch (error) {
    console.error('Persistence setup error:', error);
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