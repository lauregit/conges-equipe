import { useState, useEffect } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth } from '../firebase'
import { saveProfile } from '../hooks/useAuth'

// Step 1 – Login or Signup
// Step 2 – After signup: pick your name from the RH Compliance personnel list

// SSO interne : les identifiants Certilogia (hub certideal) sont validés par
// certilogia-admin, puis un compte Firebase miroir (même email + mot de passe)
// est connecté/créé silencieusement — Firestore exige un utilisateur Firebase.
const CERTILOGIA_ADMIN = 'https://certilogia-admin.vercel.app'

export default function AuthScreen({ firebaseUser, onProfileSaved }) {
  // Personnel officiel (RH Compliance) pour le sélecteur de nom.
  const [rosterNames, setRosterNames] = useState([])
  const [rosterError, setRosterError] = useState('')
  useEffect(() => {
    if (!firebaseUser) return
    fetch('/api/roster')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => setRosterNames(d.items.map(i => i.name)))
      .catch(() => setRosterError('Impossible de charger la liste du personnel — réessayez.'))
  }, [firebaseUser])
  const [tab, setTab] = useState('certilogia') // 'certilogia' | 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  // Profile setup (shown after first signup)
  const [selectedName, setSelectedName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // ── If user is logged in but has no profile yet → show name picker ──
  if (firebaseUser) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">🏖️</div>
          <h1>Qui êtes-vous ?</h1>
          <p>Associez votre compte à votre nom dans l'équipe</p>
          <label>Mon nom</label>
          <select value={selectedName} onChange={e => setSelectedName(e.target.value)}>
            <option value="">
              {rosterNames.length === 0 && !rosterError ? 'Chargement du personnel…' : '— Sélectionner mon nom —'}
            </option>
            {rosterNames.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {rosterError && <p className="auth-error">{rosterError}</p>}
          {error && <p className="auth-error">{error}</p>}
          <button
            className="btn-primary"
            style={{ width: '100%', marginTop: 16, padding: 11 }}
            disabled={!selectedName || savingProfile}
            onClick={async () => {
              setSavingProfile(true)
              setError('')
              try {
                await saveProfile(firebaseUser.uid, selectedName, firebaseUser.email)
                onProfileSaved()
              } catch (e) {
                setError("Erreur lors de l'enregistrement")
                setSavingProfile(false)
              }
            }}
          >
            {savingProfile ? 'Enregistrement...' : 'Confirmer →'}
          </button>
        </div>
      </div>
    )
  }

  // ── Login / Signup form ──
  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (tab === 'signup' && password !== confirm) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    if (tab !== 'certilogia' && password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caractères')
      return
    }
    setLoading(true)
    try {
      if (tab === 'certilogia') {
        await loginWithCertilogia()
      } else if (tab === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
        // onAuthStateChanged will fire → profile is null → shows name picker
      }
    } catch (err) {
      setError(err.friendly || friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  // 1) Valide les identifiants auprès de certilogia-admin (SSO interne).
  // 2) Connecte (ou crée) le compte Firebase miroir avec les mêmes identifiants
  //    — Firestore exige un utilisateur Firebase.
  async function loginWithCertilogia() {
    let res
    try {
      res = await fetch(`${CERTILOGIA_ADMIN}/api/auth-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      const e = new Error('offline'); e.friendly = 'Certilogia injoignable — réessayez.'; throw e
    }
    if (res.status === 401) { const e = new Error('bad'); e.friendly = 'Identifiants Certilogia incorrects'; throw e }
    if (res.status === 403) { const e = new Error('off'); e.friendly = 'Compte Certilogia désactivé'; throw e }
    if (!res.ok) { const e = new Error('err'); e.friendly = 'Erreur Certilogia — réessayez.'; throw e }
    const { session } = await res.json()
    // Jeton conservé (convention certilogia_token) pour d'éventuels appels API.
    localStorage.setItem('certilogia_token', session.token)
    localStorage.setItem('certilogia_user', JSON.stringify(session.user))

    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        await createUserWithEmailAndPassword(auth, email, password)
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        // Le compte miroir existe avec un ancien mot de passe : tenter la
        // création échouerait aussi — guider vers la réinitialisation.
        try {
          await createUserWithEmailAndPassword(auth, email, password)
        } catch {
          const e = new Error('drift')
          e.friendly = 'Votre mot de passe Certilogia a changé — cliquez « Mot de passe oublié » (onglet Connexion) pour resynchroniser le compte lié.'
          throw e
        }
      } else {
        throw err
      }
    }
  }

  async function handleReset() {
    if (!email) { setError('Entrez votre email d\'abord'); return }
    try {
      await sendPasswordResetEmail(auth, email)
      setInfo('Email de réinitialisation envoyé ✓')
    } catch {
      setError('Email introuvable')
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">🏖️</div>
        <h1>Congés Équipe Marketing</h1>
        <p>Certideal</p>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'certilogia' ? 'active' : ''}`}
            onClick={() => { setTab('certilogia'); setError(''); setInfo('') }}
          >🔑 Certilogia</button>
          <button
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); setInfo('') }}
          >Connexion</button>
          <button
            className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => { setTab('signup'); setError(''); setInfo('') }}
          >Créer un compte</button>
        </div>

        {tab === 'certilogia' && (
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            Utilisez votre email et mot de passe <strong>Certilogia</strong> (hub interne Certideal).
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="prenom.nom@certideal.com"
              required
              autoFocus
            />
          </div>
          <div style={{ marginBottom: tab === 'signup' ? 14 : 6 }}>
            <label>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {tab === 'signup' && (
            <div style={{ marginBottom: 14 }}>
              <label>Confirmer le mot de passe</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}
          {info && <p className="auth-info">{info}</p>}

          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? 'Chargement...'
              : tab === 'certilogia' ? 'Se connecter avec Certilogia →'
              : tab === 'login' ? 'Se connecter →'
              : 'Créer mon compte →'}
          </button>

          {tab === 'login' && (
            <button type="button" className="auth-forgot" onClick={handleReset}>
              Mot de passe oublié ?
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

function friendlyError(code) {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email ou mot de passe incorrect'
    case 'auth/email-already-in-use':
      return 'Un compte existe déjà avec cet email'
    case 'auth/invalid-email':
      return 'Email invalide'
    case 'auth/too-many-requests':
      return 'Trop de tentatives, réessayez dans quelques minutes'
    default:
      return 'Erreur de connexion, réessayez'
  }
}
