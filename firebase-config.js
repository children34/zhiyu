// firebase-config.js
// TODO: Replace the placeholder values with your Firebase project configuration.
const firebaseConfig = {
    apiKey: "AIzaSyCFHp1ApctnaHVxzZrEk07yC8vadHWcxek",
    authDomain: "zhiyu-0304.firebaseapp.com",
    projectId: "zhiyu-0304",
    storageBucket: "zhiyu-0304.firebasestorage.app",
    messagingSenderId: "1049290057230",
    appId: "1:1049290057230:web:f76cbbe5f3302457a4fe5f",
    measurementId: "G-6ET3LT9J6W"
  };

firebase.initializeApp(firebaseConfig);
window.auth = firebase.auth();
window.db = firebase.firestore();
