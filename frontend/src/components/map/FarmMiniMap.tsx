import { useMemo } from 'react'
import { FitBounds, JordanMap } from './JordanMap'
import { ParcelsLayer } from '../../features/parcels/ParcelsLayer'
import { boundsOf } from '../../lib/geometry'
import type { Farm, Plot } from '../../lib/types'

/** Compact farm map in the parcels' own colours; `picked` highlights a selection. */
export function FarmMiniMap({
  farm,
  plots,
  picked,
  onPick,
  interactive = false,
  className = '',
}: {
  farm: Farm
  plots: Plot[]
  picked?: string[]
  onPick?: (id: string) => void
  interactive?: boolean
  className?: string
}) {
  const bounds = useMemo(() => boundsOf(plots.map((p) => p.polygon)), [plots])
  const colorOf = (p: Plot) => {
    if (picked) return picked.includes(p.id) ? '#24753F' : '#F6F6F4'
    return p.color
  }
  return (
    <div className={`rounded-tile overflow-hidden relative ${className}`}>
      <JordanMap center={[farm.centroid.lat, farm.centroid.lon]} zoom={15} interactive={interactive}>
        <FitBounds bounds={bounds} token={plots.map((p) => p.id + p.updated_at).join()} />
        <ParcelsLayer plots={plots} colorOf={colorOf} onSelect={onPick} labelMode="short" />
      </JordanMap>
    </div>
  )
}
