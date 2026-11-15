// Signed-in forecast outlook: pick a parcel, see the 30- and 90-day forecast and ranked crops.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFarmCtx } from '../layout/FarmContext'
import { usePlots } from '../hooks/queries'
import { Field, PageHeader, Select, Skeleton } from '../components/ui/primitives'
import { ErrorState } from '../components/ui/states'
import { OutlookView } from '../features/outlook/OutlookView'
import { centroidOf } from '../lib/geometry'

export default function Outlook() {
  const { t } = useTranslation()
  const { farm } = useFarmCtx()
  const plotsQ = usePlots(farm?.id)
  const [plotId, setPlotId] = useState<string>('')

  if (!farm || plotsQ.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (plotsQ.error) return <ErrorState error={plotsQ.error} onRetry={() => plotsQ.refetch()} />
  const plots = plotsQ.data ?? []
  const plot = plots.find((p) => p.id === plotId) ?? plots[0] ?? null
  // No parcels yet: use the farm's located point, with irrigation unknown.
  const point = plot ? centroidOf(plot.polygon) : farm.centroid

  return (
    <>
      <PageHeader
        title={t('outlook.title')}
        subtitle={t('outlook.subtitle')}
        actions={
          plots.length > 0 ? (
            <div className="w-56">
              <Field label={t('rotation.pickPlot')} htmlFor="outlook-plot">
                <Select id="outlook-plot" value={plot?.id ?? ''} onChange={(e) => setPlotId(e.target.value)}>
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
      <OutlookView lat={point.lat} lon={point.lon} irrigation={plot ? plot.irrigation_available : null} soilPh={plot?.soil_ph ?? null} />
    </>
  )
}
