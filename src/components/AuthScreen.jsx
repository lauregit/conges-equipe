import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth } from '../firebase'
import { saveProfile } from '../hooks/useAuth'
import { ALL_EMPLOYEES } from '../employees'

// Step 1 – Login or Signup
// Step 2 – After signup: pick your name from the list

export default function AuthScreen({ firebaseUser, onProfileSaved }) {
  const [tab, setTab] = useState('login') // 'login' | 'signup'
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
            <option value="">— Sélectionner mon nom —</option>
            {ALL_EMPLOYEES.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
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
    if (password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caractères')
      return
    }
    setLoading(true)
    try {
      if (tab === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
        // onAuthStateChanged will fire → profile is null → shows name picker
      }
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
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
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); setInfo('') }}
          >Connexion</button>
          <button
            className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => { setTab('signup'); setError(''); setInfo('') }}
          >Créer un compte</button>
        </div>

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
            {loading ? 'Chargement...' : tab === 'login' ? 'Se connecter →' : 'Créer mon compte →'}
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
