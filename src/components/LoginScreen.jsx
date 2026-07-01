import { useState } from 'react'
import { ALL_EMPLOYEES } from '../employees'

export default function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (selected) onLogin(selected)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <img className="login-logo" src="/logo.svg" alt="CertiDeal" width="72" height="72" />
        <h1>Calendrier Congés</h1>
        <p>Équipe Marketing — CertiDeal</p>
        <form onSubmit={handleSubmit}>
          <label>Je suis...</label>
          <select value={selected} onChange={e => setSelected(e.target.value)} required>
            <option value="">— Sélectionner mon nom —</option>
            {ALL_EMPLOYEES.map(name => (
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
