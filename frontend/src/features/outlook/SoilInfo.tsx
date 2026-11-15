// Soil and terrain of a location, read from the backend (the AI team's dataset).
// The user never types soil values here; where the dataset has none, that is said plainly.
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Pill, Skeleton, Tile } from '../../components/ui/primitives'
import { Icon } from '../../components/ui/Icon'
import { getSoil, type SoilInfoData, type TerrainData } from '../../lib/data/repo'
import { num } from '../../lib/format'

const SHOWN = ['ph', 'sand', 'silt', 'clay', 'organic_carbon', 'nitrogen', 'cec', 'bulk_density', 'coarse_fragments'] as const

export function SoilTiles({ soil, terrain, compact }: { soil: SoilInfoData | null; terrain?: TerrainData | null; compact?: boolean }) {
  const { t } = useTranslation()
  const shown = compact ? SHOWN.slice(0, 6) : SHOWN
  const byKey = Object.fromEntries((soil?.properties ?? []).map((p) => [p.key, p]))
  const texture = soil?.texture_class?.['0-30']
  return (
    <div className="flex flex-col gap-3">
      {!soil ? (
        <p className="flex items-start gap-2 text-label text-text-secondary">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" /> {t('soilInfo.none')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {texture && (
              <Pill tone="outline" icon="layers">
                {t('soilInfo.texture')}: {t(`soilInfo.classes.${texture}`, { defaultValue: texture })}
              </Pill>
            )}
            {soil.has_laboratory_values && (
              <Pill tone="green" icon="check">
                {t('soilInfo.lab')}
              </Pill>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {shown
              .filter((k) => byKey[k])
              .map((k) => (
                <Tile key={k} className="!p-3">
                  <p className="text-caption text-text-secondary">{t(`soilInfo.props.${k}`)}</p>
                  <p className="text-body font-semibold tabular-nums mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
                    {num(byKey[k].value, k === 'nitrogen' || k === 'bulk_density' ? 2 : 1)}
                    {byKey[k].unit !== 'pH' && <span className="text-caption font-normal text-text-secondary"> {byKey[k].unit}</span>}
                  </p>
                </Tile>
              ))}
          </div>
          <p className="text-caption text-text-tertiary">{t('soilInfo.source', { a: soil.depth_cm[0], b: soil.depth_cm[1] })}</p>
        </>
      )}
      {terrain && !compact && (
        <div>
          <div className="grid grid-cols-3 gap-2">
            <Tile className="!p-3">
              <p className="text-caption text-text-secondary">{t('soilInfo.elevation')}</p>
              <p className="text-body font-semibold tabular-nums mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
                {terrain.elevation_m === null ? '—' : `${num(terrain.elevation_m, 0)} m`}
              </p>
            </Tile>
            <Tile className="!p-3">
              <p className="text-caption text-text-secondary">{t('soilInfo.slope')}</p>
              <p className="text-body font-semibold tabular-nums mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
                {terrain.slope_pct === null ? '—' : `${num(terrain.slope_pct, 1)} %`}
              </p>
            </Tile>
            <Tile className="!p-3">
              <p className="text-caption text-text-secondary">{t('soilInfo.aspect')}</p>
              <p className="text-body font-semibold tabular-nums mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
                {terrain.aspect_deg === null ? t('soilInfo.flat') : `${num(terrain.aspect_deg, 0)}°`}
              </p>
            </Tile>
          </div>
          <p className="text-caption text-text-tertiary mt-2">{t('soilInfo.terrainSource')}</p>
        </div>
      )}
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
        <SoilTiles soil={q.data?.soil ?? null} compact />
      )}
    </div>
  )
}
