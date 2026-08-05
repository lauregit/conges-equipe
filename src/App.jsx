import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { useAuth } from './hooks/useAuth'
import { fetchLeaves, fetchRosterBundle, addLeave, decideLeave, deleteLeave } from './api'
import { canDecide, canSee, subtreeOf, isApprover, isGlobalAdmin } from './leavePolicy'
import { sameName } from './utils/names'
import Calendar from './components/Calendar'
import AuthScreen from './components/AuthScreen'
import LeaveForm from './components/LeaveForm'
import Approvals from './components/Approvals'
import Presence from './components/Presence'
import TeamSettings from './components/TeamSettings'
import AdminPanel from './components/AdminPanel'
import './App.css'

export default function App() {
  const { firebaseUser, profile, loading: authLoading } = useAuth()
  const [leaves, setLeaves] = useState([])
  const [employees, setEmployees] = useState([])
  const [config, setConfig] = useState({ globalAdmins: [], extraApprovers: {} })
  const [view, setView] = useState('calendar')
  const [notification, setNotification] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const notifTimer = useRef(null)

  const user = profile?.name || null
  const profileApproved = profile?.status === 'approved'

  const loadAll = useCallback(async () => {
    try {
      const [l, bundle] = await Promise.all([fetchLeaves(), fetchRosterBundle()])
      setLeaves(l)
      setEmployees(bundle.employees)
      setConfig(bundle.config)
      setLoadError(null)
    } catch (err) {
      console.error(err)
      setLoadError(err.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user || !profileApproved) return
    loadAll()
    const onFocus = () => { if (document.visibilityState === 'visible') loadAll() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [loadAll, user, profileApproved])

  const me = employees.find(e => sameName(e.name, user)) || null
  const amGlobalAdmin = user ? isGlobalAdmin(user, config) : false
  const canApprove = user ? isApprover(user, employees, config) : false
  const myLeaves = leaves.filter(l => sameName(l.employee, user))

  // Périmètre : soi-même + son SOUS-ARBRE (chaîne de commandement).
  // Les admins globaux voient tout.
  const mySubtree = user ? subtreeOf(user, employees, config) : []
  const visibleEmployees = employees.filter(e =>
    sameName(e.name, user) || mySubtree.some(n => sameName(n, e.name))
  )
  const visibleEmployeeNames = visibleEmployees.map(e => e.name)

  // Congés en clair de mon périmètre (le serveur ne fournit de toute façon
  // que des silhouettes pour le reste).
  const visibleLeaves = leaves.filter(l =>
    canSee(user, l.employee, employees, config)
  )

  // Demandes que JE peux décider (superviseur RH désigné, ou admin global).
  const decidable = leaves.filter(l =>
    l.status === 'pending' && canDecide(user, l.employee, employees, config)
  )
  const pendingCount = decidable.length

  // Historique des demandes de mon sous-arbre (vue manager).
  const subtreeLeaves = leaves.filter(l =>
    !l.restricted && mySubtree.some(n => sameName(n, l.employee))
  )

  async function handleLogout() {
    await signOut(auth)
    localStorage.removeItem('certilogia_token')
    localStorage.removeItem('certilogia_user')
    setView('calendar')
    setLeaves([])
    setEmployees([])
  }

  function handleProfileSaved() {
    window.location.reload()
  }

  async function handleSubmitLeave(leave) {
    try {
      const created = await addLeave({ ...leave, employee: leave.employee || user })
      await loadAll()
      showNotification(
        created.status === 'pending' ? 'Demande envoyée à votre superviseur ✓'
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
      await decideLeave(id, user, action)
      await loadAll()
      showNotification(action === 'approve' ? 'Demande approuvée ✓' : 'Demande refusée')
    } catch (err) {
      showNotification(err.message || 'Échec du traitement', 'error')
    }
  }

  async function handleDeleteLeave(id) {
    try {
      await deleteLeave(id)
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

  useEffect(() => () => { if (notifTimer.current) clearTimeout(notifTimer.current) }, [])

  if (authLoading) return <div className="loading-state" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Chargement…</div>

  if (!firebaseUser || !profile) return (
    <AuthScreen firebaseUser={firebaseUser || null} onProfileSaved={handleProfileSaved} />
  )

  // Liaison en attente de validation par un admin (email ≠ email RH).
  if (!profileApproved) return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">⏳</div>
        <h1>Compte en attente</h1>
        <p>
          Votre compte est associé à <strong>{profile.name}</strong>, mais votre email de
          connexion ne correspond pas à l'email RH — un admin doit valider la liaison.
        </p>
        <button className="btn-logout" style={{ marginTop: 16 }} onClick={handleLogout}>Se déconnecter</button>
      </div>
    </div>
  )

  const TABS = [
    { key: 'calendar', label: '📅 Calendrier' },
    { key: 'presence', label: '👥 Présence' },
    ...(canApprove ? [{ key: 'approvals', label: `✅ Approbations${pendingCount ? ` (${pendingCount})` : ''}` }] : []),
    { key: 'team', label: '🏢 Équipes' },
    ...(amGlobalAdmin ? [{ key: 'admin', label: '⚙️ Admin' }] : []),
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
          <span className="user-badge">{user}{amGlobalAdmin ? ' 👑' : canApprove ? ' ⭐' : ''}</span>
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
              leaves={amGlobalAdmin ? leaves : visibleLeaves}
              employees={amGlobalAdmin ? employees : visibleEmployees}
              currentUser={user}
              isAdmin={canApprove || amGlobalAdmin}
              onDelete={handleDeleteLeave}
            />
          )}
          {view === 'presence' && (
            <Presence
              employees={employees}
              leaves={leaves}
              currentUser={user}
              visibleTeams={[...new Set((amGlobalAdmin ? employees : visibleEmployees.concat(me ? [me] : [])).map(e => e.team))]}
              showFilter={amGlobalAdmin}
            />
          )}
          {view === 'approvals' && canApprove && (
            <Approvals
              employees={employees}
              pending={decidable}
              history={subtreeLeaves.filter(l => l.status !== 'pending')}
              onDecide={handleDecide}
            />
          )}
          {view === 'team' && (
            <TeamSettings
              employees={employees}
              config={config}
              currentUser={user}
              isGlobalAdmin={amGlobalAdmin}
              onImported={loadAll}
            />
          )}
          {view === 'admin' && amGlobalAdmin && (
            <AdminPanel employees={employees} onChanged={loadAll} />
          )}
          {view === 'request' && (
            <LeaveForm
              currentUser={user}
              isSuperAdmin={canApprove || amGlobalAdmin}
              visibleEmployees={visibleEmployeeNames}
              myLeaves={myLeaves}
              allLeaves={leaves}
              roster={employees}
              config={config}
              onSubmit={handleSubmitLeave}
              onCancel={() => setView('calendar')}
            />
          )}
        </>
      )}
    </div>
  )
}
