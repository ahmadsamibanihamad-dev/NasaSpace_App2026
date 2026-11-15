// Crop Rotation Planner for a signed-in user: pick a parcel, get a 90-day planting sequence.
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useFarmCtx } from '../layout/FarmContext'
import { usePlots } from '../hooks/queries'
import { Field, PageHeader, Select, Skeleton } from '../components/ui/primitives'
import { ErrorState } from '../components/ui/states'
import { RotationPlanner } from '../features/rotation/RotationPlanner'
import { centroidOf } from '../lib/geometry'
import { loc } from '../i18n'

export default function Rotation() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const { farm } = useFarmCtx()
  const plotsQ = usePlots(farm?.id)
  const [plotId, setPlotId] = useState<string>(params.get('plot') ?? '')

  if (!farm || plotsQ.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (plotsQ.error) return <ErrorState error={plotsQ.error} onRetry={() => plotsQ.refetch()} />
  const plots = plotsQ.data ?? []
  const plot = plots.find((p) => p.id === plotId) ?? plots[0] ?? null
  // No parcels yet: plan for the farm's located point, with irrigation unknown.
  const point = plot ? centroidOf(plot.polygon) : farm.centroid
  const gov = farm.governorate ? loc({ ar: farm.governorate.name_ar, en: farm.governorate.name_en }) : ''
  const place = [farm.name, plot ? `${t('common.plot')} ${plot.label}` : null, gov].filter(Boolean).join(' · ')

  return (
    <>
      <PageHeader
        title={t('planner.title')}
        subtitle={t('planner.subtitle')}
        actions={
          plots.length > 0 ? (
            <div className="w-56">
              <Field label={t('rotation.pickPlot')} htmlFor="planner-plot">
                <Select id="planner-plot" value={plot?.id ?? ''} onChange={(e) => setPlotId(e.target.value)}>
                  {plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.name ? ` · ${p.name}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : undefined
        }
      />
      <RotationPlanner
        key={plot?.id ?? 'farm'}
        lat={point.lat}
        lon={point.lon}
        place={place}
        defaultIrrigation={plot ? plot.irrigation_available : null}
        defaultPrevious={plot?.current_crop_id ?? null}
        farmId={farm.id}
        plotId={plot?.id ?? null}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['rotation-plans'] })
          nav('/app/reports')
        }}
      />
    </>
  )
}
