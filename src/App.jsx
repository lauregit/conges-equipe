import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const notifTimer = useRef(null)

  const loadLeaves = useCallback(async () => {
    try {
      setLeaves(await fetchLeaves())
      setLoadError(null)
    } catch (err) {
      console.error(err)
      setLoadError(err.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
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
  const myLeaves = leaves.filter(l => l.employee === user)

  function handleLogin(name) {
    setUser(name)
    sessionStorage.setItem('user', name)
  }

  function handleLogout() {
    setUser(null)
    sessionStorage.removeItem('user')
    setView('calendar')
  }

  // Throws on failure so LeaveForm can keep the form open and re-enable submit.
  async function handleSubmitLeave(leave) {
    try {
      await addLeave({ employee: user, ...leave })
      await loadLeaves()
      showNotification('Congé enregistré ✓')
      setView('calendar')
    } catch (err) {
      showNotification(err.message || "Échec de l'enregistrement", 'error')
      throw err
    }
  }

  async function handleDeleteLeave(id) {
    try {
      await deleteLeave(id, user)
      await loadLeaves()
      showNotification('Congé supprimé')
    } catch (err) {
      showNotification(err.message || 'Échec de la suppression', 'error')
    }
  }

  function showNotification(msg, type = 'success') {
    if (notifTimer.current) clearTimeout(notifTimer.current)
    setNotification({ msg, type })
    notifTimer.current = setTimeout(() => setNotification(null), type === 'error' ? 5000 : 3000)
  }

  // Clear a pending notification timer on unmount.
  useEffect(() => () => { if (notifTimer.current) clearTimeout(notifTimer.current) }, [])

  if (!user) return <LoginScreen onLogin={handleLogin} />

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <img className="logo-icon" src="/logo.svg" alt="CertiDeal" width="34" height="34" />
          <div>
            <div className="app-title">Congés Équipe Marketing</div>
            <div className="app-sub">CertiDeal</div>
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

      {notification && (
        <div className={`notification notification-${notification.type}`} role="status">
          {notification.msg}
        </div>
      )}

      {loadError && view === 'calendar' && (
        <div className="banner banner-error" role="alert">
          ⚠️ {loadError} · <button className="banner-retry" onClick={loadLeaves}>Réessayer</button>
        </div>
      )}

      {view === 'calendar' && (
        loading && leaves.length === 0 ? (
          <div className="loading-state">Chargement des congés…</div>
        ) : (
          <Calendar
            leaves={leaves}
            currentUser={user}
            isAdmin={isAdmin}
            onDelete={handleDeleteLeave}
          />
        )
      )}
      {view === 'request' && (
        <LeaveForm
          myLeaves={myLeaves}
          onSubmit={handleSubmitLeave}
          onCancel={() => setView('calendar')}
        />
      )}
    </div>
  )
}
