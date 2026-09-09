export async function onRequestGet({ env }) {
  const fbConfig = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN || "stewardmd-498ec.firebaseapp.com",
    projectId: env.FIREBASE_PROJECT_ID || "stewardmd-498ec",
    storageBucket: env.FIREBASE_STORAGE_BUCKET || "stewardmd-498ec.firebasestorage.app",
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || "911280405587",
    appId: env.FIREBASE_APP_ID || "1:911280405587:web:d09038e15e98d69dc79aa6"
  };
  return new Response(JSON.stringify(fbConfig), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
