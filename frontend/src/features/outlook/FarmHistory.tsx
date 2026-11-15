// What the user knows about the land: previous crop, its year, earlier crops, irrigation,
// cultivation type and optional laboratory soil results.
// The values go to the backend as they are; nothing is scored here.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Button, Chip, Field, IconButton, Input, Pill, Select } from '../../components/ui/primitives'
import { Icon } from '../../components/ui/Icon'
import { getOutlookStatus } from '../../lib/data/repo'
import { loc } from '../../i18n'

export type Irr = 'yes' | 'no' | 'unknown'
export type Cultivation = 'open_field' | 'greenhouse'

// Laboratory soil results the backend accepts, with the unit shown next to each and its allowed maximum.
export const LAB_FIELDS = [
  { key: 'ph', unit: '', max: 14 },
  { key: 'sand', unit: '%', max: 100 },
  { key: 'silt', unit: '%', max: 100 },
  { key: 'clay', unit: '%', max: 100 },
  { key: 'organic_carbon', unit: 'g/kg', max: null },
  { key: 'nitrogen', unit: 'g/kg', max: null },
  { key: 'cec', unit: 'cmol/kg', max: null },
  { key: 'coarse_fragments', unit: '%', max: 100 },
] as const
export type LabKey = (typeof LAB_FIELDS)[number]['key']
export type LabValues = Partial<Record<LabKey, number>>
type LabDraft = Partial<Record<LabKey, string>>

export interface FarmHistoryValue {
  previous_crop: string // '' = unknown
  previous_crop_year: string
  earlier: { year: string; crop_id: string }[]
  irrigation: Irr
  cultivation: Cultivation
  /** Applied laboratory results; empty = use the estimated soil of the location. */
  lab: LabValues
}

export const emptyHistory = (irrigation: boolean | null, previous?: string | null, lab?: LabValues | null): FarmHistoryValue => ({
  previous_crop: previous ?? '',
  previous_crop_year: '',
  earlier: [],
  irrigation: irrigation === null ? 'unknown' : irrigation ? 'yes' : 'no',
  cultivation: 'open_field',
  lab: lab ?? {}, // the parcel's stored laboratory test, when it has one
})

/** Parse the typed laboratory values. Returns the numbers, or the reason they cannot be used. */
export function parseLab(draft: LabDraft): { values: LabValues } | { error: 'range' | 'texture' } {
  const values: LabValues = {}
  for (const f of LAB_FIELDS) {
    const raw = (draft[f.key] ?? '').trim()
    if (!raw) continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || (f.max !== null && n > f.max)) return { error: 'range' }
    values[f.key] = n
  }
  // Soil texture is one measurement: sand, silt and clay are only meaningful together.
  const parts = (['sand', 'silt', 'clay'] as const).filter((k) => values[k] !== undefined).length
  if (parts !== 0 && parts !== 3) return { error: 'texture' }
  return { values }
}

/** The request fields the backend expects. Rows without a crop or a valid year are left out. */
export function historyPayload(v: FarmHistoryValue) {
  const year = (s: string) => {
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n >= 1990 && n <= 2100 ? n : null
  }
  return {
    irrigation_available: v.irrigation === 'unknown' ? null : v.irrigation === 'yes',
    cultivation_type: v.cultivation,
    soil_lab: Object.keys(v.lab).length ? v.lab : null,
    previous_crop: v.previous_crop || null,
    previous_crop_year: v.previous_crop ? year(v.previous_crop_year) : null,
    crop_history: v.earlier.filter((r) => r.crop_id && year(r.year) !== null).map((r) => ({ year: year(r.year) as number, crop_id: r.crop_id })),
  }
}

export const historyKey = (v: FarmHistoryValue) => JSON.stringify(historyPayload(v))

export function usePreviousCrops() {
  const q = useQuery({ queryKey: ['outlook-status'], queryFn: getOutlookStatus, staleTime: 60 * 60 * 1000, retry: 0 })
  return q.data?.previous_crops ?? []
}

export function LabSoil({ value, onChange, idPrefix, note, narrow }: { value: LabValues; onChange: (v: LabValues) => void; idPrefix: string; note?: string; narrow?: boolean }) {
  const { t } = useTranslation()
  const applied = Object.keys(value).length
  const [open, setOpen] = useState(applied > 0)
  const [draft, setDraft] = useState<LabDraft>(() => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)])))
  const [error, setError] = useState<'range' | 'texture' | 'empty' | null>(null)

  const apply = () => {
    const r = parseLab(draft)
    if ('error' in r) return setError(r.error)
    if (!Object.keys(r.values).length) return setError('empty')
    setError(null)
    onChange(r.values)
  }
  const clear = () => {
    setDraft({})
    setError(null)
    if (applied) onChange({})
  }

  return (
    <div className="rounded-tile border border-border px-4 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label flex items-center gap-2 min-w-0">
          <Icon name="layers" size={16} className="text-green-600 shrink-0" /> {t('history.lab.title')}
          <span className="text-text-tertiary">({t('history.lab.optional')})</span>
        </p>
        <div className="flex items-center gap-2">
          {applied > 0 && (
            <Pill tone="green" icon="check">
              {t('history.lab.applied', { n: applied })}
            </Pill>
          )}
          <Button variant="secondary" size="sm" icon={open ? 'chevronUp' : 'plus'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {t(open ? 'history.lab.hide' : 'history.lab.add')}
          </Button>
        </div>
      </div>
      {open && (
        <>
          <p className="text-caption text-text-secondary">{note ?? t('history.lab.body')}</p>
          <div className={narrow ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 sm:grid-cols-4 gap-3'}>
            {LAB_FIELDS.map((f) => (
              <Field key={f.key} label={`${t(`soilInfo.props.${f.key}`)}${f.unit ? ` (${f.unit})` : ''}`} htmlFor={`${idPrefix}-lab-${f.key}`}>
                <Input
                  id={`${idPrefix}-lab-${f.key}`}
                  type="number"
                  dir="ltr"
                  inputMode="decimal"
                  min={0}
                  max={f.max ?? undefined}
                  step="any"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-caption text-critical flex items-start gap-1">
              <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t(`history.lab.error.${error}`)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="check" onClick={apply}>
              {t('history.lab.apply')}
            </Button>
            <Button variant="secondary" size="sm" icon="rotate" onClick={clear}>
              {t('history.lab.clear')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function FarmHistory({ value, onChange, idPrefix }: { value: FarmHistoryValue; onChange: (v: FarmHistoryValue) => void; idPrefix: string }) {
  const { t } = useTranslation()
  const crops = usePreviousCrops()
  const options = (
    <>
      {crops.map((c) => (
        <option key={c.crop_id} value={c.crop_id}>
          {loc(c.name)}
        </option>
      ))}
    </>
  )
  const setRow = (i: number, patch: Partial<{ year: string; crop_id: string }>) => onChange({ ...value, earlier: value.earlier.map((r, k) => (k === i ? { ...r, ...patch } : r)) })

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="sm:col-span-2 lg:col-span-1">
          <Field label={t('history.previous')} htmlFor={`${idPrefix}-prev`}>
            <Select id={`${idPrefix}-prev`} value={value.previous_crop} onChange={(e) => onChange({ ...value, previous_crop: e.target.value })}>
              <option value="">{t('history.unknown')}</option>
              {options}
            </Select>
          </Field>
        </div>
        <Field label={t('history.year')} htmlFor={`${idPrefix}-year`} hint={t('history.yearHint')}>
          <Input
            id={`${idPrefix}-year`}
            type="number"
            dir="ltr"
            inputMode="numeric"
            min={1990}
            max={2100}
            placeholder="2025"
            disabled={!value.previous_crop}
            value={value.previous_crop_year}
            onChange={(e) => onChange({ ...value, previous_crop_year: e.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <p className="text-label text-text-secondary mb-1">{t('planner.irrigation')}</p>
          <div role="radiogroup" aria-label={t('planner.irrigation')} className="flex flex-wrap gap-2">
            {(['yes', 'no', 'unknown'] as Irr[]).map((v) => (
              <Chip key={v} selected={value.irrigation === v} onClick={() => onChange({ ...value, irrigation: v })} role="radio" aria-checked={value.irrigation === v} className="!h-10">
                {t(`planner.irr.${v}`)}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {value.earlier.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-label text-text-secondary">{t('history.earlier')}</p>
          {value.earlier.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="!w-28" type="number" dir="ltr" inputMode="numeric" min={1990} max={2100} placeholder="2024" aria-label={`${t('history.year')} ${i + 1}`} value={r.year} onChange={(e) => setRow(i, { year: e.target.value })} />
              <Select className="flex-1 min-w-0" aria-label={`${t('history.crop')} ${i + 1}`} value={r.crop_id} onChange={(e) => setRow(i, { crop_id: e.target.value })}>
                <option value="">{t('history.pick')}</option>
                {options}
              </Select>
              <IconButton icon="trash" label={t('common.delete')} onClick={() => onChange({ ...value, earlier: value.earlier.filter((_, k) => k !== i) })} />
            </div>
          ))}
        </div>
      )}
      {value.earlier.length < 4 && (
        <Button variant="secondary" size="sm" icon="plus" className="self-start" onClick={() => onChange({ ...value, earlier: [...value.earlier, { year: '', crop_id: '' }] })}>
          {t('history.addEarlier')}
        </Button>
      )}

      <div>
        <p className="text-label text-text-secondary mb-1">{t('planner.cultivation')}</p>
        <div role="radiogroup" aria-label={t('planner.cultivation')} className="flex flex-wrap gap-2">
          {(['open_field', 'greenhouse'] as Cultivation[]).map((v) => (
            <Chip key={v} selected={value.cultivation === v} onClick={() => onChange({ ...value, cultivation: v })} role="radio" aria-checked={value.cultivation === v} className="!h-10">
              {t(v === 'open_field' ? 'planner.openField' : 'planner.greenhouse')}
            </Chip>
          ))}
        </div>
        {value.cultivation === 'greenhouse' && <p className="text-caption text-text-secondary mt-2">{t('history.greenhouseNote')}</p>}
      </div>

      <LabSoil value={value.lab} onChange={(lab) => onChange({ ...value, lab })} idPrefix={idPrefix} />
    </div>
  )
}
