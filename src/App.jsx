import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { useAuth } from './hooks/useAuth'
import { fetchLeaves, fetchEmployees, addLeave, decideLeave, deleteLeave } from './api'
import { canDecide, managedTeams } from './leavePolicy'
import { sameName } from './utils/names'
import Calendar from './components/Calendar'
import AuthScreen from './components/AuthScreen'
import LeaveForm from './components/LeaveForm'
import Approvals from './components/Approvals'
import Presence from './components/Presence'
import TeamSettings from './components/TeamSettings'
import './App.css'

export default function App() {
  const { firebaseUser, profile, isGlobalAdmin, loading: authLoading } = useAuth()
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

  const me = employees.find(e => sameName(e.name, user)) || null
  const myLeaves = leaves.filter(l => sameName(l.employee, user))

  // Pôles gérés (organigramme RH + EXTRA_APPROVERS) : '*' = admin global.
  const myManagedTeams = user ? managedTeams(user, employees) : []
  const canApprove = myManagedTeams === '*' || myManagedTeams.length > 0

  // Équipes visibles : admin global → toutes ; approbateur → ses pôles gérés
  // (+ le sien) ; employé → le sien.
  const visibleTeams = myManagedTeams === '*'
    ? [...new Set(employees.map(e => e.team))]
    : [...new Set([...myManagedTeams, me?.team].filter(Boolean))]
  const visibleEmployees = employees.filter(e => visibleTeams.includes(e.team))
  const visibleEmployeeNames = visibleEmployees.map(e => e.name)

  // Congés visibles : les approbateurs voient leurs équipes ; un employé voit
  // les siens (choix de confidentialité de Laure conservé).
  const visibleLeaves = canApprove
    ? leaves.filter(l => visibleEmployeeNames.some(n => sameName(n, l.employee)))
    : myLeaves

  // Demandes que JE peux décider (badge + onglet Approbations).
  const decidable = leaves.filter(l => l.status === 'pending' && canDecide(user, l.employee, employees))
  const pendingCount = decidable.length

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
      const targetEmployee = leave.employee || user
      const created = await addLeave(
        { ...leave, employee: targetEmployee, submittedBy: user },
        employees
      )
      await loadAll()
      showNotification(
        created.status === 'pending' ? 'Demande envoyée pour approbation ✓'
          : created.type === 'arret_maladie' ? 'Absence déclarée ✓'
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
      await decideLeave(id, user, action, employees)
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
    { key: 'team', label: '⚙️ Équipes' },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <img className="logo-icon" src="/logo.svg" alt="CertiDeal" width="34" height="34" />
          <div>
            <div className="app-title">Congés Équipe</div>
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
          <span className="user-badge">{user}{isGlobalAdmin ? ' 👑' : canApprove ? ' ⭐' : ''}</span>
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
              employees={canApprove ? visibleEmployees : [me].filter(Boolean)}
              currentUser={user}
              isAdmin={canApprove}
              onDelete={handleDeleteLeave}
            />
          )}
          {view === 'presence' && (
            <Presence
              employees={employees}
              leaves={leaves}
              currentUser={user}
              visibleTeams={visibleTeams}
              showFilter={isGlobalAdmin || visibleTeams.length > 1}
            />
          )}
          {view === 'approvals' && canApprove && (
            <Approvals
              employees={employees}
              pending={decidable}
              onDecide={handleDecide}
            />
          )}
          {view === 'team' && (
            <TeamSettings employees={employees} />
          )}
          {view === 'request' && (
            <LeaveForm
              currentUser={user}
              isSuperAdmin={canApprove}
              visibleEmployees={visibleEmployeeNames}
              myLeaves={myLeaves}
              allLeaves={leaves}
              roster={employees}
              onSubmit={handleSubmitLeave}
              onCancel={() => setView('calendar')}
            />
          )}
        </>
      )}
    </div>
  )
}
