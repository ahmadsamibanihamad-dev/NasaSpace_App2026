import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { useFarmCtx } from '../layout/FarmContext'
import { useEnvSummary, usePlots, useSavedPlans } from '../hooks/queries'
import { Button, Card, CardTitle, Pill, Skeleton } from '../components/ui/primitives'
import { Banner, DemoBadge, EmptyState, ErrorState } from '../components/ui/states'
import { TickStrip } from '../components/ui/viz'
import { Icon, type IconName } from '../components/ui/Icon'
import { CropIcon } from '../components/crops/CropIcon'
import { FarmMiniMap } from '../components/map/FarmMiniMap'
import { area as fmtArea, cropName, date, num } from '../lib/format'
import { loc } from '../i18n'
import type { MetricSummary, Plot } from '../lib/types'

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
  const plans = useSavedPlans(farm?.id)
  if (!farm) return null
  const plots = plotsQ.data ?? []
  const total = plots.reduce((s, p) => s + p.area_m2, 0)
  const hour = new Date().getHours()
  const quick: { icon: IconName; label: string; to: string }[] = [
    { icon: 'cloudRain', label: t('nav.outlook'), to: '/app/outlook' },
    { icon: 'rotate', label: t('nav.rotation'), to: '/app/rotation' },
    { icon: 'farm', label: t('nav.myFarm'), to: '/app/farm' },
    { icon: 'chart', label: t('nav.analytics'), to: '/app/analytics' },
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
              {farm.governorate && <span className="bg-surface/95 rounded-pill px-3 h-7 flex items-center text-caption">{loc({ ar: farm.governorate.name_ar, en: farm.governorate.name_en })}</span>}
            </div>
          </div>
          <div className="p-6 flex flex-col gap-4 flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-label text-text-secondary">{t('parcels.totalArea')}</p>
                <p className="text-metric font-light tabular-nums">
                  {plotsQ.isLoading ? '—' : fmtArea(total).split(' ')[0]}
                  <span className="text-label text-text-secondary ms-1">{fmtArea(total).split(' ').slice(1).join(' ')}</span>
                </p>
              </div>
              <div>
                <p className="text-label text-text-secondary">{t('common.plots')}</p>
                <p className="text-metric font-light tabular-nums">{plotsQ.isLoading ? '—' : plots.length}</p>
              </div>
            </div>
            {plotsQ.isLoading ? <Skeleton className="h-56" /> : plots.length > 0 && <FarmMiniMap farm={farm} plots={plots} className="h-56" />}
            <Link to="/app/farm" className="text-label text-green-600 hover:underline self-end">
              {t('nav.myFarm')}
            </Link>
          </div>
        </Card>

        {/* Observed conditions */}
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Parcels */}
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
              <table className="w-full min-w-[520px] text-label">
                <thead>
                  <tr className="text-caption text-text-secondary">
                    <th className="text-start font-normal py-2">{t('common.plot')}</th>
                    <th className="text-start font-normal py-2">{t('dashboard.crop')}</th>
                    <th className="text-start font-normal py-2">{t('parcels.area')}</th>
                    <th className="text-start font-normal py-2">{t('farm.irrigation')}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {plots.map((p: Plot) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-3">
                        <Link to={`/app/farm?plot=${p.id}`} className="flex items-center gap-2 hover:underline">
                          <span className="size-3 rounded-pill" style={{ background: p.color }} aria-hidden />
                          <b className="font-semibold">{p.label}</b> <span className="text-text-secondary truncate max-w-40">{p.name}</span>
                        </Link>
                      </td>
                      <td className="py-3">
                        <span className="flex items-center gap-2">
                          <CropIcon crop={p.current_crop_id} size={28} /> {cropName(p.current_crop_id)}
                        </span>
                      </td>
                      <td className="py-3 tabular-nums whitespace-nowrap">{fmtArea(p.area_m2)}</td>
                      <td className="py-3">{p.irrigation_available ? t(`irrigation.${p.irrigation_method ?? 'drip'}`) : t('irrigation.none')}</td>
                      <td className="py-3 text-end">
                        <Link to={`/app/rotation?plot=${p.id}`} className="text-green-600 hover:underline whitespace-nowrap">
                          {t('dashboard.planFor')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-4">
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
      </div>

      <Card>
        <CardTitle action={<Link to="/app/reports" className="text-label text-green-600 hover:underline">{t('common.seeAll')}</Link>}>{t('dashboard.savedPlans')}</CardTitle>
        {plans.isLoading ? (
          <Skeleton className="h-20" />
        ) : !plans.data?.length ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-label text-text-secondary">{t('dashboard.noPlans')}</p>
            <Button size="sm" icon="rotate" onClick={() => nav('/app/rotation')}>
              {t('dashboard.makePlan')}
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {plans.data.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link to={`/app/reports?plan=${p.id}`} className="rounded-tile border border-border p-4 flex items-center gap-3 hover:border-green-600 transition-colors">
                  <span className="flex -space-x-2 rtl:space-x-reverse">
                    {p.summary.crops.map((c) => (
                      <CropIcon key={c} crop={c} size={36} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold truncate">{p.summary.crops.map((c) => cropName(c)).join(' ← ') || t('planner.noPlan')}</span>
                    <span className="block text-caption text-text-secondary truncate">
                      {date(p.summary.planting_date, { day: 'numeric', month: 'short', year: 'numeric' })}
                      {p.plot_label && ` · ${t('common.plot')} ${p.plot_label}`}
                    </span>
                  </span>
                  {p.summary.rotation_score !== null && <b className="text-h2 font-light tabular-nums">{num(p.summary.rotation_score, 0)}</b>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {env.isError && <Banner icon="info">{t('states.missingData')}</Banner>}
    </div>
  )
}
