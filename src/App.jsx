import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { useAuth } from './hooks/useAuth'
import { fetchLeaves, fetchEmployees, addLeave, decideLeave, deleteLeave, saveEmployee } from './api'
import { DECLARED_TYPES } from './constants'
import { SUPER_ADMIN_NAMES, ALL_EMPLOYEES } from './employees'
import Calendar from './components/Calendar'
import AuthScreen from './components/AuthScreen'
import LeaveForm from './components/LeaveForm'
import Approvals from './components/Approvals'
import Presence from './components/Presence'
import TeamSettings from './components/TeamSettings'
import './App.css'

export default function App() {
  const { firebaseUser, profile, isSuperAdmin, visibleTeamKeys, loading: authLoading } = useAuth()
  const [leaves, setLeaves] = useState([])
  const [employees, setEmployees] = useState([])
  const [view, setView] = useState('calendar')
  const [notification, setNotification] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const notifTimer = useRef(null)

  const user = profile?.name || null

  const loadAll = useCallback(async () => {
    try {
      const [l, e] = await Promise.all([fetchLeaves(), fetchEmployees()])
      setLeaves(l)
      setEmployees(e)
      setLoadError(null)
    } catch (err) {
      console.error(err)
      setLoadError(err.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    loadAll()
    const onFocus = () => { if (document.visibilityState === 'visible') loadAll() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [loadAll, user])

  const me = employees.find(e => e.name === user)
  const isAdmin = isSuperAdmin || me?.role === 'admin'
  const isManager = me?.role === 'manager'
  const canApprove = isAdmin || isManager
  const myLeaves = leaves.filter(l => l.employee === user)

  // Congés visibles selon le rôle (filtrés par équipe pour les super admins)
  const visibleEmployeeNames = isSuperAdmin
    ? employees.filter(e => visibleTeamKeys.includes(e.teamKey)).map(e => e.name)
    : [user]
  const visibleLeaves = leaves.filter(l => visibleEmployeeNames.includes(l.employee))

  const teamOf = name => employees.find(e => e.name === name)?.team
  const pendingCount = leaves.filter(l =>
    l.status === 'pending' &&
    (isAdmin || (isManager && teamOf(l.employee) === me?.team && l.employee !== user))
  ).length

  async function handleLogout() {
    await signOut(auth)
    setView('calendar')
    setLeaves([])
    setEmployees([])
  }

  function handleProfileSaved() {
    // onAuthStateChanged will re-fire and reload the profile automatically
    window.location.reload()
  }

  // Throws on failure so LeaveForm can keep the form open and re-enable submit.
  async function handleSubmitLeave(leave) {
    try {
      const declared = DECLARED_TYPES.includes(leave.type)
      // Super admins can submit for any employee (employee comes from the form)
      const targetEmployee = leave.employee || user
      const created = await addLeave({ employee: targetEmployee, ...leave })
      await loadAll()
      // The server decides whether the team requires approval.
      showNotification(
        created.status === 'pending' ? 'Demande envoyée pour approbation ✓'
          : declared ? 'Absence déclarée ✓'
          : 'Congé enregistré ✓'
      )
      setView('calendar')
    } catch (err) {
      showNotification(err.message || "Échec de l'enregistrement", 'error')
      throw err
    }
  }

  async function handleDecide(id, action) {
    try {
      await decideLeave(id, user, action)
      await loadAll()
      showNotification(action === 'approve' ? 'Demande approuvée ✓' : 'Demande refusée')
    } catch (err) {
      showNotification(err.message || 'Échec du traitement', 'error')
    }
  }

  async function handleDeleteLeave(id) {
    try {
      await deleteLeave(id, user)
      await loadAll()
      showNotification('Congé supprimé')
    } catch (err) {
      showNotification(err.message || 'Échec de la suppression', 'error')
    }
  }

  async function handleSaveEmployee(employee) {
    try {
      await saveEmployee(user, employee)
      await loadAll()
      showNotification('Équipe mise à jour ✓')
    } catch (err) {
      showNotification(err.message || "Échec de l'enregistrement", 'error')
      throw err
    }
  }

  function showNotification(msg, type = 'success') {
    if (notifTimer.current) clearTimeout(notifTimer.current)
    setNotification({ msg, type })
    notifTimer.current = setTimeout(() => setNotification(null), type === 'error' ? 5000 : 3000)
  }

  // Clear a pending notification timer on unmount.
  useEffect(() => () => { if (notifTimer.current) clearTimeout(notifTimer.current) }, [])

  // Still resolving Firebase auth state
  if (authLoading) return <div className="loading-state" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Chargement…</div>

  // Not logged in, or logged in but no profile yet
  if (!firebaseUser || !profile) return (
    <AuthScreen firebaseUser={firebaseUser || null} onProfileSaved={handleProfileSaved} />
  )

  const TABS = [
    { key: 'calendar', label: '📅 Calendrier' },
    { key: 'presence', label: '👥 Présence' },
    ...(canApprove ? [{ key: 'approvals', label: `✅ Approbations${pendingCount ? ` (${pendingCount})` : ''}` }] : []),
    ...(isAdmin ? [{ key: 'team', label: '⚙️ Équipe' }] : []),
  ]

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
        <nav className="header-tabs" aria-label="Navigation">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`tab-btn ${view === t.key ? 'tab-active' : ''}`}
              onClick={() => setView(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="user-badge">{user}{isSuperAdmin ? ' 👑' : isManager ? ' ⭐' : ''}</span>
          <button className="btn-primary" onClick={() => setView('request')}>
            + Poser un congé
          </button>
          <button className="btn-logout" onClick={handleLogout}>Déco</button>
        </div>
      </header>

      {notification && (
        <div className={`notification notification-${notification.type}`} role="status">
          {notification.msg}
        </div>
      )}

      {loadError && view !== 'request' && (
        <div className="banner banner-error" role="alert">
          ⚠️ {loadError} · <button className="banner-retry" onClick={loadAll}>Réessayer</button>
        </div>
      )}

      {loading && leaves.length === 0 && employees.length === 0 ? (
        <div className="loading-state">Chargement…</div>
      ) : (
        <>
          {view === 'calendar' && (
            <Calendar
              leaves={visibleLeaves}
              employees={employees}
              currentUser={user}
              isAdmin={isAdmin}
              isSuperAdmin={isSuperAdmin}
              visibleTeamKeys={visibleTeamKeys}
              onDelete={handleDeleteLeave}
            />
          )}
          {view === 'presence' && (
            <Presence employees={employees} leaves={leaves} currentUser={user} />
          )}
          {view === 'approvals' && canApprove && (
            <Approvals
              employees={employees}
              leaves={leaves}
              currentUser={user}
              onDecide={handleDecide}
            />
          )}
          {view === 'team' && isAdmin && (
            <TeamSettings employees={employees} onSave={handleSaveEmployee} />
          )}
          {view === 'request' && (
            <LeaveForm
              currentUser={user}
              isSuperAdmin={isSuperAdmin}
              visibleEmployees={visibleEmployeeNames}
              myLeaves={myLeaves}
              allLeaves={visibleLeaves}
              teamHasManager={employees.some(e =>
                e.active && e.role === 'manager' && e.team === me?.team
              )}
              onSubmit={handleSubmitLeave}
              onCancel={() => setView('calendar')}
            />
          )}
        </>
      )}
    </div>
  )
}
