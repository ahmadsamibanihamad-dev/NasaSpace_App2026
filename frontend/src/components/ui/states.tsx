import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from './Icon'
import { Button, Card, Pill, Skeleton, cx } from './primitives'
import { ApiError } from '../../lib/api'
import type { DataMeta } from '../../lib/types'
import { useOnline } from '../../hooks/useOnline'

export function StateBlock({ icon, title, body, action, tone = 'neutral', className }: { icon: IconName; title: string; body?: ReactNode; action?: ReactNode; tone?: 'neutral' | 'warning' | 'critical'; className?: string }) {
  const iconColor = tone === 'critical' ? 'text-critical' : tone === 'warning' ? 'text-warning' : 'text-green-600'
  return (
    <div className={cx('flex flex-col items-center text-center gap-3 py-12 px-6', className)} role={tone === 'critical' ? 'alert' : 'status'}>
      <span className={cx('size-14 rounded-pill border border-border flex items-center justify-center', iconColor)}>
        <Icon name={icon} size={26} />
      </span>
      <h3 className="text-h2 font-semibold">{title}</h3>
      {body && <p className="text-body text-text-secondary max-w-md">{body}</p>}
      {action}
    </div>
  )
}

export function EmptyState({ title, body, action, icon = 'sprout' }: { title?: string; body?: ReactNode; action?: ReactNode; icon?: IconName }) {
  const { t } = useTranslation()
  return <StateBlock icon={icon} title={title || t('states.emptyTitle')} body={body} action={action} />
}

/** Maps API errors to the right UI state (unsupported location/crop, validation, offline, generic). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  const e = error instanceof ApiError ? error : null
  if (e?.code === 'UNSUPPORTED_LOCATION') return <StateBlock icon="pin" tone="warning" title={t('states.unsupportedLocation')} body={t('states.unsupportedLocationBody')} />
  if (e?.code === 'UNSUPPORTED_CROP') return <StateBlock icon="leaf" tone="warning" title={t('states.unsupportedCrop')} body={t('states.unsupportedCropBody')} />
  if (e?.code === 'VALIDATION_ERROR') return <StateBlock icon="info" tone="warning" title={t('states.validation')} body={e.message} />
  if (e?.isOffline) return <StateBlock icon="wifiOff" tone="warning" title={t('states.serverDown')} body={t('states.serverDownBody')} action={onRetry && <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button>} />
  if (e?.status === 404) return <StateBlock icon="search" title={t('states.notFound')} />
  return (
    <StateBlock
      icon="alert"
      tone="critical"
      title={t('states.errorTitle')}
      body={t('states.errorBody')}
      action={onRetry && <Button variant="secondary" icon="rotate" onClick={onRetry}>{t('common.retry')}</Button>}
    />
  )
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Card className={className} aria-busy="true">
      <Skeleton className="h-6 w-40 mb-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 mb-3" />
      ))}
    </Card>
  )
}

export function Banner({ icon, tone = 'neutral', children }: { icon: IconName; tone?: 'neutral' | 'warning' | 'critical' | 'water'; children: ReactNode }) {
  const c = tone === 'critical' ? 'text-critical' : tone === 'warning' ? 'text-warning' : tone === 'water' ? 'text-water' : 'text-green-600'
  return (
    <div className="flex items-start gap-3 rounded-tile bg-surface border border-border px-4 py-3 text-label" role="status">
      <Icon name={icon} size={18} className={cx('mt-0.5 shrink-0', c)} />
      <div className="text-text-primary">{children}</div>
    </div>
  )
}

export function OfflineBanner() {
  const online = useOnline()
  const { t } = useTranslation()
  if (online) return null
  return (
    <div className="mb-4">
      <Banner icon="wifiOff" tone="warning">
        {t('states.offline')}
      </Banner>
    </div>
  )
}

export function DemoBadge() {
  const { t } = useTranslation()
  return (
    <Pill tone="warning" icon="info">
      {t('common.demoData')}
    </Pill>
  )
}

/** Short note that results come from the historical climate record, not a forecast. */
export function DataFooter({ meta }: { meta: Partial<DataMeta> }) {
  const { t } = useTranslation()
  if (!meta || meta.analysis_basis !== 'historical_climatology') return null
  return (
    <p className="text-caption text-text-secondary flex items-start gap-1">
      <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('results.climatology')}
    </p>
  )
}
