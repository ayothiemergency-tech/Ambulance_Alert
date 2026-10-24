// ============================================================================
//  THE ONLY FILE YOU EDIT.
//
//  Firebase Console  ->  gear icon (Project settings)  ->  General  ->  "Your apps"
//  -> your web app  ->  SDK setup and configuration  ->  "Config".
//  Copy the values from there into the fields below, keeping the quotes.
//
//  IMPORTANT: databaseURL must be present. For a Singapore database it looks like
//    https://YOUR-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app
//  (Firebase > Build > Realtime Database > Data tab shows this exact address at the top.)
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyB7Lh8trpy76d8r-cZWYmkiiogo_pwwefU",
  authDomain: "ambulance-alert-system-f5666.firebaseapp.com",
  databaseURL: "https://ambulance-alert-system-f5666-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ambulance-alert-system-f5666",
  storageBucket: "ambulance-alert-system-f5666.firebasestorage.app",
  messagingSenderId: "588463033845",
  appId: "1:588463033845:web:74d6f83d47f84ed70d64bc",
};

// Name of this vehicle in the database. Leave as it is.
export const DEVICE_ID = "unit1";
