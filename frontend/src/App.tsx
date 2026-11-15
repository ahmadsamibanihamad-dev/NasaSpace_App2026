import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './auth/AuthContext'
import { AppShell } from './layout/AppShell'
import { FarmProvider, useFarmCtx } from './layout/FarmContext'
import Landing from './pages/Landing'
import { ForgotPassword, Register, SignIn } from './pages/auth/AuthPages'
import { Skeleton } from './components/ui/primitives'
import { ErrorState, StateBlock } from './components/ui/states'

const SetupWizard = lazy(() => import('./pages/setup/SetupWizard'))
const Guest = lazy(() => import('./pages/Guest'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const MyFarm = lazy(() => import('./pages/MyFarm'))
const NewAnalysis = lazy(() => import('./pages/analysis/NewAnalysis'))
const AnalysisView = lazy(() => import('./pages/analysis/AnalysisView'))
const Rotation = lazy(() => import('./pages/Rotation'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Risks = lazy(() => import('./pages/Risks'))
const Outlook = lazy(() => import('./pages/Outlook'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

function PageFallback() {
  return (
    <div className="flex flex-col gap-4 pt-4" aria-busy="true">
      <Skeleton className="h-12 w-80" />
      <div className="grid grid-cols-3 gap-6">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="p-8"><PageFallback /></div>
  if (!user) return <Navigate to="/signin" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

/** Redirects first-time users (no farm) into the setup wizard. */
function RequireFarm({ children }: { children: ReactNode }) {
  const { farms, isLoading, error, refetch } = useFarmCtx()
  if (isLoading) return <div className="p-8"><PageFallback /></div>
  if (error) return <ErrorState error={error} onRetry={refetch} />
  if (farms.length === 0) return <Navigate to="/setup" replace />
  return <>{children}</>
}

function NotFound() {
  const { t } = useTranslation()
  return <StateBlock icon="search" title={t('states.notFound')} action={<Link className="text-green-600 hover:underline" to="/">{t('states.goHome')}</Link>} />
}

export default function App() {
  const { user } = useAuth()
  return (
    <Suspense fallback={<div className="p-8"><PageFallback /></div>}>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/app" replace /> : <Landing />} />
        <Route path="/guest" element={<Guest />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route
          path="/setup"
          element={
            <RequireAuth>
              <FarmProvider>
                <SetupWizard />
              </FarmProvider>
            </RequireAuth>
          }
        />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <FarmProvider>
                <RequireFarm>
                  <AppShell />
                </RequireFarm>
              </FarmProvider>
            </RequireAuth>
          }
        >
          <Route index element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
          <Route path="farm" element={<Suspense fallback={<PageFallback />}><MyFarm /></Suspense>} />
          <Route path="analysis/new" element={<Suspense fallback={<PageFallback />}><NewAnalysis /></Suspense>} />
          <Route path="analysis/:id" element={<Suspense fallback={<PageFallback />}><AnalysisView /></Suspense>} />
          <Route path="rotation" element={<Suspense fallback={<PageFallback />}><Rotation /></Suspense>} />
          <Route path="analytics" element={<Suspense fallback={<PageFallback />}><Analytics /></Suspense>} />
          <Route path="outlook" element={<Suspense fallback={<PageFallback />}><Outlook /></Suspense>} />
          <Route path="risks" element={<Suspense fallback={<PageFallback />}><Risks /></Suspense>} />
          <Route path="reports" element={<Suspense fallback={<PageFallback />}><Reports /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageFallback />}><Settings /></Suspense>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
