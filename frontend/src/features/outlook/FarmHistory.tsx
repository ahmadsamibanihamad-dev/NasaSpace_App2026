// Agricultural history of the land: previous crop, its year, earlier crops, irrigation.
// The values go to the backend as they are; nothing is scored here.
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Button, Chip, Field, IconButton, Input, Select } from '../../components/ui/primitives'
import { getOutlookStatus } from '../../lib/data/repo'
import { loc } from '../../i18n'

export type Irr = 'yes' | 'no' | 'unknown'

export interface FarmHistoryValue {
  previous_crop: string // '' = unknown
  previous_crop_year: string
  earlier: { year: string; crop_id: string }[]
  irrigation: Irr
}

export const emptyHistory = (irrigation: boolean | null, previous?: string | null): FarmHistoryValue => ({
  previous_crop: previous ?? '',
  previous_crop_year: '',
  earlier: [],
  irrigation: irrigation === null ? 'unknown' : irrigation ? 'yes' : 'no',
})

/** The request fields the backend expects. Rows without a crop or a valid year are left out. */
export function historyPayload(v: FarmHistoryValue) {
  const year = (s: string) => {
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n >= 1990 && n <= 2100 ? n : null
  }
  return {
    irrigation_available: v.irrigation === 'unknown' ? null : v.irrigation === 'yes',
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
    </div>
  )
}
