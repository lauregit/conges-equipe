import { useState, useEffect, useCallback } from 'react'
import { getSessionToken, clearSessionToken, fetchProfile, saveProfileApi } from '../api'

// Session maison (Neon), pas Firebase : le jeton signé par
// api/_session.js après validation Certilogia est stocké en localStorage.
// Au montage, on le valide en rechargeant le profil — un jeton expiré/
// invalide (401) déconnecte silencieusement.

export async function saveProfile(_uid, name) {
  return saveProfileApi(name) // -> { ok, name, status }
}

export function useAuth() {
  const [state, setState] = useState({
    authed: undefined, // undefined = loading, false = logged out, true = logged in
    profile: null,
    loading: true,
  })

  const refresh = useCallback(async () => {
    const token = getSessionToken()
    if (!token) {
      setState({ authed: false, profile: null, loading: false })
      return
    }
    try {
      const profile = await fetchProfile() // { name, status } | null
      setState({ authed: true, profile, loading: false })
    } catch (err) {
      console.error('profile load failed:', err)
      // Jeton invalide/expiré : la session n'a plus de sens, on nettoie.
      if (String(err.message || '').match(/connexion requise/i)) clearSessionToken()
      setState({ authed: false, profile: null, loading: false })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { ...state, refresh }
}
