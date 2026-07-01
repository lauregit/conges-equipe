import { useState, useEffect, useCallback } from 'react'
import { fetchLeaves, addLeave, deleteLeave } from './api'
import { ADMIN_NAME } from './employees'
import Calendar from './components/Calendar'
import LoginScreen from './components/LoginScreen'
import LeaveForm from './components/LeaveForm'
import './App.css'

export default function App() {
  const [user, setUser] = useState(() => sessionStorage.getItem('user') || null)
  const [leaves, setLeaves] = useState([])
  const [view, setView] = useState('calendar')
  const [notification, setNotification] = useState(null)

  const loadLeaves = useCallback(async () => {
    try {
      setLeaves(await fetchLeaves())
    } catch (err) {
      console.error(err)
    }
  }, [])

  // No push channel on Postgres like Firestore's onSnapshot. Instead of
  // polling, refresh whenever someone connects (mount) or returns to the tab.
  useEffect(() => {
    loadLeaves()
    const onFocus = () => {
      if (document.visibilityState === 'visible') loadLeaves()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [loadLeaves])

  const isAdmin = user === ADMIN_NAME

  function handleLogin(name) {
    setUser(name)
    sessionStorage.setItem('user', name)
  }

  function handleLogout() {
    setUser(null)
    sessionStorage.removeItem('user')
    setView('calendar')
  }

  async function handleSubmitLeave(leave) {
    await addLeave({ employee: user, ...leave })
    await loadLeaves()
    showNotification('Congé enregistré ✓')
    setView('calendar')
  }

  async function handleDeleteLeave(id) {
    await deleteLeave(id)
    await loadLeaves()
    showNotification('Congé supprimé')
  }

  function showNotification(msg) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo-icon">🏖️</span>
          <div>
            <div className="app-title">Congés Équipe Marketing</div>
            <div className="app-sub">Certideal</div>
          </div>
        </div>
        <div className="header-right">
          <span className="user-badge">{user}{isAdmin ? ' 👑' : ''}</span>
          {view === 'calendar' ? (
            <button className="btn-primary" onClick={() => setView('request')}>
              + Poser un congé
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => setView('calendar')}>
              ← Calendrier
            </button>
          )}
          <button className="btn-logout" onClick={handleLogout}>Déco</button>
        </div>
      </header>

      {notification && <div className="notification">{notification}</div>}

      {view === 'calendar' && (
        <Calendar
          leaves={leaves}
          currentUser={user}
          isAdmin={isAdmin}
          onDelete={handleDeleteLeave}
        />
      )}
      {view === 'request' && (
        <LeaveForm onSubmit={handleSubmitLeave} onCancel={() => setView('calendar')} />
      )}
    </div>
  )
}
