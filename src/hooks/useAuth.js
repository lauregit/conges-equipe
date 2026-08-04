import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { GLOBAL_SUPER_ADMINS } from '../employees'
import { normName } from '../utils/names'
import { fetchProfile, saveProfileApi } from '../api'

// Firebase ne sert qu'à l'AUTHENTIFICATION (identité + mot de passe).
// Le profil (uid -> nom du personnel) vit dans Neon via /api/profile.

export async function loadOrCreateProfile(firebaseUser) {
  return fetchProfile(firebaseUser.uid) // null si pas encore de profil → name picker
}

export async function saveProfile(uid, name, email) {
  await saveProfileApi(uid, name, email)
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
      let profile = null
      try {
        profile = await loadOrCreateProfile(fbUser)
      } catch (err) {
        console.error('profile load failed:', err)
      }
      const name = profile?.name
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
