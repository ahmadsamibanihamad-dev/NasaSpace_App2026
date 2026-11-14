import { useTranslation } from 'react-i18next'
import { cx } from './primitives'
import { num } from '../../lib/format'

/** Semicircle gauge 0..100. */
export function Gauge({ value, size = 220, label }: { value: number | null; size?: number; label?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value))
  const stroke = 14
  const r = (size - stroke) / 2
  const cx0 = size / 2
  const cy0 = size / 2
  const len = Math.PI * r
  const arc = `M ${stroke / 2} ${cy0} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy0}`
  return (
    <div className="relative inline-block" style={{ width: size, height: size / 2 + 8 }} role="img" aria-label={`${label ?? ''} ${num(value, 0)}/100`}>
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`} style={{ direction: 'ltr' }}>
        <path d={arc} fill="none" stroke="#EEF7F0" strokeWidth={stroke} strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke="#2F8F4E"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * len} ${len}`}
          style={{ transition: 'stroke-dasharray 600ms ease' }}
        />
        <circle cx={cx0} cy={cy0} r={0} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="text-metric font-light tabular-nums">{value === null ? '—' : Math.round(v)}</span>
        {label && <span className="text-caption text-text-secondary">{label}</span>}
      </div>
    </div>
  )
}

/** Thin tick-bar strip for trends (e.g. last 12 months). */
export function TickStrip({ values, height = 28, highlightLast = true, ariaLabel }: { values: (number | null)[]; height?: number; highlightLast?: boolean; ariaLabel?: string }) {
  const nums = values.filter((v): v is number => v !== null)
  const max = Math.max(...nums, 1e-9)
  const min = Math.min(...nums, 0)
  return (
    <div className="flex items-end gap-[3px]" style={{ height, direction: 'ltr' }} role="img" aria-label={ariaLabel}>
      {values.map((v, i) => {
        const h = v === null ? 2 : Math.max(3, ((v - min) / (max - min || 1)) * height)
        const last = highlightLast && i === values.length - 1
        return <span key={i} className={cx('w-[4px] rounded-pill', v === null ? 'bg-border' : last ? 'bg-green-600' : 'bg-green-200')} style={{ height: h }} />
      })}
    </div>
  )
}

/** Slim horizontal bar 0..100 with label. */
export function FactorBar({ label, value, icon }: { label: string; value: number | null; icon?: React.ReactNode }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-label">
        <span className="flex items-center gap-2 text-text-secondary">
          {icon}
          {label}
        </span>
        <span className="font-semibold tabular-nums">{value === null ? '—' : Math.round(v)}</span>
      </div>
      <div className="h-2 rounded-pill bg-green-50 overflow-hidden" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-pill bg-green-500" style={{ width: `${v}%`, transition: 'width 500ms ease' }} />
      </div>
    </div>
  )
}

/** Big light number with a small gray label. */
export function Metric({ value, unit, label, sub }: { value: string; unit?: string; label: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label text-text-secondary">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-metric font-light tabular-nums">{value}</span>
        {unit && <span className="text-label text-text-secondary">{unit}</span>}
      </span>
      {sub}
    </div>
  )
}

/** Water demand indicated by 1–3 drops (with text label for accessibility). */
export function Drops({ level }: { level: 1 | 2 | 3 }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${t('results.waterDemand')}: ${level}/3`} role="img">
      {[1, 2, 3].map((i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z" fill={i <= level ? '#2F7FD1' : 'none'} stroke={i <= level ? '#2F7FD1' : '#9A9F9A'} strokeWidth="1.5" />
        </svg>
      ))}
    </span>
  )
}

/** Year-wide window bar: 12 months with a highlighted green band. */
export function WindowBar({ start, end, months }: { start: string | null; end: string | null; months: string[] }) {
  const pos = (iso: string) => {
    const d = new Date(iso)
    const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000
    return (doy / 365) * 100
  }
  const s = start ? pos(start) : null
  const e = end ? pos(end) : null
  const segs: [number, number][] = s === null || e === null ? [] : e >= s ? [[s, e]] : [[s, 100], [0, e]]
  return (
    <div>
      <div className="relative h-3 rounded-pill bg-surface-muted overflow-hidden" style={{ direction: 'ltr' }}>
        {segs.map(([a, b], i) => (
          <div key={i} className="absolute top-0 bottom-0 bg-green-500 rounded-pill" style={{ left: `${a}%`, width: `${Math.max(1.5, b - a)}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-12 mt-1 text-caption text-text-tertiary" style={{ direction: 'ltr' }}>
        {months.map((m) => (
          <span key={m} className="text-center truncate">
            {m}
          </span>
        ))}
      </div>
    </div>
  )
}
