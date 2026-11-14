import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFarmCtx } from '../layout/FarmContext'
import { useAnalyses, useAnalysis, useDeleteAnalysis } from '../hooks/queries'
import { Button, Card, CardTitle, IconButton, Pill, Skeleton } from '../components/ui/primitives'
import { EmptyState, ErrorState } from '../components/ui/states'
import { ConfirmDialog } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { cropName, date, dayMonth } from '../lib/format'
import type { Analysis } from '../lib/types'
import { ScoreBadge } from './Dashboard'

/** Key facts of a completed analysis as label/value rows (used for side-by-side comparison). */
function useSummaryRows() {
  const { t } = useTranslation()
  return (a: Analysis): [string, string][] => {
    const r = a.result
    const rows: [string, string][] = [
      [t('reports.type'), t(`analysis.objectives.${a.analysis_type}`)],
      [t('reports.date'), date(a.created_at)],
      [t('reports.plots'), a.summary?.plots.join('، ') ?? '—'],
    ]
    if (!r) return rows
    for (const p of r.plots ?? []) {
      rows.push([`${p.plot_label} · ${cropName(p.crop)}`, `${p.suitability_score} · ${t(`results.status.${p.suitability_status}`)}`])
      if (a.analysis_type === 'crop_suitability') {
        rows.push([`${p.plot_label} · ${t('results.window')}`, p.recommended_planting_window ? `${dayMonth(p.recommended_planting_window.start)} – ${dayMonth(p.recommended_planting_window.end)}` : '—'])
        for (const [k, v] of Object.entries(p.environmental_scores)) rows.push([`${p.plot_label} · ${t(`results.factor.${k}`)}`, String(v)])
      }
      rows.push([`${p.plot_label} · ${t('results.risks')}`, p.risks.map((x) => `${t(`risks.types.${x.type}`)} (${t(`results.severity.${x.severity}`)})`).join('، ') || '—'])
    }
    for (const rec of r.recommendations ?? []) rows.push([`${rec.plot_label} · ${t('results.recommendedCrops')}`, rec.ranked.slice(0, 3).map((c) => `${cropName(c.crop)} ${c.suitability_score}`).join('، ')])
    for (const c of r.calendar?.rows ?? []) rows.push([`${c.plot_label} · ${cropName(c.crop)}`, c.best_window ? `${dayMonth(c.best_window.start)} – ${dayMonth(c.best_window.end)}` : '—'])
    for (const ro of r.rotation ?? [])
      for (const s of ro.strategies) rows.push([`${ro.plot_label} · ${t(`rotation.keys.${s.key}`)}`, `${s.sequence.map((q) => cropName(q.crop)).join(' / ')} · ${s.scores.water_use}/${s.scores.soil_health}/${s.scores.income_potential}`])
    for (const w of r.water ?? []) rows.push([`${w.plot_label} · ${cropName(w.crop)}`, `ETc ${w.season_total.etc_mm} mm · ${t('results.irrigation')} ${w.season_total.irrigation_mm} mm (${w.season_total.irrigation_m3} m³)`])
    rows.push([t('results.sources'), r.data_sources.join(', ')])
    rows.push([t('results.quality'), t(`results.qualityLevels.${r.data_quality}`)])
    rows.push([t('results.confidence'), t(`results.confidenceLevels.${r.confidence}`)])
    rows.push([t('results.timestamp'), date(r.data_timestamp)])
    rows.push([t('results.model'), r.model_version])
    return rows
  }
}

function Compare({ ids }: { ids: [string, string] }) {
  const { t } = useTranslation()
  const a = useAnalysis(ids[0])
  const b = useAnalysis(ids[1])
  const rowsOf = useSummaryRows()
  if (a.isLoading || b.isLoading) return <Skeleton className="h-48" />
  if (!a.data || !b.data) return <ErrorState error={a.error ?? b.error} />
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {[a.data, b.data].map((x) => (
        <div key={x.id} className="rounded-tile border border-border">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <b className="text-label font-semibold">{t(`analysis.objectives.${x.analysis_type}`)}</b>
            <Link to={`/app/analysis/${x.id}`} className="text-label text-green-600 hover:underline">
              {t('common.view')}
            </Link>
          </div>
          <dl className="divide-y divide-border">
            {rowsOf(x).map(([k, v], i) => (
              <div key={i} className="flex justify-between gap-4 px-4 py-2 text-label">
                <dt className="text-text-secondary">{k}</dt>
                <dd className="font-semibold text-end">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

export default function Reports() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const toast = useToast()
  const { farm } = useFarmCtx()
  const q = useAnalyses(farm?.id)
  const del = useDeleteAnalysis()
  const [picked, setPicked] = useState<string[]>([])
  const [toDelete, setToDelete] = useState<Analysis | null>(null)
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]))

  if (q.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const rows = q.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle action={<span className="text-caption text-text-secondary">{t('reports.pick2')}</span>}>{t('reports.title')}</CardTitle>
        {rows.length === 0 ? (
          <EmptyState icon="file" title={t('reports.empty')} action={<Button icon="plus" onClick={() => nav('/app/analysis/new')}>{t('nav.newAnalysis')}</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label">
              <thead>
                <tr className="text-caption text-text-secondary">
                  <th className="w-10 py-2" />
                  <th className="text-start font-normal py-2">{t('reports.type')}</th>
                  <th className="text-start font-normal py-2">{t('reports.date')}</th>
                  <th className="text-start font-normal py-2">{t('reports.plots')}</th>
                  <th className="text-start font-normal py-2">{t('dashboard.crop')}</th>
                  <th className="text-start font-normal py-2">{t('reports.status')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={`border-t border-border ${picked.includes(a.id) ? 'bg-green-50' : 'hover:bg-surface-muted'}`}>
                    <td className="py-3 text-center">
                      <input type="checkbox" className="size-4 accent-[#24753F]" aria-label={t('common.compare')} disabled={a.status !== 'completed'} checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />
                    </td>
                    <td className="py-3 font-semibold">{t(`analysis.objectives.${a.analysis_type}`)}</td>
                    <td className="py-3 whitespace-nowrap">{date(a.created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="py-3">{a.summary?.plots.join('، ')}</td>
                    <td className="py-3">{a.summary?.crop ? cropName(a.summary.crop) : '—'}</td>
                    <td className="py-3">
                      {a.status === 'completed' && a.summary?.headline_score != null ? (
                        <ScoreBadge score={a.summary.headline_score} />
                      ) : (
                        <Pill tone={a.status === 'completed' ? 'green' : a.status === 'failed' ? 'critical' : 'neutral'} icon={a.status === 'completed' ? 'check' : a.status === 'failed' ? 'alert' : 'rotate'}>
                          {t(`reports.statuses.${a.status}`)}
                        </Pill>
                      )}
                    </td>
                    <td className="py-3">
                      <span className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => nav(`/app/analysis/${a.id}`)}>
                          {t('common.view')}
                        </Button>
                        <IconButton icon="download" size={32} label={t('results.exportPdf')} disabled={a.status !== 'completed'} onClick={() => nav(`/app/analysis/${a.id}?print=1`)} />
                        <IconButton icon="trash" size={32} label={t('common.delete')} onClick={() => setToDelete(a)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {picked.length === 2 && (
        <Card>
          <CardTitle action={<Button size="sm" variant="ghost" onClick={() => setPicked([])}>{t('common.clear')}</Button>}>{t('reports.comparison')}</CardTitle>
          <Compare ids={picked as [string, string]} />
        </Card>
      )}

      {toDelete && (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('reports.deleteBody')}
          confirmLabel={t('common.delete')}
          danger
          busy={del.isPending}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              await del.mutateAsync(toDelete.id)
              setPicked((p) => p.filter((x) => x !== toDelete.id))
              toast(t('reports.deleted'))
            } catch {
              toast(t('parcels.saveFailed'), 'error')
            }
            setToDelete(null)
          }}
        />
      )}
    </div>
  )
}
