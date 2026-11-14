import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../ui/Icon'
import { searchPlaces, type Place } from '../../lib/places'

export function PlaceSearch({ onPick, placeholder }: { onPick: (p: Place) => void; placeholder?: string }) {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const results = searchPlaces(q)
  const pick = (p: Place) => {
    onPick(p)
    setQ(i18n.language === 'ar' ? p.name_ar : p.name_en)
  }
  return (
    <div className="relative">
      <Icon name="search" size={18} className="absolute top-1/2 -translate-y-1/2 start-4 text-text-tertiary" />
      <input
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="place-results"
        aria-label={placeholder || t('setup.locate.searchPlaceholder')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            pick(results[active])
          }
        }}
        placeholder={placeholder || t('setup.locate.searchPlaceholder')}
        className="h-11 w-full rounded-input border border-border bg-surface ps-11 pe-4 text-body placeholder:text-text-tertiary focus:outline-none focus:border-green-600"
      />
      {results.length > 0 && (
        <ul id="place-results" role="listbox" className="absolute top-12 inset-x-0 z-[1200] bg-surface border border-border rounded-tile shadow-soft p-2 max-h-72 overflow-auto">
          {results.map((p, i) => (
            <li key={p.kind + p.id} role="option" aria-selected={i === active}>
              <button
                onClick={() => pick(p)}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-start px-3 py-2 rounded-input text-label flex items-center justify-between ${i === active ? 'bg-surface-muted' : ''}`}
              >
                <span>{i18n.language === 'ar' ? p.name_ar : p.name_en}</span>
                <span className="text-caption text-text-tertiary">{p.kind === 'governorate' ? t('setup.locate.governorate') : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
