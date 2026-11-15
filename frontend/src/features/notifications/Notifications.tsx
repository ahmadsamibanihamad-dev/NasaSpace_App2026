// In-app notifications of the current farm, shown in the header's bell menu.
// They are built from what the backend already returns (finished analyses and each parcel's top risk);
// nothing is scored here. The two switches in Settings decide which kinds are shown, and the time the
// menu was last opened (kept in this browser) decides what counts as new.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { useAnalyses, usePlots } from '../../hooks/queries'
import { date } from '../../lib/format'
import { useSettings } from '../../lib/settings'
import { buildNotices, type Notice } from './notices'

const SEEN_KEY = 'ardna.notifications.seen'

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')
  } catch {
    return {}
  }
}

export function useNotifications(farmId?: string) {
  const s = useSettings()
  const analyses = useAnalyses(farmId)
  const plots = usePlots(farmId)
  const [seen, setSeen] = useState<Record<string, string>>(readSeen)
  const items = useMemo(() => buildNotices(analyses.data ?? [], plots.data ?? [], { risks: s.notifyRisks, analyses: s.notifyAnalyses }), [analyses.data, plots.data, s.notifyRisks, s.notifyAnalyses])
  const last = farmId ? seen[farmId] ?? '' : ''
  const unread = items.filter((n) => n.at > last).length
  const markSeen = () => {
    if (!farmId) return
    const next = { ...readSeen(), [farmId]: new Date().toISOString() }
    setSeen(next)
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(next))
    } catch {
      /* private mode: the badge simply comes back on reload */
    }
  }
  return { items, unread, last, markSeen, off: !s.notifyRisks && !s.notifyAnalyses }
}

const ICON: Record<Notice['kind'], IconName> = { analysis: 'check', failed: 'alert', risk: 'alert' }

/** The list inside the bell menu. Opening it marks everything as seen. */
export function NotificationList({ items, last, off, onOpen, close }: { items: Notice[]; last: string; off: boolean; onOpen: () => void; close: () => void }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  // remember what was new when the menu opened, so the "new" dots stay while it is open
  const [wasLast] = useState(last)
  useEffect(() => {
    onOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (off) return <p className="px-3 py-4 text-label text-text-secondary">{t('nav.notif.off')}</p>
  if (items.length === 0) return <p className="px-3 py-4 text-label text-text-secondary">{t('nav.noNotifications')}</p>
  return (
    <ul className="w-72 max-w-[80vw] max-h-96 overflow-y-auto flex flex-col">
      {items.map((n) => (
        <li key={n.id}>
          <button
            role="menuitem"
            onClick={() => {
              close()
              nav(n.to)
            }}
            className="w-full text-start px-3 py-2 rounded-input hover:bg-surface-muted flex items-start gap-2"
          >
            <Icon name={ICON[n.kind]} size={16} className={`mt-1 shrink-0 ${n.kind === 'analysis' ? 'text-green-600' : n.kind === 'failed' ? 'text-critical' : 'text-warning'}`} />
            <span className="flex-1 min-w-0">
              <span className="block text-label">
                {n.kind === 'risk' && n.plot
                  ? t('nav.notif.risk', { plot: n.plot.label, risk: t(`risks.types.${n.plot.latest_top_risk!.type}`), severity: t(`results.severity.${n.plot.latest_top_risk!.severity}`) })
                  : t(n.kind === 'failed' ? 'nav.notif.failed' : 'nav.notif.done', { type: t(`analysis.objectives.${n.analysisType}`) })}
              </span>
              <span className="block text-caption text-text-secondary">{date(n.at)}</span>
            </span>
            {n.at > wasLast && <span className="mt-2 size-2 rounded-pill bg-green-600 shrink-0" aria-label={t('nav.notif.new')} />}
          </button>
        </li>
      ))}
    </ul>
  )
}
