import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-pill font-normal transition-colors select-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-green-600'
const btnVariants: Record<BtnVariant, string> = {
  primary: 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800',
  secondary: 'bg-surface text-text-primary border border-border hover:bg-surface-muted active:bg-green-50',
  ghost: 'bg-transparent text-text-primary hover:bg-surface-muted',
  danger: 'bg-surface text-critical border border-border hover:bg-surface-muted',
}
const btnSizes = { sm: 'h-8 px-3 text-label', md: 'h-10 px-5 text-label', lg: 'h-12 px-6 text-body' }

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: keyof typeof btnSizes; icon?: IconName; iconEnd?: IconName; loading?: boolean }
>(function Button({ variant = 'primary', size = 'md', icon, iconEnd, loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={cx(btnBase, btnVariants[variant], btnSizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden /> : icon && <Icon name={icon} size={18} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={18} className="rtl:-scale-x-100" />}
    </button>
  )
})

export function IconButton({
  icon,
  label,
  active,
  className,
  size = 40,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; active?: boolean; size?: number }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center rounded-pill border transition-colors shrink-0',
        active ? 'border-green-600 bg-green-50 text-green-700' : 'border-border bg-surface text-text-primary hover:bg-surface-muted',
        'disabled:opacity-40',
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.48)} />
    </button>
  )
}

export function Card({ children, className, as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx('bg-surface rounded-card p-4 sm:p-6 shadow-soft', className)} {...rest}>
      {children}
    </As>
  )
}

export function CardTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-4 mb-4', className)}>
      <h2 className="text-h2 font-semibold">{children}</h2>
      {action}
    </div>
  )
}

export function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('bg-surface-muted rounded-tile p-4', className)}>{children}</div>
}

type PillTone = 'green' | 'neutral' | 'water' | 'warning' | 'critical' | 'outline'
// Semantic hues (water/warning/critical) colour only the icon so text keeps AA contrast.
const pillTones: Record<PillTone, string> = {
  green: 'bg-green-50 text-green-700',
  neutral: 'bg-surface-muted text-text-secondary',
  water: 'bg-surface-muted text-text-primary',
  warning: 'bg-surface-muted text-text-primary',
  critical: 'bg-surface-muted text-text-primary',
  outline: 'border border-border text-text-secondary bg-surface',
}
const pillIconTones: Partial<Record<PillTone, string>> = { water: 'text-water', warning: 'text-warning', critical: 'text-critical' }
export function Pill({ children, tone = 'neutral', icon, className }: { children: ReactNode; tone?: PillTone; icon?: IconName; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-pill px-3 h-7 text-caption font-normal whitespace-nowrap', pillTones[tone], className)}>
      {icon && <Icon name={icon} size={14} className={pillIconTones[tone]} />}
      {children}
    </span>
  )
}

export function Chip({ selected, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'inline-flex items-center gap-2 h-9 px-4 rounded-pill text-label border transition-colors whitespace-nowrap',
        selected ? 'bg-green-600 border-green-600 text-white' : 'bg-surface border-border text-text-primary hover:bg-surface-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('inline-flex max-w-full overflow-x-auto p-1 rounded-pill bg-surface-muted gap-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 px-3 sm:px-4 rounded-pill text-label transition-colors whitespace-nowrap shrink-0',
            value === o.value ? 'bg-surface text-text-primary shadow-soft font-semibold' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string | null; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-label text-text-secondary">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-caption text-critical flex items-center gap-1">
          <Icon name="info" size={14} /> {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  )
}

const inputCls =
  'h-11 w-full rounded-input border border-border bg-surface px-4 text-body text-text-primary placeholder:text-text-tertiary hover:border-text-tertiary focus:border-green-600 focus:outline-none focus-visible:outline-2 focus-visible:outline-green-600 aria-[invalid=true]:border-critical'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...rest} />
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'pe-8 appearance-auto', className)} {...rest}>
      {children}
    </select>
  )
}

export function Stepper({ value, onChange, min = 1, max = 20, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={label}>
      <span className="text-label text-text-secondary">{label}</span>
      <button aria-label={`${label} -`} className="size-8 rounded-pill border border-border hover:bg-surface-muted disabled:opacity-40" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-6 text-center text-label font-semibold tabular-nums">{value}</span>
      <button aria-label={`${label} +`} className="size-8 rounded-pill border border-border hover:bg-surface-muted disabled:opacity-40" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-6 w-11 shrink-0 rounded-pill transition-colors', checked ? 'bg-green-600' : 'bg-border')}
    >
      <span className={cx('absolute top-0.5 size-5 rounded-pill bg-white transition-all', checked ? 'start-[22px]' : 'start-0.5')} />
    </button>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4 sm:mb-6">
      <div>
        <h1 className="text-display font-light">{title}</h1>
        {subtitle && <p className="text-body text-text-secondary mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
