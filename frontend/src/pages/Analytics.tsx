import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFarmCtx } from '../layout/FarmContext'
import { useTimeSeries } from '../hooks/queries'
import { Card, Chip, Skeleton, Tabs } from '../components/ui/primitives'
import { EmptyState, ErrorState } from '../components/ui/states'
import { Icon, type IconName } from '../components/ui/Icon'
import { date, monthName, num } from '../lib/format'

const VARS: { id: string; icon: IconName }[] = [
  { id: 'temperature', icon: 'thermo' },
  { id: 'rainfall', icon: 'cloudRain' },
  { id: 'soil_moisture', icon: 'drop' },
  { id: 'humidity', icon: 'wind' },
  { id: 'solar_radiation', icon: 'sun' },
]
const RES = ['daily', 'monthly', 'seasonal', 'annual'] as const

export default function Analytics() {
  const { t } = useTranslation()
  const { farm } = useFarmCtx()
  const [variable, setVariable] = useState('temperature')
  const [resolution, setResolution] = useState<(typeof RES)[number]>('monthly')
  const q = useTimeSeries(farm, variable, resolution)

  const tick = (v: string) => {
    if (resolution === 'daily') return date(v, { day: 'numeric', month: 'short' })
    if (resolution === 'monthly') return `${monthName(+v.slice(5, 7), true)} ${v.slice(2, 4)}`
    if (resolution === 'seasonal') return `${t(`analytics.seasons.${v.split('-')[1]}`)} ${v.slice(2, 4)}`
    return v
  }
  const data = q.data?.points ?? []
  const hasData = data.some((p) => p.value !== null)
  const isRain = variable === 'rainfall'
  const unit = q.data?.unit ?? ''

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {VARS.map((v) => (
          <Chip key={v.id} selected={variable === v.id} onClick={() => setVariable(v.id)}>
            <Icon name={v.icon} size={16} /> {t(`analytics.variables.${v.id}`)}
          </Chip>
        ))}
        <span className="ms-auto">
          <Tabs value={resolution} onChange={setResolution} options={RES.map((r) => ({ value: r, label: t(`analytics.resolutions.${r}`) }))} />
        </span>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-h2 font-semibold">
            {t(`analytics.variables.${variable}`)} <span className="text-label font-normal text-text-secondary" dir="ltr">({unit})</span>
          </h2>
          <span className="text-caption text-text-secondary">{farm?.name}</span>
        </div>
        {q.isLoading ? (
          <Skeleton className="h-[380px]" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !hasData ? (
          <EmptyState icon="chart" title={t('analytics.noData')} body={t('states.missingData')} />
        ) : (
          <div className="h-[380px]" dir="ltr" role="img" aria-label={`${t(`analytics.variables.${variable}`)} · ${t(`analytics.resolutions.${resolution}`)}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#E2E2DE" vertical={false} />
                <XAxis dataKey="t" tickFormatter={tick} tick={{ fontSize: 12, fill: '#6B706B' }} tickLine={false} axisLine={{ stroke: '#E2E2DE' }} minTickGap={24} />
                <YAxis tick={{ fontSize: 12, fill: '#6B706B' }} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  formatter={(v, name) => [`${num(Number(v), 1)} ${unit}`, String(name)]}
                  labelFormatter={(l) => tick(String(l))}
                  contentStyle={{ borderRadius: 12, border: '1px solid #E2E2DE', fontSize: 12, fontFamily: 'inherit' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {isRain || resolution === 'annual' || resolution === 'seasonal' ? (
                  <Bar dataKey="value" name={t('analytics.thisYear')} fill={isRain ? '#2F7FD1' : '#2F8F4E'} radius={[6, 6, 0, 0]} maxBarSize={28} />
                ) : (
                  <Line dataKey="value" name={t('analytics.thisYear')} stroke="#2F8F4E" strokeWidth={2} dot={false} connectNulls />
                )}
                <Line dataKey="historical_mean" name={t('analytics.historical')} stroke="#6B706B" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {variable === 'soil_moisture' && (
          <p className="text-caption text-text-tertiary flex items-start gap-1">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('analytics.soilNote')}
          </p>
        )}
      </Card>
    </div>
  )
}
