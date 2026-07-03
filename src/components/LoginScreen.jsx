import { useState } from 'react'

export default function LoginScreen({ employees, loading, onLogin }) {
  const [selected, setSelected] = useState('')
  const names = employees.filter(e => e.active).map(e => e.name)

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
            <option value="">
              {loading && names.length === 0 ? 'Chargement…' : '— Sélectionner mon nom —'}
            </option>
            {names.map(name => (
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
