// Guest flow: pick a location, get what to grow. No account, nothing saved.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { StepLocate, type LocatedPoint } from './setup/StepLocate'
import { StatusPill } from './analysis/results'
import { Button, Card, Chip, Skeleton, Tabs } from '../components/ui/primitives'
import { OutlookView } from '../features/outlook/OutlookView'
import { ErrorState, StateBlock } from '../components/ui/states'
import { Drops } from '../components/ui/viz'
import { Icon } from '../components/ui/Icon'
import { CropIcon } from '../components/crops/CropIcon'
import { guestRecommend } from '../lib/data/repo'
import { cropName, dayMonth, num } from '../lib/format'
import { loc } from '../i18n'

const WATER = ['none', 'drip', 'sprinkler', 'surface'] as const

export default function Guest() {
  const { t, i18n } = useTranslation()
  const [point, setPoint] = useState<LocatedPoint | null>(null)
  const [water, setWater] = useState<(typeof WATER)[number]>('none')
  const [view, setView] = useState<'climate' | 'outlook'>('climate')

  const q = useQuery({
    queryKey: ['guest', point?.lat.toFixed(4), point?.lon.toFixed(4), water],
    queryFn: () => guestRecommend({ lat: point!.lat, lon: point!.lon, irrigation_available: water !== 'none', irrigation_method: water === 'none' ? null : water }),
    enabled: !!point,
    staleTime: 10 * 60 * 1000,
    retry: 0,
  })
  const gov = point?.governorate ? (i18n.language === 'ar' ? point.governorate.name_ar : point.governorate.name_en) : '—'
  const top = q.data?.recommended_crops ?? []
  const rest = (q.data?.all_crops ?? []).filter((c) => !top.some((x) => x.crop === c.crop))

  return (
    <div className="h-full flex flex-col bg-bg p-4 sm:p-8 gap-4 sm:gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link to="/" className="flex items-center gap-2 text-h2 font-semibold text-green-700 me-auto">
          <img src="/favicon.svg" alt="" className="size-8" /> {t('app.name')}
        </Link>
        <button onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')} className="h-10 px-4 rounded-pill border border-border bg-surface text-label flex items-center gap-2 hover:bg-surface-muted">
          <Icon name="globe" size={18} /> <span className="hidden sm:inline">{t('common.language')}</span>
        </button>
        <Link to="/signin" className="h-10 px-4 rounded-pill text-label flex items-center hover:bg-surface">
          {t('landing.signIn')}
        </Link>
      </header>

      {!point ? (
        <>
          <div>
            <h1 className="text-display font-light">{t('guest.title')}</h1>
            <p className="text-body text-text-secondary mt-1">{t('guest.body')}</p>
          </div>
          <div className="flex-1 min-h-0">
            <StepLocate initial={null} onConfirm={setPoint} />
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 max-w-[1376px] mx-auto">
            <aside className="contents xl:flex xl:col-span-4 xl:flex-col xl:gap-6">
              <Card className="flex flex-col gap-4 order-1 xl:order-none">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface-muted rounded-tile p-4">
                    <p className="text-caption text-text-secondary">{t('setup.locate.governorate')}</p>
                    <p className="text-body font-semibold mt-1">{gov}</p>
                  </div>
                  <div className="bg-surface-muted rounded-tile p-4">
                    <p className="text-caption text-text-secondary">{t('setup.locate.coordinates')}</p>
                    <p className="text-label font-semibold mt-1 tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                      {num(point.lat, 5)}, {num(point.lon, 5)}
                    </p>
                  </div>
                </div>
                <Button variant="secondary" icon="pin" onClick={() => setPoint(null)}>
                  {t('guest.changeLocation')}
                </Button>
                <div>
                  <p className="text-label text-text-secondary mb-2">{t('guest.water')}</p>
                  <div role="radiogroup" aria-label={t('guest.water')} className="flex flex-wrap gap-2">
                    {WATER.map((w) => (
                      <Chip key={w} selected={water === w} onClick={() => setWater(w)} role="radio" aria-checked={water === w}>
                        {w === 'none' ? t('guest.rainfed') : t(`irrigation.${w}`)}
                      </Chip>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="flex flex-col gap-4 border border-green-200 order-3 xl:order-none">
                <span className="size-12 rounded-pill bg-green-50 text-green-700 flex items-center justify-center">
                  <Icon name="farm" size={24} />
                </span>
                <p className="text-body">{t('guest.saveCta')}</p>
                <Link to="/register" className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-pill bg-green-600 text-white text-label hover:bg-green-700">
                  {t('guest.register')}
                  <Icon name="arrowRight" size={18} className="rtl:-scale-x-100" />
                </Link>
                <p className="text-caption text-text-tertiary flex items-center gap-1">
                  <Icon name="info" size={14} /> {t('guest.notSaved')}
                </p>
              </Card>
            </aside>

            <main className="xl:col-span-8 flex flex-col gap-6 order-2 xl:order-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-h1 font-semibold">{t('guest.resultsTitle')}</h1>
                <Tabs
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'climate', label: t('outlook.tabClimate') },
                    { value: 'outlook', label: t('outlook.tab') },
                  ]}
                />
              </div>
              {view === 'outlook' ? (
                <OutlookView lat={point.lat} lon={point.lon} irrigation={water !== 'none'} />
              ) : (
                <>
              {q.isLoading ? (
                <div aria-busy="true" role="status">
                  <p className="text-body font-semibold flex items-center gap-3">
                    <span className="pulse-marker shrink-0" aria-hidden /> {t('guest.loading')}
                  </p>
                  <p className="text-label text-text-secondary mt-1 mb-4">{t('guest.loadingBody')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-44 !rounded-card" />
                    ))}
                  </div>
                </div>
              ) : q.error ? (
                <Card>
                  <ErrorState error={q.error} onRetry={() => q.refetch()} />
                </Card>
              ) : top.length === 0 || top[0].suitability_score < 40 ? (
                <Card>
                  <StateBlock icon="sprout" title={t('guest.noCrops')} />
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {top.map((c, i) => (
                      <Card as="article" key={c.crop} className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <CropIcon crop={c.crop} size={48} />
                          <div className="flex-1 min-w-0">
                            <p className="text-h2 font-semibold truncate">{cropName(c.crop)}</p>
                            <StatusPill score={c.suitability_score} status={c.suitability_status} />
                          </div>
                          <div className="text-end">
                            <p className="text-metric font-light tabular-nums leading-none">{c.suitability_score}</p>
                            <p className="text-caption text-text-secondary">#{i + 1}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-label">
                          <span className="flex items-center gap-2 text-text-secondary">
                            <Icon name="calendar" size={16} />
                            {c.planting_window ? `${dayMonth(c.planting_window.start)} – ${dayMonth(c.planting_window.end)}` : t('results.yearRound')}
                          </span>
                          <Drops level={c.water_demand} />
                        </div>
                        <p className="text-label text-text-secondary">{loc(c.main_reason)}</p>
                      </Card>
                    ))}
                  </div>
                  {rest.length > 0 && (
                    <Card>
                      <h2 className="text-h2 font-semibold mb-3">{t('guest.others')}</h2>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {rest.map((c) => (
                          <li key={c.crop} className="flex items-center gap-3 rounded-tile bg-surface-muted p-3">
                            <CropIcon crop={c.crop} size={32} />
                            <span className="flex-1 text-label">{cropName(c.crop)}</span>
                            <span className="text-caption text-text-secondary">{t(`results.status.${c.suitability_status}`)}</span>
                            <b className="text-label font-semibold tabular-nums w-7 text-end">{c.suitability_score}</b>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </>
              )}
              {q.data && (
                <div className="flex flex-col gap-1 px-2 text-caption text-text-secondary">
                  <p className="flex items-start gap-1">
                    <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('results.climatology')}
                  </p>
                  <p className="flex items-start gap-1">
                    <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('results.disclaimer')}
                  </p>
                </div>
              )}
                </>
              )}
            </main>
          </div>
        </div>
      )}
    </div>
  )
}
