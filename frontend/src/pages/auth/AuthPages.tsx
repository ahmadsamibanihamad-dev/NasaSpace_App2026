import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthContext'
import { Button, Field, Input } from '../../components/ui/primitives'
import { Banner } from '../../components/ui/states'
import { Icon } from '../../components/ui/Icon'
import { ApiError } from '../../lib/api'
import { forgotPassword } from '../../lib/data/repo'

function AuthLayout({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="min-h-full grid grid-cols-12 gap-6 p-8 bg-bg">
      <div className="col-span-5 flex flex-col">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-h2 font-semibold text-green-700">
            <img src="/favicon.svg" alt="" className="size-8" /> {t('app.name')}
          </Link>
          <button onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')} className="h-10 px-4 rounded-pill border border-border bg-surface text-label flex items-center gap-2 hover:bg-surface-muted">
            <Icon name="globe" size={18} /> {t('common.language')}
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-[440px] bg-surface rounded-card p-10 shadow-soft">
            <h1 className="text-display font-light">{title}</h1>
            <p className="text-body text-text-secondary mt-2 mb-8">{body}</p>
            {children}
          </div>
        </div>
      </div>
      <div className="col-span-7 relative rounded-card overflow-hidden min-h-[600px]">
        <img src="/images/hero-farm.webp" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute bottom-8 start-8 end-8 bg-surface/90 rounded-tile px-6 py-4 text-h2 font-light">{t('auth.panelQuote')}</div>
      </div>
    </div>
  )
}

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

export function SignIn() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const fe: typeof fieldErr = {}
    if (!email) fe.email = t('auth.required')
    else if (!emailOk(email)) fe.email = t('auth.invalidEmail')
    if (!password) fe.password = t('auth.required')
    setFieldErr(fe)
    if (Object.keys(fe).length) return
    setBusy(true)
    setErr(null)
    try {
      await login(email, password)
      const from = (loc.state as { from?: string } | null)?.from
      nav(from || '/app', { replace: true })
    } catch (ex) {
      const a = ex as ApiError
      setErr(a.code === 'INVALID_CREDENTIALS' || a.status === 401 ? t('auth.invalidCredentials') : a.isOffline ? t('states.offline') : t('states.errorBody'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.signInTitle')} body={t('auth.signInBody')}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {err && <Banner icon="alert" tone="critical">{err}</Banner>}
        <Field label={t('auth.email')} htmlFor="email" error={fieldErr.email}>
          <Input id="email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fieldErr.email} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={fieldErr.password}>
          <Input id="password" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fieldErr.password} />
        </Field>
        <Link to="/forgot-password" className="text-label text-green-600 hover:underline self-start">
          {t('auth.forgot')}
        </Link>
        <Button type="submit" size="lg" loading={busy}>
          {t('auth.signIn')}
        </Button>
        <p className="text-label text-text-secondary text-center">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="text-green-600 hover:underline">
            {t('auth.register')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}

export function Register() {
  const { t } = useTranslation()
  const { register } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' })
  const [fe, setFe] = useState<Partial<Record<keyof typeof f, string>>>({})
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const x: typeof fe = {}
    if (!f.name.trim()) x.name = t('auth.required')
    if (!emailOk(f.email)) x.email = t('auth.invalidEmail')
    if (f.password.length < 8) x.password = t('auth.passwordShort')
    if (f.confirm !== f.password) x.confirm = t('auth.passwordMismatch')
    setFe(x)
    if (Object.keys(x).length) return
    setBusy(true)
    setErr(null)
    try {
      await register(f.name.trim(), f.email, f.password)
      nav('/setup', { replace: true })
    } catch (ex) {
      const a = ex as ApiError
      setErr(a.code === 'EMAIL_TAKEN' ? t('auth.emailTaken') : a.isOffline ? t('states.offline') : a.message || t('states.errorBody'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.registerTitle')} body={t('auth.registerBody')}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {err && <Banner icon="alert" tone="critical">{err}</Banner>}
        <Field label={t('auth.fullName')} htmlFor="name" error={fe.name}>
          <Input id="name" autoComplete="name" value={f.name} onChange={set('name')} aria-invalid={!!fe.name} />
        </Field>
        <Field label={t('auth.email')} htmlFor="email" error={fe.email}>
          <Input id="email" type="email" dir="ltr" autoComplete="email" value={f.email} onChange={set('email')} aria-invalid={!!fe.email} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={fe.password}>
          <Input id="password" type="password" dir="ltr" autoComplete="new-password" value={f.password} onChange={set('password')} aria-invalid={!!fe.password} />
        </Field>
        <Field label={t('auth.confirmPassword')} htmlFor="confirm" error={fe.confirm}>
          <Input id="confirm" type="password" dir="ltr" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} aria-invalid={!!fe.confirm} />
        </Field>
        <Button type="submit" size="lg" loading={busy}>
          {t('auth.register')}
        </Button>
        <p className="text-label text-text-secondary text-center">
          {t('auth.haveAccount')}{' '}
          <Link to="/signin" className="text-green-600 hover:underline">
            {t('auth.signIn')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}

export function ForgotPassword() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!emailOk(email)) return setErr(t('auth.invalidEmail'))
    setBusy(true)
    setErr(null)
    try {
      await forgotPassword(email)
      setSent(true)
    } catch {
      setErr(t('states.errorBody'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthLayout title={t('auth.forgotTitle')} body={t('auth.forgotBody')}>
      {sent ? (
        <div className="flex flex-col gap-6">
          <Banner icon="check">{t('auth.forgotSent')}</Banner>
          <Link to="/signin" className="text-label text-green-600 hover:underline">{t('auth.backToSignIn')}</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <Field label={t('auth.email')} htmlFor="email" error={err}>
            <Input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err} />
          </Field>
          <Button type="submit" size="lg" loading={busy}>{t('auth.send')}</Button>
          <Link to="/signin" className="text-label text-green-600 hover:underline text-center">{t('auth.backToSignIn')}</Link>
        </form>
      )}
    </AuthLayout>
  )
}
