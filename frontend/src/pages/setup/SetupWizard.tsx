import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { StepLocate, type LocatedPoint } from './StepLocate'
import { Button, Card, Field, Input, cx } from '../../components/ui/primitives'
import { Banner } from '../../components/ui/states'
import { Icon } from '../../components/ui/Icon'
import { useCreateFarm } from '../../hooks/queries'
import { useFarmCtx } from '../../layout/FarmContext'
import { createDemoFarm } from '../../lib/data/demo'
import { ApiError } from '../../lib/api'
import { num } from '../../lib/format'

export default function SetupWizard() {
  const { t, i18n } = useTranslation()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const { farms, setFarmId } = useFarmCtx()
  const createFarm = useCreateFarm()
  const [step, setStep] = useState<1 | 2>(1)
  const [point, setPoint] = useState<LocatedPoint | null>(null)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [phone, setPhone] = useState('')
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [demoBusy, setDemoBusy] = useState(false)
  const adding = params.get('new') === '1' || farms.length > 0

  const submit = async () => {
    setErr(null)
    if (!name.trim()) return setNameErr(t('auth.required'))
    setNameErr(null)
    if (!point) return setStep(1)
    try {
      const f = await createFarm.mutateAsync({ name, lat: point.lat, lon: point.lon, owner_name: owner, owner_phone: phone })
      setFarmId(f.id)
      nav('/app/farm?add=1', { replace: true })
    } catch (e) {
      const a = e as ApiError
      setErr(a.code === 'UNSUPPORTED_LOCATION' ? t('states.unsupportedLocationBody') : a.code?.startsWith('STORAGE') ? t('parcels.saveFailedStorage') : t('states.errorBody'))
    }
  }

  const demo = async () => {
    setDemoBusy(true)
    setErr(null)
    try {
      const id = await createDemoFarm()
      await qc.invalidateQueries({ queryKey: ['farms'] })
      setFarmId(id)
      nav('/app', { replace: true })
    } catch {
      setErr(t('states.errorBody'))
    } finally {
      setDemoBusy(false)
    }
  }

  const steps = [t('setup.steps.locate'), t('setup.steps.farm')]
  const gov = point?.governorate ? (i18n.language === 'ar' ? point.governorate.name_ar : point.governorate.name_en) : '—'

  return (
    <div className="h-full flex flex-col bg-bg p-4 sm:p-8 gap-4 sm:gap-6">
      <header className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2 text-h2 font-semibold text-green-700">
          <img src="/favicon.svg" alt="" className="size-8" /> {t('app.name')}
        </span>
        <ol className="flex items-center gap-2 mx-auto" aria-label={t('setup.title')}>
          {steps.map((s, i) => {
            const n = (i + 1) as 1 | 2
            return (
              <li key={s} className="flex items-center gap-2">
                <span
                  aria-current={step === n ? 'step' : undefined}
                  className={cx('h-9 px-4 rounded-pill text-label flex items-center gap-2', step === n ? 'bg-green-600 text-white' : step > n ? 'bg-green-50 text-green-700' : 'bg-surface text-text-secondary')}
                >
                  {step > n ? <Icon name="check" size={16} /> : <b className="font-semibold">{n}</b>}
                  <span className="hidden sm:inline">{s}</span>
                </span>
                {i < steps.length - 1 && <span className="w-6 h-px bg-border" aria-hidden />}
              </li>
            )
          })}
        </ol>
        <button onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')} className="h-10 px-4 rounded-pill border border-border bg-surface text-label flex items-center gap-2 hover:bg-surface-muted">
          <Icon name="globe" size={18} /> {t('common.language')}
        </button>
        {adding && (
          <Link to="/app" className="h-10 px-4 rounded-pill text-label flex items-center hover:bg-surface">
            {t('common.cancel')}
          </Link>
        )}
      </header>

      <div className="flex-1 min-h-0">
        {step === 1 ? (
          <StepLocate
            initial={point}
            onConfirm={(p) => {
              setPoint(p)
              setStep(2)
            }}
          />
        ) : (
          <div className="max-w-xl mx-auto w-full h-full overflow-y-auto flex flex-col gap-4">
            <Card className="flex flex-col gap-5">
              <div>
                <h2 className="text-h1 font-semibold">{t('setup.farm.title')}</h2>
                <p className="text-body text-text-secondary mt-2">{t('setup.farm.body')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-muted rounded-tile p-4">
                  <p className="text-caption text-text-secondary">{t('setup.locate.governorate')}</p>
                  <p className="text-body font-semibold mt-1">{gov}</p>
                </div>
                <div className="bg-surface-muted rounded-tile p-4">
                  <p className="text-caption text-text-secondary">{t('setup.locate.coordinates')}</p>
                  <p className="text-label font-semibold mt-1 tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                    {point ? `${num(point.lat, 4)}, ${num(point.lon, 4)}` : '—'}
                  </p>
                </div>
              </div>
              <Field label={t('setup.farm.name') + ' *'} htmlFor="farm-name" error={nameErr}>
                <Input id="farm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('setup.farm.namePh')} aria-invalid={!!nameErr} maxLength={120} autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`${t('setup.farm.owner')} (${t('common.optional')})`} htmlFor="farm-owner">
                  <Input id="farm-owner" value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={80} />
                </Field>
                <Field label={`${t('setup.farm.phone')} (${t('common.optional')})`} htmlFor="farm-phone">
                  <Input id="farm-phone" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, ''))} maxLength={20} />
                </Field>
              </div>
              {err && <Banner icon="alert" tone="critical">{err}</Banner>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  {t('common.back')}
                </Button>
                <Button className="flex-1" onClick={submit} loading={createFarm.isPending} iconEnd="arrowRight">
                  {t('setup.farm.create')}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {step === 1 && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-label text-text-secondary">
          <span>{t('setup.farm.demoBody')}</span>
          <Button variant="secondary" size="sm" icon="sprout" onClick={demo} loading={demoBusy}>
            {t('setup.farm.demo')}
          </Button>
          {err && <span className="text-critical">{err}</span>}
        </div>
      )}
    </div>
  )
}
