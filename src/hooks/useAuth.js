import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { GLOBAL_SUPER_ADMINS } from '../employees'
import { normName } from '../utils/names'

// Loads or creates the Firestore user profile for a Firebase user.
export async function loadOrCreateProfile(firebaseUser) {
  const ref = doc(db, 'users', firebaseUser.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data()
  return null // Profile not set yet → app shows name picker
}

export async function saveProfile(uid, name, email) {
  const ref = doc(db, 'users', uid)
  await setDoc(ref, { name, email })
  return { name, email }
}

export function useAuth() {
  const [state, setState] = useState({
    firebaseUser: undefined, // undefined = loading, null = logged out
    profile: null,
    isGlobalAdmin: false,
    loading: true,
  })

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState({ firebaseUser: null, profile: null, isGlobalAdmin: false, loading: false })
        return
      }
      const profile = await loadOrCreateProfile(fbUser)
      const name = profile?.name
      // Les rôles manager dépendent de l'organigramme RH (chargé après login) ;
      // seul le statut d'admin global est connu statiquement.
      setState({
        firebaseUser: fbUser,
        profile,
        isGlobalAdmin: name
          ? GLOBAL_SUPER_ADMINS.some(a => normName(a) === normName(name))
          : false,
        loading: false,
      })
    })
    return unsub
  }, [])

  return state
}
