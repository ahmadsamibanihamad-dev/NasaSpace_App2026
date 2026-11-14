import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { useFarmCtx } from '../layout/FarmContext'
import { useAnalyses, useEnvSummary, usePlots } from '../hooks/queries'
import { Button, Card, CardTitle, Pill, Skeleton } from '../components/ui/primitives'
import { Banner, DataFooter, DemoBadge, EmptyState, ErrorState, LowQualityBanner } from '../components/ui/states'
import { TickStrip } from '../components/ui/viz'
import { Icon, type IconName } from '../components/ui/Icon'
import { CropIcon } from '../components/crops/CropIcon'
import { FarmMiniMap } from '../components/map/FarmMiniMap'
import { area as fmtArea, cropName, date, num, scoreTone } from '../lib/format'
import { loc } from '../i18n'
import type { MetricSummary, Plot } from '../lib/types'

const SEV_TONE = { high: 'critical', moderate: 'warning', low: 'neutral' } as const

export function ScoreBadge({ score, status }: { score: number | null; status?: string | null }) {
  const { t } = useTranslation()
  if (score === null || score === undefined) return <Pill tone="outline">{t('dashboard.noScore')}</Pill>
  const tone = scoreTone(score)
  return (
    <Pill tone={tone === 'green' ? 'green' : tone} icon={tone === 'green' ? 'check' : 'alert'}>
      <b className="font-semibold tabular-nums">{Math.round(score)}</b>
      {status && <span>· {t(`results.status.${status}`)}</span>}
    </Pill>
  )
}

export function RiskPill({ risk }: { risk: { type: string; severity: string } | null }) {
  const { t } = useTranslation()
  if (!risk) return <span className="text-text-tertiary">—</span>
  return (
    <Pill tone={SEV_TONE[risk.severity as keyof typeof SEV_TONE] ?? 'neutral'} icon="alert">
      {t(`risks.types.${risk.type}`)} · {t(`results.severity.${risk.severity}`)}
    </Pill>
  )
}

function MetricCard({ icon, label, m, digits = 1 }: { icon: IconName; label: string; m: MetricSummary; digits?: number }) {
  const { t } = useTranslation()
  const up = (m.anomaly ?? 0) >= 0
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-label text-text-secondary flex items-center gap-2">
          <span className="size-9 rounded-pill border border-border flex items-center justify-center text-green-600">
            <Icon name={icon} size={18} />
          </span>
          {label}
        </span>
        <span className="text-caption text-text-tertiary" dir="ltr">
          {m.source}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="flex items-baseline gap-1">
          <span className="text-metric font-light tabular-nums">{num(m.value, digits)}</span>
          <span className="text-label text-text-secondary">{m.unit}</span>
        </span>
        <TickStrip values={m.trend.map((x) => x.value)} ariaLabel={`${label} · ${t('dashboard.last12')}`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
        <span>{loc(m.period)}</span>
        {m.anomaly !== null && m.anomaly !== undefined && (
          <Pill tone="neutral" icon={up ? 'arrowRight' : 'arrowLeft'} className="[&_svg]:rotate-[-90deg] rtl:[&_svg]:rotate-90">
            <span dir="ltr">
              {up ? '+' : ''}
              {num(m.anomaly, digits)} {m.unit}
            </span>{' '}
            {t('dashboard.vsAverage')}
          </Pill>
        )}
      </div>
    </Card>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { user } = useAuth()
  const { farm } = useFarmCtx()
  const plotsQ = usePlots(farm?.id)
  const env = useEnvSummary(farm)
  const analyses = useAnalyses(farm?.id)
  if (!farm) return null
  const plots = plotsQ.data ?? []
  const total = plots.reduce((s, p) => s + p.area_m2, 0)
  const hour = new Date().getHours()
  const risky = plots.filter((p) => p.latest_top_risk && p.latest_top_risk.severity !== 'low')
  const quick: { icon: IconName; label: string; to: string }[] = [
    { icon: 'target', label: t('dashboard.qaSuitability'), to: '/app/analysis/new?type=crop_suitability' },
    { icon: 'sprout', label: t('dashboard.qaRecommend'), to: '/app/analysis/new?type=crop_recommendation' },
    { icon: 'rotate', label: t('dashboard.qaRotation'), to: '/app/rotation' },
    { icon: 'alert', label: t('dashboard.qaRisks'), to: '/app/risks' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display font-light">{t(hour < 12 ? 'dashboard.greetingMorning' : 'dashboard.greetingEvening', { name: user?.full_name?.split(' ')[0] ?? '' })}</h2>
          <p className="text-body text-text-secondary mt-1">{t('dashboard.subtitle')}</p>
        </div>
        {farm.is_demo && <DemoBadge />}
      </div>

      {plotsQ.isSuccess && plots.length === 0 && (
        <Card>
          <EmptyState icon="polygon" title={t('parcels.emptyTitle')} body={t('parcels.emptyBody')} action={<Button icon="plus" onClick={() => nav('/app/farm?add=1')}>{t('parcels.addNew')}</Button>} />
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Farm card */}
        <Card className="xl:col-span-5 !p-0 overflow-hidden flex flex-col">
          <div className="relative h-36">
            <img src="/images/hero-farm.webp" alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute bottom-3 start-4 end-4 flex items-end justify-between">
              <span className="bg-surface/95 rounded-pill px-4 h-9 flex items-center gap-2 text-label font-semibold">
                <Icon name="farm" size={16} className="text-green-600" /> {farm.name}
              </span>
              {farm.governorate && <span className="bg-surface/95 rounded-pill px-3 h-7 flex items-center text-caption">{loc(farm.governorate ? { ar: farm.governorate.name_ar, en: farm.governorate.name_en } : null)}</span>}
            </div>
          </div>
          <div className="p-6 flex flex-col gap-4 flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-label text-text-secondary">{t('parcels.totalArea')}</p>
                <p className="text-metric font-light tabular-nums">{plotsQ.isLoading ? '—' : fmtArea(total).split(' ')[0]}<span className="text-label text-text-secondary ms-1">{fmtArea(total).split(' ').slice(1).join(' ')}</span></p>
              </div>
              <div>
                <p className="text-label text-text-secondary">{t('common.plots')}</p>
                <p className="text-metric font-light tabular-nums">{plotsQ.isLoading ? '—' : plots.length}</p>
              </div>
            </div>
            {plotsQ.isLoading ? <Skeleton className="h-56" /> : plots.length > 0 && <FarmMiniMap farm={farm} plots={plots} className="h-56" />}
            <div className="flex items-center justify-between">
              <span className="text-caption text-text-secondary flex items-center gap-2">
                {[['#2F8F4E', '80+'], ['#7FC190', '60+'], ['#D7ECDC', '40+'], ['#F6F6F4', '—']].map(([c, l]) => (
                  <span key={l} className="flex items-center gap-1">
                    <span className="size-3 rounded-pill border border-border" style={{ background: c }} /> {l}
                  </span>
                ))}
              </span>
              <Link to="/app/farm" className="text-label text-green-600 hover:underline">
                {t('nav.myFarm')}
              </Link>
            </div>
          </div>
        </Card>

        {/* Metrics */}
        <div className="xl:col-span-7 flex flex-col gap-6">
          {env.isLoading ? (
            <>
              <Skeleton className="h-40 !rounded-card" />
              <Skeleton className="h-40 !rounded-card" />
              <Skeleton className="h-40 !rounded-card" />
            </>
          ) : env.error ? (
            <Card>
              <ErrorState error={env.error} onRetry={() => env.refetch()} />
            </Card>
          ) : env.data ? (
            <>
              <MetricCard icon="drop" label={t('dashboard.soilMoisture')} m={env.data.metrics.soil_moisture} digits={0} />
              <MetricCard icon="thermo" label={t('dashboard.temperature')} m={env.data.metrics.temperature} />
              <MetricCard icon="cloudRain" label={t('dashboard.seasonalRainfall')} m={env.data.metrics.seasonal_rainfall} digits={0} />
            </>
          ) : null}
        </div>
      </div>

      {env.data && (
        <Card className="flex flex-col gap-3">
          <LowQualityBanner meta={env.data} />
          <DataFooter meta={env.data} compact />
          <p className="text-caption text-text-tertiary flex items-start gap-1">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('results.sharedCell')}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Plots table */}
        <Card className="xl:col-span-8">
          <CardTitle action={<Link to="/app/farm" className="text-label text-green-600 hover:underline">{t('common.seeAll')}</Link>}>{t('dashboard.plotsTable')}</CardTitle>
          {plotsQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : plotsQ.error ? (
            <ErrorState error={plotsQ.error} onRetry={() => plotsQ.refetch()} />
          ) : plots.length === 0 ? (
            <p className="text-label text-text-secondary py-6 text-center">{t('parcels.emptyBody')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-label">
                <thead>
                  <tr className="text-caption text-text-secondary">
                    <th className="text-start font-normal py-2">{t('common.plot')}</th>
                    <th className="text-start font-normal py-2">{t('dashboard.crop')}</th>
                    <th className="text-start font-normal py-2">{t('parcels.area')}</th>
                    <th className="text-start font-normal py-2">{t('dashboard.score')}</th>
                    <th className="text-start font-normal py-2">{t('dashboard.topRisk')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plots.map((p: Plot) => (
                    <tr key={p.id} className="border-t border-border hover:bg-surface-muted cursor-pointer" onClick={() => nav(`/app/farm?plot=${p.id}`)}>
                      <td className="py-3">
                        <span className="flex items-center gap-2">
                          <span className="size-3 rounded-pill" style={{ background: p.color }} aria-hidden />
                          <b className="font-semibold">{p.label}</b> <span className="text-text-secondary truncate max-w-40">{p.name}</span>
                        </span>
                      </td>
                      <td className="py-3">
                        <span className="flex items-center gap-2">
                          <CropIcon crop={p.current_crop_id} size={28} /> {cropName(p.current_crop_id)}
                        </span>
                      </td>
                      <td className="py-3 tabular-nums whitespace-nowrap">{fmtArea(p.area_m2)}</td>
                      <td className="py-3">
                        <ScoreBadge score={p.latest_score} status={p.latest_status} />
                      </td>
                      <td className="py-3">
                        <RiskPill risk={p.latest_top_risk} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="xl:col-span-4 flex flex-col gap-6">
          <Card>
            <CardTitle>{t('dashboard.quickActions')}</CardTitle>
            <div className="grid grid-cols-2 gap-3">
              {quick.map((q) => (
                <Link key={q.to} to={q.to} className="rounded-tile bg-surface-muted hover:bg-green-50 p-4 flex flex-col gap-3 transition-colors">
                  <span className="size-10 rounded-pill bg-surface border border-border flex items-center justify-center text-green-600">
                    <Icon name={q.icon} size={18} />
                  </span>
                  <span className="text-label">{q.label}</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle action={<Link to="/app/risks" className="text-label text-green-600 hover:underline">{t('common.seeAll')}</Link>}>{t('dashboard.riskStrip')}</CardTitle>
            {risky.length === 0 ? (
              <p className="text-label text-text-secondary flex items-center gap-2">
                <Icon name="check" size={16} className="text-green-600" /> {t('risks.none')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {risky.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="text-label font-semibold">{p.label}</span>
                    <RiskPill risk={p.latest_top_risk} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardTitle action={<Link to="/app/reports" className="text-label text-green-600 hover:underline">{t('common.seeAll')}</Link>}>{t('dashboard.recent')}</CardTitle>
        {analyses.isLoading ? (
          <Skeleton className="h-20" />
        ) : !analyses.data?.length ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-label text-text-secondary">{t('dashboard.noAnalyses')}</p>
            <Button size="sm" icon="plus" onClick={() => nav('/app/analysis/new')} disabled={!plots.length}>
              {t('dashboard.runFirst')}
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {analyses.data.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link to={`/app/analysis/${a.id}`} className="rounded-tile border border-border p-4 flex items-center gap-3 hover:border-green-600 transition-colors">
                  <CropIcon crop={a.summary?.crop ?? null} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold truncate">{t(`analysis.objectives.${a.analysis_type}`)}</span>
                    <span className="block text-caption text-text-secondary truncate">
                      {date(a.created_at, { day: 'numeric', month: 'short' })} · {a.summary?.plots.join('، ')}
                    </span>
                  </span>
                  {a.status === 'completed' ? a.summary?.headline_score != null ? <ScoreBadge score={a.summary.headline_score} /> : <Icon name="check" size={18} className="text-green-600" /> : <Pill tone={a.status === 'failed' ? 'critical' : 'neutral'} icon={a.status === 'failed' ? 'alert' : 'rotate'}>{t(`reports.statuses.${a.status}`)}</Pill>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {env.isError && (
        <Banner icon="info">{t('states.missingData')}</Banner>
      )}
    </div>
  )
}
