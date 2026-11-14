import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import { Icon } from '../ui/Icon'
import { searchPlaces, type Place } from '../../lib/places'
import { parseLatLonQuery } from '../../lib/geometry'

/** Search by governorate / town name, or type coordinates as "lat, lon". */
export function PlaceSearch({ onPick, placeholder, compact }: { onPick: (p: Place) => void; placeholder?: string; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // when placed over a map, typing/clicking here must not reach the map
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current)
      L.DomEvent.disableScrollPropagation(ref.current)
    }
  }, [])
  const coords = parseLatLonQuery(q)
  const results: Place[] = coords
    ? [{ id: 'coords', kind: 'coords', name_ar: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, name_en: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, lat: coords.lat, lon: coords.lon, zoom: 17 }]
    : searchPlaces(q)
  const pick = (p: Place) => {
    onPick(p)
    setQ(i18n.language === 'ar' ? p.name_ar : p.name_en)
    setOpen(false)
  }
  const ph = placeholder || t('setup.locate.searchPlaceholder')
  return (
    <div className="relative" ref={ref}>
      <Icon name="search" size={18} className="absolute top-1/2 -translate-y-1/2 start-4 text-text-tertiary" />
      <input
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="place-results"
        aria-label={ph}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            pick(results[active])
          }
        }}
        placeholder={ph}
        className={`w-full bg-surface ps-11 pe-4 placeholder:text-text-tertiary focus:outline-none focus:border-green-600 border border-border ${compact ? 'h-10 rounded-pill text-label shadow-soft' : 'h-11 rounded-input text-body'}`}
      />
      {open && results.length > 0 && (
        <ul id="place-results" role="listbox" className="absolute top-12 inset-x-0 z-[1200] bg-surface border border-border rounded-tile shadow-soft p-2 max-h-72 overflow-auto">
          {results.map((p, i) => (
            <li key={p.kind + p.id} role="option" aria-selected={i === active}>
              <button onClick={() => pick(p)} onMouseEnter={() => setActive(i)} className={`w-full text-start px-3 py-2 rounded-input text-label flex items-center justify-between gap-2 ${i === active ? 'bg-surface-muted' : ''}`}>
                <span dir={p.kind === 'coords' ? 'ltr' : undefined}>{i18n.language === 'ar' ? p.name_ar : p.name_en}</span>
                <span className="text-caption text-text-tertiary">{p.kind === 'governorate' ? t('setup.locate.governorate') : p.kind === 'coords' ? t('map.goToCoords') : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
