import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from '../components/ui/Icon'
import { IconButton, cx } from '../components/ui/primitives'
import { OfflineBanner } from '../components/ui/states'
import { useAuth } from '../auth/AuthContext'
import { useFarmCtx } from './FarmContext'
import { usePlots } from '../hooks/queries'
import { cropName } from '../lib/format'

const NAV: { to: string; key: string; icon: IconName; primary?: boolean }[] = [
  { to: '/app', key: 'dashboard', icon: 'home' },
  { to: '/app/farm', key: 'myFarm', icon: 'farm' },
  { to: '/app/analysis/new', key: 'newAnalysis', icon: 'plus', primary: true },
  { to: '/app/rotation', key: 'rotation', icon: 'rotate' },
  { to: '/app/outlook', key: 'outlook', icon: 'cloudRain' },
  { to: '/app/analytics', key: 'analytics', icon: 'chart' },
  { to: '/app/risks', key: 'risks', icon: 'alert' },
  { to: '/app/plans', key: 'plans', icon: 'list' },
  { to: '/app/reports', key: 'reports', icon: 'file' },
  { to: '/app/settings', key: 'settings', icon: 'settings' },
]

const TITLES: [RegExp, string][] = [
  [/^\/app\/farm/, 'nav.myFarm'],
  [/^\/app\/analysis\/new/, 'nav.newAnalysis'],
  [/^\/app\/analysis\//, 'analysis.resultTitle'],
  [/^\/app\/rotation/, 'nav.rotation'],
  [/^\/app\/outlook/, 'nav.outlook'],
  [/^\/app\/analytics/, 'nav.analytics'],
  [/^\/app\/risks/, 'nav.risks'],
  [/^\/app\/plans/, 'nav.plans'],
  [/^\/app\/reports/, 'nav.reports'],
  [/^\/app\/settings/, 'nav.settings'],
  [/^\/app\/?$/, 'nav.dashboard'],
]

function Sidebar({ collapsed, onToggle, mobileOpen, onNavigate }: { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onNavigate: () => void }) {
  const { t } = useTranslation()
  return (
    <aside
      className={cx('shrink-0 h-full flex-col gap-2 py-6 bg-bg transition-[width] duration-200 overflow-y-auto', collapsed ? 'lg:w-[72px] lg:px-3' : 'lg:w-[240px] lg:px-4', mobileOpen ? 'flex fixed inset-y-0 start-0 z-[2000] w-[260px] px-4 shadow-soft' : 'hidden lg:flex')}
      aria-label="Main navigation"
    >
      <div className={cx('flex items-center gap-2 mb-6', collapsed ? 'justify-center' : 'justify-between px-2')}>
        {!collapsed && (
          <span className="flex items-center gap-2 text-h2 font-semibold text-green-700">
            <img src="/favicon.svg" alt="" className="size-8" />
            {t('app.name')}
          </span>
        )}
        <IconButton icon="menu" label={collapsed ? t('nav.expand') : t('nav.collapse')} onClick={onToggle} size={36} aria-expanded={!collapsed} />
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/app'}
            onClick={onNavigate}
            title={collapsed ? t(`nav.${n.key}`) : undefined}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 h-11 rounded-pill text-label transition-colors',
                collapsed ? 'justify-center px-0' : 'px-4',
                n.primary
                  ? 'bg-green-600 text-white hover:bg-green-700 my-2'
                  : isActive
                    ? 'bg-surface text-green-700 font-semibold shadow-soft'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary',
              )
            }
          >
            <Icon name={n.icon} size={20} />
            {!collapsed && <span>{t(`nav.${n.key}`)}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

function Menu({ trigger, children, label }: { trigger: (open: boolean, toggle: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [])
  return (
    <div className="relative" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div role="menu" aria-label={label} className="absolute top-12 end-0 z-[1100] min-w-56 bg-surface border border-border rounded-tile shadow-soft p-2">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { t, i18n } = useTranslation()
  const loc = useLocation()
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const { farms, farm, setFarmId } = useFarmCtx()
  const plots = usePlots(farm?.id)
  const [q, setQ] = useState('')
  const title = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? 'nav.dashboard'
  const matches =
    q.trim().length > 0
      ? (plots.data ?? []).filter((p) => `${p.label} ${p.name} ${cropName(p.current_crop_id)}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
      : []

  return (
    <header className="flex items-center gap-2 sm:gap-4 h-16 lg:h-[88px] shrink-0">
      <IconButton icon="menu" label={t('nav.expand')} onClick={onMenu} className="lg:hidden" />
      <h1 className="text-h2 lg:text-h1 font-semibold me-auto truncate min-w-0 hidden sm:block">{t(title)}</h1>
      <span className="me-auto sm:hidden" />

      {farms.length > 0 && (
        <Menu
          label={t('nav.farmSwitcher')}
          trigger={(open, toggle) => (
            <button onClick={toggle} aria-expanded={open} aria-haspopup="menu" className="h-10 px-4 rounded-pill bg-surface border border-border flex items-center gap-2 text-label hover:bg-surface-muted">
              <Icon name="farm" size={18} className="text-green-600" />
              <span className="max-w-24 sm:max-w-40 truncate">{farm?.name}</span>
              <Icon name="chevronDown" size={16} />
            </button>
          )}
        >
          {(close) => (
            <>
              {farms.map((f) => (
                <button
                  key={f.id}
                  role="menuitemradio"
                  aria-checked={f.id === farm?.id}
                  onClick={() => {
                    setFarmId(f.id)
                    close()
                  }}
                  className={cx('w-full text-start px-3 py-2 rounded-input text-label hover:bg-surface-muted flex items-center justify-between', f.id === farm?.id && 'text-green-700 font-semibold')}
                >
                  {f.name}
                  {f.id === farm?.id && <Icon name="check" size={16} />}
                </button>
              ))}
              <button role="menuitem" onClick={() => { close(); nav('/setup?new=1') }} className="w-full text-start px-3 py-2 rounded-input text-label text-green-700 hover:bg-surface-muted flex items-center gap-2">
                <Icon name="plus" size={16} /> {t('farm.addFarm')}
              </button>
            </>
          )}
        </Menu>
      )}

      <div className="relative w-64 hidden xl:block">
        <Icon name="search" size={18} className="absolute top-1/2 -translate-y-1/2 start-4 text-text-tertiary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('nav.searchPlaceholder')}
          aria-label={t('common.search')}
          className="h-10 w-full rounded-pill bg-surface border border-border ps-11 pe-4 text-label placeholder:text-text-tertiary focus:outline-none focus:border-green-600"
        />
        {matches.length > 0 && (
          <div className="absolute top-12 inset-x-0 z-[1100] bg-surface border border-border rounded-tile shadow-soft p-2">
            {matches.map((p) => (
              <button key={p.id} onClick={() => { setQ(''); nav(`/app/farm?plot=${p.id}`) }} className="w-full text-start px-3 py-2 rounded-input text-label hover:bg-surface-muted flex justify-between">
                <span>{p.label} · {p.name}</span>
                <span className="text-text-secondary">{cropName(p.current_crop_id)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
        className="h-10 px-4 rounded-pill border border-border bg-surface text-label flex items-center gap-2 hover:bg-surface-muted"
        aria-label="Language"
      >
        <Icon name="globe" size={18} />
        <span className="hidden sm:inline">{t('common.language')}</span>
      </button>

      <span className="hidden sm:block">
      <Menu label={t('nav.notifications')} trigger={(open, toggle) => <IconButton icon="bell" label={t('nav.notifications')} onClick={toggle} aria-expanded={open} />}>
        {() => <p className="px-3 py-4 text-label text-text-secondary">{t('nav.noNotifications')}</p>}
      </Menu>
      </span>

      <Menu
        label={t('nav.account')}
        trigger={(open, toggle) => (
          <button onClick={toggle} aria-expanded={open} aria-label={t('nav.account')} className="size-10 rounded-pill bg-green-100 text-green-800 text-label font-semibold flex items-center justify-center hover:bg-green-200">
            {(user?.full_name || user?.email || '?').trim().charAt(0).toUpperCase()}
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-label font-semibold">{user?.full_name}</p>
              <p className="text-caption text-text-secondary">{user?.email}</p>
            </div>
            <button role="menuitem" onClick={() => { close(); nav('/app/settings') }} className="w-full text-start px-3 py-2 rounded-input text-label hover:bg-surface-muted flex items-center gap-2">
              <Icon name="settings" size={16} /> {t('nav.settings')}
            </button>
            <button role="menuitem" onClick={() => { close(); logout(); nav('/') }} className="w-full text-start px-3 py-2 rounded-input text-label hover:bg-surface-muted flex items-center gap-2">
              <Icon name="arrowLeft" size={16} className="ltr:-scale-x-100" /> {t('common.signOut')}
            </button>
          </>
        )}
      </Menu>
    </header>
  )
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ardna.sidebar') === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('ardna.sidebar', c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })
  }
  return (
    <div className="h-full flex bg-bg">
      {mobileOpen && <div className="fixed inset-0 z-[1900] bg-[rgba(20,22,20,0.45)] lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
      <Sidebar collapsed={collapsed && !mobileOpen} onToggle={mobileOpen ? () => setMobileOpen(false) : toggle} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col h-full px-3 sm:px-8">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto pb-4 sm:pb-8 -mx-2 px-2" id="main">
          <OfflineBanner />
          <Outlet />
        </main>
      </div>
    </div>
  )
}
