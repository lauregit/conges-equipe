import { useState } from 'react'
import { EMPLOYEES, ADMIN_NAME } from '../employees'

const ALL_USERS = [ADMIN_NAME, ...EMPLOYEES]

export default function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (selected) onLogin(selected)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">🏖️</div>
        <h1>Calendrier Congés</h1>
        <p>Équipe Marketing — Certideal</p>
        <form onSubmit={handleSubmit}>
          <label>Je suis...</label>
          <select value={selected} onChange={e => setSelected(e.target.value)} required>
            <option value="">— Sélectionner mon nom —</option>
            {ALL_USERS.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary" disabled={!selected}>
            Accéder au calendrier →
          </button>
        </form>
      </div>
    </div>
  )
}
