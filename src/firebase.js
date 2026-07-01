import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyPlaceholderKeyReplaceWithYours",
  authDomain: "conges-certideal.firebaseapp.com",
  projectId: "conges-certideal",
  storageBucket: "conges-certideal.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:000000000000000000000000"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
