import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { fetchProfile, saveProfileApi } from '../api'

// Firebase = AUTHENTIFICATION uniquement (identité + mot de passe, y compris
// via l'onglet Certilogia). Le profil (compte -> nom du personnel) vit dans
// Neon et peut être 'pending' (liaison en attente de validation admin quand
// l'email de connexion ne correspond pas à l'email RH).
// Les rôles (admin global, encadrant) dépendent de la config en base et de
// la chaîne de commandement — calculés dans App après chargement du roster.

export async function saveProfile(_uid, name) {
  return saveProfileApi(name) // -> { ok, name, status }
}

export function useAuth() {
  const [state, setState] = useState({
    firebaseUser: undefined, // undefined = loading, null = logged out
    profile: null,
    loading: true,
  })

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState({ firebaseUser: null, profile: null, loading: false })
        return
      }
      let profile = null
      try {
        profile = await fetchProfile() // { name, status } | null
      } catch (err) {
        console.error('profile load failed:', err)
      }
      setState({ firebaseUser: fbUser, profile, loading: false })
    })
    return unsub
  }, [])

  return state
}
