import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { SUPER_ADMIN_NAMES, GLOBAL_SUPER_ADMINS, getTeamOf, getVisibleTeams } from '../employees'

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
    isSuperAdmin: false,
    loading: true,
  })

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState({ firebaseUser: null, profile: null, isSuperAdmin: false, loading: false })
        return
      }
      const profile = await loadOrCreateProfile(fbUser)
      const name = profile?.name
      setState({
        firebaseUser: fbUser,
        profile,
        isSuperAdmin: name ? SUPER_ADMIN_NAMES.includes(name) : false,
        isGlobalAdmin: name ? GLOBAL_SUPER_ADMINS.includes(name) : false,
        myTeam: name ? getTeamOf(name) : null,
        visibleTeamKeys: name ? getVisibleTeams(name) : [],
        loading: false,
      })
    })
    return unsub
  }, [])

  return state
}
