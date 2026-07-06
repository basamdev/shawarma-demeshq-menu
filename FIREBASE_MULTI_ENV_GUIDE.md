# Firebase multi-environment setup

The app now supports two Firebase configurations:

- Development environment: localhost and local test hosts
- Production environment: Vercel, Netlify, or other live hosts

## How it works

The shared Firebase bootstrap in js/firebase.js chooses the config automatically:

- localhost or .local/.test hosts -> development config
- all other hosts -> production config

You can also force it manually with:

- ?firebaseEnv=development
- ?firebaseEnv=production

## What to change

Open js/firebase.js and replace the two config objects with your own Firebase project values:

- development config
- production config

## Firebase projects you need

Create two separate Firebase projects in the Firebase Console:

1. Development project
2. Production project

Use the same Firestore rules file for both projects if you want the same access rules.

## Deployment notes

- GitHub stores your source code
- Vercel or Netlify hosts the frontend
- Firebase provides Auth + Firestore

These are independent services, but they must point to the correct Firebase project in js/firebase.js.
