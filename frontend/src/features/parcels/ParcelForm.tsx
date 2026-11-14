import { useTranslation } from 'react-i18next'
import type { Polygon } from 'geojson'
import { Field, Input, Select, cx } from '../../components/ui/primitives'
import { Icon } from '../../components/ui/Icon'
import { CROP_IDS } from '../../lib/places'
import { areaM2, centroidOf, perimeterM } from '../../lib/geometry'
import { area as fmtArea, meters, num } from '../../lib/format'
import { useSettings } from '../../lib/settings'
import type { PlotDraft, PlotStatus } from '../../lib/types'
import { PARCEL_COLORS } from './io'

const METHODS = ['drip', 'sprinkler', 'surface'] as const
const SOILS = ['clay', 'loam', 'sandy', 'silty', 'calcareous', 'unknown'] as const
export const STATUSES: PlotStatus[] = ['planted', 'fallow', 'preparing', 'unused']

/** Computed area / perimeter / centre cards. Always shows the dunum conversion in use. */
export function ParcelMetrics({ polygon, points }: { polygon: Polygon | null; points?: number }) {
  const { t } = useTranslation()
  const s = useSettings()
  const a = areaM2(polygon)
  const c = polygon ? centroidOf(polygon) : null
  const n = points ?? (polygon ? polygon.coordinates[0].length - 1 : 0)
  const Cell = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="bg-surface-muted rounded-tile px-3 py-2 min-w-0">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="text-label font-semibold tabular-nums truncate" dir="ltr" style={{ textAlign: 'start' }}>
        {value}
      </p>
      {sub && <p className="text-caption text-text-tertiary truncate">{sub}</p>}
    </div>
  )
  return (
    <div aria-live="polite">
      <div className="grid grid-cols-2 gap-2">
        <Cell label={t('parcels.area')} value={polygon ? fmtArea(a, 'dunum') : '—'} sub={polygon ? `${fmtArea(a, 'hectare', 3)} · ${fmtArea(a, 'm2')}` : undefined} />
        <Cell label={t('parcels.perimeter')} value={polygon ? meters(perimeterM(polygon)) : '—'} sub={t('parcels.vertices', { n })} />
        <div className="col-span-2">
          <Cell label={t('parcels.center')} value={c ? `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}` : '—'} />
        </div>
      </div>
      <p className="text-caption text-text-tertiary mt-1 flex items-center gap-1">
        <Icon name="info" size={12} /> {t('parcels.dunumNote', { m2: num(s.dunumM2, 0) })}
      </p>
    </div>
  )
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" aria-label={t('parcels.color')} className="flex flex-wrap gap-2">
      {PARCEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx('size-8 rounded-pill border-2 flex items-center justify-center', value === c ? 'border-text-primary' : 'border-surface')}
          style={{ background: c, boxShadow: '0 0 0 1px #E2E2DE' }}
        >
          {value === c && <Icon name="check" size={14} className="text-white" />}
        </button>
      ))}
    </div>
  )
}

export type FormErrors = Partial<Record<'name' | 'label', string>>

export function ParcelForm({ value, onChange, errors, farmName }: { value: PlotDraft; onChange: (patch: Partial<PlotDraft>) => void; errors: FormErrors; farmName: string }) {
  const { t } = useTranslation()
  const cropOpts = (
    <>
      <option value="">{t('crops.fallow')}</option>
      {CROP_IDS.map((c) => (
        <option key={c} value={c}>
          {t(`crops.${c}`)}
        </option>
      ))}
    </>
  )
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('parcels.farmName')}>
        <Input value={farmName} disabled className="!bg-surface-muted" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label={t('parcels.name') + ' *'} htmlFor="p-name" error={errors.name}>
            <Input id="p-name" value={value.name} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!!errors.name} maxLength={80} />
          </Field>
        </div>
        <Field label={t('parcels.number') + ' *'} htmlFor="p-num" error={errors.label}>
          <Input id="p-num" dir="ltr" value={value.label} onChange={(e) => onChange({ label: e.target.value })} aria-invalid={!!errors.label} maxLength={12} />
        </Field>
      </div>
      <Field label={t('parcels.region')} htmlFor="p-region">
        <Input id="p-region" value={value.region} onChange={(e) => onChange({ region: e.target.value })} maxLength={80} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('parcels.cropType')} htmlFor="p-crop">
          <Select id="p-crop" value={value.current_crop_id ?? ''} onChange={(e) => onChange({ current_crop_id: e.target.value || null, status: e.target.value ? 'planted' : value.status === 'planted' ? 'fallow' : value.status })}>
            {cropOpts}
          </Select>
        </Field>
        <Field label={t('parcels.status')} htmlFor="p-status">
          <Select id="p-status" value={value.status} onChange={(e) => onChange({ status: e.target.value as PlotStatus })}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`parcels.statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('setup.details.previousCrop')} htmlFor="p-prev">
          <Select id="p-prev" value={value.previous_crop_id ?? ''} onChange={(e) => onChange({ previous_crop_id: e.target.value || null })}>
            {cropOpts}
          </Select>
        </Field>
        <Field label={t('setup.details.method')} htmlFor="p-irr">
          <Select
            id="p-irr"
            value={value.irrigation_available ? value.irrigation_method ?? 'drip' : 'none'}
            onChange={(e) => onChange({ irrigation_available: e.target.value !== 'none', irrigation_method: e.target.value })}
          >
            <option value="none">{t('irrigation.none')}</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`irrigation.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('setup.details.soilType')} (${t('common.optional')})`} htmlFor="p-soil">
          <Select id="p-soil" value={value.soil_type ?? ''} onChange={(e) => onChange({ soil_type: e.target.value || null })}>
            <option value="">—</option>
            {SOILS.map((s) => (
              <option key={s} value={s}>
                {t(`soil.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('setup.details.ph')} (${t('common.optional')})`} htmlFor="p-ph">
          <Input
            id="p-ph"
            type="number"
            dir="ltr"
            step="0.1"
            min={3}
            max={10.5}
            value={value.soil_ph ?? ''}
            onChange={(e) => onChange({ soil_ph: e.target.value === '' ? null : Math.min(10.5, Math.max(3, parseFloat(e.target.value))) })}
          />
        </Field>
      </div>
      <Field label={t('parcels.color')}>
        <ColorPicker value={value.color} onChange={(color) => onChange({ color })} />
      </Field>
      <Field label={t('parcels.notes')} htmlFor="p-notes">
        <textarea
          id="p-notes"
          rows={2}
          maxLength={500}
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          className="w-full rounded-input border border-border bg-surface px-4 py-2 text-body focus:border-green-600 focus:outline-none"
        />
      </Field>
      <details className="rounded-tile border border-border px-4 py-3" open={!!(value.owner_name || value.owner_phone)}>
        <summary className="text-label cursor-pointer flex items-center gap-2">
          <Icon name="user" size={16} /> {t('parcels.owner')} <span className="text-text-tertiary">({t('common.optional')})</span>
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label={t('parcels.ownerName')} htmlFor="p-owner">
            <Input id="p-owner" value={value.owner_name} onChange={(e) => onChange({ owner_name: e.target.value })} maxLength={80} />
          </Field>
          <Field label={t('parcels.ownerPhone')} htmlFor="p-phone">
            <Input id="p-phone" dir="ltr" inputMode="tel" value={value.owner_phone} onChange={(e) => onChange({ owner_phone: e.target.value.replace(/[^\d+\s-]/g, '') })} maxLength={20} />
          </Field>
        </div>
      </details>
    </div>
  )
}
