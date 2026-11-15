// Soil properties of a location, read from the backend (the AI team's SoilGrids table).
// The user never types soil values; where the table has none, that is said plainly.
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Skeleton, Tile } from '../../components/ui/primitives'
import { Icon } from '../../components/ui/Icon'
import { getSoil, type SoilInfoData } from '../../lib/data/repo'
import { num } from '../../lib/format'

const SHOWN = ['ph', 'sand', 'silt', 'clay', 'organic_carbon', 'nitrogen'] as const

export function SoilTiles({ soil }: { soil: SoilInfoData | null }) {
  const { t } = useTranslation()
  if (!soil)
    return (
      <p className="flex items-start gap-2 text-label text-text-secondary">
        <Icon name="info" size={16} className="mt-0.5 shrink-0" /> {t('soilInfo.none')}
      </p>
    )
  const byKey = Object.fromEntries(soil.properties.map((p) => [p.key, p]))
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {SHOWN.filter((k) => byKey[k]).map((k) => (
          <Tile key={k} className="!p-3">
            <p className="text-caption text-text-secondary">{t(`soilInfo.props.${k}`)}</p>
            <p className="text-body font-semibold tabular-nums mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
              {num(byKey[k].value, 1)}
              {byKey[k].unit !== 'pH' && <span className="text-caption font-normal text-text-secondary"> {byKey[k].unit}</span>}
            </p>
          </Tile>
        ))}
      </div>
      <p className="text-caption text-text-tertiary">{t('soilInfo.source', { a: soil.depth_cm[0], b: soil.depth_cm[1] })}</p>
    </div>
  )
}

export function SoilInfo({ lat, lon }: { lat: number; lon: number }) {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['soil', lat.toFixed(3), lon.toFixed(3)],
    queryFn: () => getSoil(lat, lon),
    staleTime: 60 * 60 * 1000,
    retry: 0,
  })
  return (
    <div className="rounded-tile border border-border px-4 py-3 flex flex-col gap-3">
      <p className="text-label flex items-center gap-2">
        <Icon name="layers" size={16} className="text-green-600" /> {t('soilInfo.title')}
        <span className="text-text-tertiary">({t('soilInfo.auto')})</span>
      </p>
      {q.isLoading ? (
        <Skeleton className="h-16" />
      ) : q.error ? (
        <p className="flex items-start gap-2 text-label text-text-secondary">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" /> {t('soilInfo.failed')}
        </p>
      ) : (
        <SoilTiles soil={q.data?.soil ?? null} />
      )}
    </div>
  )
}
