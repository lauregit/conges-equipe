import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyCJxuSUyIbaaKa8xfZrHaXW_ov8YLT7xFg",
  authDomain: "conges-certideal.firebaseapp.com",
  projectId: "conges-certideal",
  storageBucket: "conges-certideal.firebasestorage.app",
  messagingSenderId: "585468888385",
  appId: "1:585468888385:web:ced2926afcd93e1aa20dc0",
  measurementId: "G-8S7RRZDR8G"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
