// How a crop's score is built: the five group scores and the reasons behind them.
// All numbers and texts come from the backend.
import { useTranslation } from 'react-i18next'
import { FactorBar } from '../../components/ui/viz'
import { Icon } from '../../components/ui/Icon'
import type { Explanation, GroupScores as Groups } from '../../lib/data/repo'
import { loc } from '../../i18n'

const GROUPS = ['climate', 'water', 'soil', 'fertility', 'rotation'] as const

export function GroupScores({ groups, coverage }: { groups: Groups; coverage: number }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      {GROUPS.map((g) => (
        <FactorBar key={g} label={groups[g] === null ? `${t(`score.groups.${g}`)} · ${t('score.unknown')}` : t(`score.groups.${g}`)} value={groups[g]} />
      ))}
      {coverage < 100 && (
        <p className="text-caption text-text-secondary flex items-start gap-1">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('score.coverage', { pct: Math.round(coverage) })}
        </p>
      )}
    </div>
  )
}

function List({ title, items, icon, tone }: { title: string; items: { ar: string; en: string }[]; icon: 'check' | 'alert' | 'info' | 'ban'; tone: string }) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-label font-semibold mb-1">{title}</p>
      <ul className="flex flex-col gap-1">
        {items.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-label text-text-secondary">
            <Icon name={icon} size={16} className={`mt-0.5 shrink-0 ${tone}`} /> <span className="text-text-primary">{loc(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Explanations({ items, critical }: { items: Explanation[]; critical?: { ar: string; en: string }[] }) {
  const { t } = useTranslation()
  return (
    <>
      <List title={t('score.blocked')} items={critical ?? []} icon="ban" tone="text-critical" />
      <List title={t('score.why')} items={items.filter((e) => e.effect === 'positive')} icon="check" tone="text-green-600" />
      <List title={t('score.less')} items={items.filter((e) => e.effect === 'negative' || e.effect === 'caution')} icon="alert" tone="text-warning" />
      <List title={t('score.missing')} items={items.filter((e) => e.effect === 'unknown')} icon="info" tone="text-text-tertiary" />
    </>
  )
}
