import i18n from '../i18n'
import { HECTARE_M2 } from '../config'
import { getSettings, type AreaUnit } from './settings'

export type { AreaUnit }

// Western digits in both languages.
const nf = (digits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })

export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return nf(digits).format(v)
}

export function getAreaUnit(): AreaUnit {
  return getSettings().areaUnit
}

export function areaValue(m2: number, unit: AreaUnit = getAreaUnit()) {
  if (unit === 'hectare') return m2 / HECTARE_M2
  if (unit === 'm2') return m2
  return m2 / getSettings().dunumM2
}

export function area(m2: number | null | undefined, unit: AreaUnit = getAreaUnit(), digits = 2): string {
  if (m2 === null || m2 === undefined) return '—'
  return `${num(areaValue(m2, unit), unit === 'm2' ? 0 : digits)} ${i18n.t(`units.${unit}`)}`
}

export function meters(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—'
  return m >= 1000 ? `${num(m / 1000, 2)} ${i18n.t('units.km')}` : `${num(m, 0)} ${i18n.t('units.m')}`
}

export function date(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const locale = i18n.language === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB'
  return new Intl.DateTimeFormat(locale, opts).format(d)
}

export function dayMonth(iso: string | null | undefined) {
  return date(iso, { day: 'numeric', month: 'long' })
}

export function monthName(m: number, short = false): string {
  const arr = i18n.t(short ? 'monthsShort' : 'months', { returnObjects: true }) as string[]
  return arr[(m - 1 + 12) % 12]
}

export function cropName(id: string | null | undefined): string {
  if (!id) return i18n.t('crops.fallow')
  return i18n.t(`crops.${id}`, { defaultValue: id })
}

export function scoreTone(score: number | null | undefined): 'green' | 'warning' | 'critical' | 'neutral' {
  if (score === null || score === undefined) return 'neutral'
  if (score >= 60) return 'green'
  if (score >= 40) return 'warning'
  return 'critical'
}

// Green shades for map fill by score; uses the brand ramp only.
export function scoreFill(score: number | null | undefined): string {
  if (score === null || score === undefined) return '#F6F6F4'
  if (score >= 80) return '#2F8F4E'
  if (score >= 60) return '#7FC190'
  if (score >= 40) return '#D7ECDC'
  return '#EEF7F0'
}

/** List separator for the current language (Arabic comma in Arabic). */
export const listSep = () => (i18n.language === 'ar' ? '، ' : ', ')

/** Joins short labels (parcel numbers, crop names) for display. */
export const joinList = (items: readonly string[] | null | undefined) => (items ?? []).join(listSep())
