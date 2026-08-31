import { useState, useEffect } from 'react'
import { loginWithCertilogia, setSessionToken, fetchRosterBundle } from '../api'
import { saveProfile } from '../hooks/useAuth'

// Connexion unique : identifiants Certilogia (hub interne Certideal),
// validés côté serveur (api/certilogia-login.js) contre certilogia-admin,
// puis session propre à l'app (Neon) — aucun mot de passe séparé à
// maintenir, donc aucun risque de désynchronisation si le mot de passe
// Certilogia change.
// Étape 2 (première connexion) : choisir son nom dans le personnel RH.

export default function AuthScreen({ authed, onProfileSaved }) {
  const [rosterNames, setRosterNames] = useState([])
  const [rosterError, setRosterError] = useState('')
  useEffect(() => {
    if (!authed) return
    fetchRosterBundle()
      .then(d => setRosterNames(d.employees.map(i => i.name)))
      .catch(() => setRosterError('Impossible de charger la liste du personnel — réessayez.'))
  }, [authed])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [selectedName, setSelectedName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // ── Connecté mais pas encore de profil lié → sélecteur de nom ──
  if (authed) {
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
                await saveProfile(null, selectedName)
                onProfileSaved()
              } catch {
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token } = await loginWithCertilogia(email, password)
      setSessionToken(token)
      onProfileSaved()
    } catch (err) {
      setError(err.message || 'Erreur de connexion, réessayez')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">🏖️</div>
        <h1>Congés Équipe</h1>
        <p>Certideal</p>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
          Utilisez votre email et mot de passe <strong>Certilogia</strong> (hub interne Certideal).
        </p>

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
          <div style={{ marginBottom: 6 }}>
            <label>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? 'Chargement...' : 'Se connecter avec Certilogia →'}
          </button>
        </form>
      </div>
    </div>
  )
}
