// Result views for every analysis type. Pure presentation: all numbers and texts come from the result object.
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, CardTitle, Chip, Pill, cx } from '../../components/ui/primitives'
import { Banner, DataFooter, DemoBadge, EmptyState } from '../../components/ui/states'
import { Drops, FactorBar, Gauge, WindowBar } from '../../components/ui/viz'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { CropIcon } from '../../components/crops/CropIcon'
import { FarmMiniMap } from '../../components/map/FarmMiniMap'
import { loc } from '../../i18n'
import { cropName, dayMonth, monthName, num, scoreFill, scoreTone, listSep } from '../../lib/format'
import type { AnalysisResult, Bi, Evidence, Farm, Plot, PlotSuitability, RankedCrop, RequirementMatch, Risk, RotationStrategy } from '../../lib/types'

const RISK_ICON: Record<string, IconName> = { frost: 'snow', heat_stress: 'thermo', drought: 'sun', dry_spell: 'sun', excessive_rainfall: 'cloudRain', low_soil_moisture: 'drop' }
const SEV_TONE = { high: 'critical', moderate: 'warning', low: 'neutral' } as const
const FACTOR_ICON: Record<string, IconName> = { temperature: 'thermo', soil_moisture: 'drop', precipitation: 'cloudRain', solar_radiation: 'sun' }

export function StatusPill({ score, status }: { score: number; status: string }) {
  const { t } = useTranslation()
  const tone = scoreTone(score)
  return (
    <Pill tone={tone === 'green' ? 'green' : tone} icon={tone === 'green' ? 'check' : 'alert'}>
      {t(`results.status.${status}`)}
    </Pill>
  )
}

/** Banners + provenance that every result must show. */
export function ResultFrame({ result, children, multiPlot }: { result: AnalysisResult; children: ReactNode; multiPlot?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {result.is_demo && (
          <div>
            <DemoBadge />
          </div>
        )}
        {result.engine_fallback && <Banner icon="alert" tone="warning">{t('results.engineFallback')}</Banner>}
      </div>
      {children}
      <Card className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('results.dataFooter')}</h2>
        <DataFooter meta={result} />
        {multiPlot !== false && (
          <p className="text-caption text-text-secondary flex items-start gap-1">
            <Icon name="satellite" size={14} className="mt-0.5 shrink-0" /> {t('results.sharedCell')}
          </p>
        )}
        <p className="text-caption text-text-secondary flex items-start gap-1">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('results.disclaimer')}
        </p>
      </Card>
    </div>
  )
}

export function PlotSwitcher({ farm, plots, ids, labels, value, onChange }: { farm: Farm; plots: Plot[]; ids: string[]; labels: Record<string, string>; value: string; onChange: (id: string) => void }) {
  if (ids.length < 2) return null
  const shown = plots.filter((p) => ids.includes(p.id))
  return (
    <Card className="flex flex-col lg:flex-row gap-4 items-stretch">
      <div className="flex flex-wrap gap-2 content-start flex-1" role="tablist">
        {ids.map((id) => (
          <Chip key={id} selected={id === value} onClick={() => onChange(id)} role="tab" aria-selected={id === value}>
            {labels[id]}
          </Chip>
        ))}
      </div>
      {shown.length > 0 && <FarmMiniMap farm={farm} plots={shown} picked={[value]} onPick={onChange} className="h-36 lg:w-80" />}
    </Card>
  )
}

export function RiskChips({ risks }: { risks: Risk[] }) {
  const { t } = useTranslation()
  if (!risks.length)
    return (
      <p className="text-label text-text-secondary flex items-center gap-2">
        <Icon name="check" size={16} className="text-green-600" /> {t('risks.none')}
      </p>
    )
  return (
    <ul className="flex flex-col gap-3">
      {risks.map((r) => (
        <li key={r.type} className="rounded-tile border border-border p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Pill tone={SEV_TONE[r.severity]} icon={RISK_ICON[r.type] ?? 'alert'}>
              {t(`risks.types.${r.type}`)} · {t(`results.severity.${r.severity}`)}
            </Pill>
            {r.period && <span className="text-caption text-text-secondary">{loc(r.period)}</span>}
            {r.affected_plots && <span className="text-caption text-text-secondary">· {t('risks.affected')}: {r.affected_plots.join(listSep())}</span>}
          </div>
          <p className="text-label">{loc(r.explanation)}</p>
          <p className="text-label text-text-secondary mt-2 flex items-start gap-2">
            <Icon name="check" size={16} className="text-green-600 mt-0.5 shrink-0" /> {loc(r.action)}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <dl className="divide-y divide-border">
      {items
        .filter((e) => e.value !== null)
        .map((e) => (
          <div key={e.metric} className="flex justify-between gap-3 py-2 text-caption">
            <dt className="text-text-secondary">{loc(e.label) || e.metric}</dt>
            <dd className="text-end">
              <b className="font-semibold tabular-nums" dir="ltr">
                {typeof e.value === 'number' ? num(e.value, 1) : e.value} {e.unit}
              </b>
              <span className="block text-text-tertiary" dir="ltr">
                {e.source} · {e.period}
              </span>
            </dd>
          </div>
        ))}
    </dl>
  )
}

export function RequirementsTable({ rows }: { rows: RequirementMatch[] }) {
  const { t } = useTranslation()
  const tone = { match: 'green', partial: 'warning', mismatch: 'critical', unknown: 'outline' } as const
  const icon = { match: 'check', partial: 'info', mismatch: 'x', unknown: 'info' } as const
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-label">
        <thead>
          <tr className="text-caption text-text-secondary">
            <th className="text-start font-normal py-2">{t('results.requirements')}</th>
            <th className="text-start font-normal py-2">{t('results.required')}</th>
            <th className="text-start font-normal py-2">{t('results.observed')}</th>
            <th className="text-start font-normal py-2" />
            <th className="text-start font-normal py-2">{t('results.source')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border align-top">
              <td className="py-2 pe-3">{loc(r.label)}</td>
              <td className="py-2 pe-3 tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>{r.required}</td>
              <td className="py-2 pe-3">
                <span className="tabular-nums" dir="ltr">{r.observed}</span>
                {r.observed_source && <span className="block text-caption text-green-700">{loc(r.observed_source)}</span>}
              </td>
              <td className="py-2 pe-3">
                <Pill tone={tone[r.status]} icon={icon[r.status]}>{t(`results.match.${r.status}`)}</Pill>
              </td>
              <td className="py-2 text-caption text-text-secondary" dir="ltr" style={{ textAlign: 'start' }}>
                {r.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------- Suitability ----------------

export function SuitabilityView({ result, farm, plots }: { result: AnalysisResult; farm: Farm; plots: Plot[] }) {
  const { t } = useTranslation()
  const list = result.plots ?? []
  const [pid, setPid] = useState(list[0]?.plot_id)
  const p: PlotSuitability | undefined = list.find((x) => x.plot_id === pid) ?? list[0]
  if (!p) return <EmptyState title={t('states.missingData')} />
  const months = Array.from({ length: 12 }, (_, i) => monthName(i + 1, true))
  const w = p.recommended_planting_window
  return (
    <ResultFrame result={result}>
      <PlotSwitcher farm={farm} plots={plots} ids={list.map((x) => x.plot_id)} labels={Object.fromEntries(list.map((x) => [x.plot_id, x.plot_label]))} value={p.plot_id} onChange={setPid} />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 flex flex-col gap-6">
          <Card className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3 self-start">
                <CropIcon crop={p.crop} size={48} />
                <div>
                  <p className="text-h2 font-semibold">{cropName(p.crop)}</p>
                  <p className="text-caption text-text-secondary">
                    {t('common.plot')} {p.plot_label} {p.plot_name && `· ${p.plot_name}`}
                  </p>
                </div>
              </div>
              <Gauge value={p.suitability_score} label={t('results.suitability')} />
              <StatusPill score={p.suitability_score} status={p.suitability_status} />
            </div>
            <div className="flex flex-col gap-5">
              <h3 className="text-h2 font-semibold">{t('results.factors')}</h3>
              {(['temperature', 'soil_moisture', 'precipitation', 'solar_radiation'] as const).map((k) => (
                <FactorBar key={k} label={t(`results.factor.${k}`)} value={p.environmental_scores[k] ?? null} icon={<Icon name={FACTOR_ICON[k]} size={16} />} />
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle action={w ? <Pill tone="green" icon="calendar">{dayMonth(w.start)} – {dayMonth(w.end)}</Pill> : <Pill tone="outline">{t('results.noWindow')}</Pill>}>{t('results.window')}</CardTitle>
            <WindowBar start={w?.start ?? null} end={w?.end ?? null} months={months} />
            <div className="mt-4">
              <ScoreStrip scores={p.period_scores.map((s) => s.score)} />
            </div>
            <p className="text-caption text-text-tertiary mt-3 flex items-center gap-1">
              <Icon name="info" size={14} /> {t('results.climatology')}
            </p>
          </Card>

          <Card>
            <CardTitle>{t('results.risks')}</CardTitle>
            <RiskChips risks={p.risks} />
          </Card>

          <Card>
            <CardTitle>{t('results.actions')}</CardTitle>
            <ol className="flex flex-col gap-3">
              {p.recommended_actions.map((a, i) => (
                <li key={i} className="flex items-start gap-3 text-label">
                  <span className="size-6 rounded-pill bg-green-50 text-green-700 text-caption font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                  {loc(a)}
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardTitle>{t('results.cropDetails')}</CardTitle>
            <RequirementsTable rows={p.requirements} />
          </Card>
        </div>

        <aside className="xl:col-span-4 flex flex-col gap-6">
          <Card>
            <CardTitle>{t('results.why')}</CardTitle>
            <p className="text-label leading-6">{loc(p.explanation)}</p>
            <h3 className="text-label font-semibold mt-5 mb-1">{t('results.evidence')}</h3>
            <EvidenceList items={p.evidence} />
          </Card>
          <Card>
            <CardTitle>{t('results.alternatives')}</CardTitle>
            <ul className="flex flex-col gap-2">
              {p.alternative_crops.map((a) => (
                <li key={a.crop} className="flex items-center gap-3 rounded-tile bg-surface-muted p-3">
                  <CropIcon crop={a.crop} size={36} />
                  <span className="flex-1 text-label">{cropName(a.crop)}</span>
                  <b className="text-body font-semibold tabular-nums">{a.suitability_score}</b>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </ResultFrame>
  )
}

/** 36 ten-day cells tinted by score (green shades only). */
function ScoreStrip({ scores, highlight }: { scores: number[]; highlight?: [number, number] | null }) {
  return (
    <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${scores.length}, minmax(0, 1fr))`, direction: 'ltr' }}>
      {scores.map((s, i) => {
        const inWin = highlight ? (highlight[0] <= highlight[1] ? i >= highlight[0] && i <= highlight[1] : i >= highlight[0] || i <= highlight[1]) : false
        return <span key={i} title={String(s)} className={cx('h-6 rounded-[4px]', inWin && 'outline outline-2 outline-green-700 -outline-offset-1')} style={{ background: scoreFill(s), border: '1px solid #E2E2DE' }} />
      })}
    </div>
  )
}

// ---------------- Recommended crops + Crop details ----------------

export function RecommendationView({ result, farm, plots }: { result: AnalysisResult; farm: Farm; plots: Plot[] }) {
  const { t } = useTranslation()
  const recs = result.recommendations ?? []
  const [pid, setPid] = useState(recs[0]?.plot_id)
  const [open, setOpen] = useState<RankedCrop | null>(null)
  const rec = recs.find((r) => r.plot_id === pid) ?? recs[0]
  if (!rec) return <EmptyState title={t('states.missingData')} />
  return (
    <ResultFrame result={result}>
      <PlotSwitcher farm={farm} plots={plots} ids={recs.map((r) => r.plot_id)} labels={Object.fromEntries(recs.map((r) => [r.plot_id, r.plot_label]))} value={rec.plot_id} onChange={setPid} />
      <div>
        <h2 className="text-h1 font-semibold mb-4">
          {t('results.recommendedCrops')} · {t('common.plot')} {rec.plot_label}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {rec.ranked.map((c, i) => (
            <button key={c.crop} onClick={() => setOpen(c)} className="text-start bg-surface rounded-card p-6 shadow-soft flex flex-col gap-4 border border-transparent hover:border-green-600 transition-colors">
              <div className="flex items-center gap-3">
                <CropIcon crop={c.crop} size={48} />
                <div className="flex-1 min-w-0">
                  <p className="text-h2 font-semibold truncate">{cropName(c.crop)}</p>
                  <StatusPill score={c.suitability_score} status={c.suitability_status} />
                </div>
                <div className="text-end">
                  <p className="text-metric font-light tabular-nums leading-none">{c.suitability_score}</p>
                  <p className="text-caption text-text-secondary">#{i + 1}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-label">
                <span className="flex items-center gap-2 text-text-secondary">
                  <Icon name="calendar" size={16} />
                  {c.planting_window ? `${dayMonth(c.planting_window.start)} – ${dayMonth(c.planting_window.end)}` : t('results.yearRound')}
                </span>
                <Drops level={c.water_demand} />
              </div>
              <p className="text-label text-text-secondary">{loc(c.main_reason)}</p>
            </button>
          ))}
        </div>
      </div>
      {open && (
        <Modal wide title={`${t('results.cropDetails')}: ${cropName(open.crop)}`} onClose={() => setOpen(null)}>
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <CropIcon crop={open.crop} size={56} />
              <div className="flex-1">
                <StatusPill score={open.suitability_score} status={open.suitability_status} />
                <p className="text-label text-text-secondary mt-1">{loc(open.explanation)}</p>
              </div>
              <span className="text-metric font-light tabular-nums">{open.suitability_score}</span>
            </div>
            {open.environmental_scores && (
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(open.environmental_scores).map(([k, v]) => (
                  <FactorBar key={k} label={t(`results.factor.${k}`)} value={v} icon={<Icon name={FACTOR_ICON[k] ?? 'info'} size={16} />} />
                ))}
              </div>
            )}
            {open.requirements && <RequirementsTable rows={open.requirements} />}
          </div>
        </Modal>
      )}
    </ResultFrame>
  )
}

// ---------------- Planting calendar ----------------

export function CalendarView({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const cal = result.calendar
  if (!cal) return <EmptyState title={t('states.missingData')} />
  const months = Array.from({ length: 12 }, (_, i) => monthName(i + 1, true))
  const manyPlots = new Set(cal.rows.map((r) => r.plot_id)).size > 1
  const maxRain = Math.max(...cal.monthly_rainfall_mm.map((m) => m.value), 1)
  const dekadOfIso = (iso: string) => (new Date(iso).getUTCMonth()) * 3 + (new Date(iso).getUTCDate() >= 21 ? 2 : new Date(iso).getUTCDate() >= 11 ? 1 : 0)
  const Row = ({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children: ReactNode }) => (
    <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr] gap-3 sm:gap-4 items-center py-2 border-t border-border">
      <div className="min-w-0">
        <div className="text-label font-semibold truncate flex items-center gap-2">{label}</div>
        {sub && <div className="text-caption text-text-secondary truncate">{sub}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
  const ProbStrip = ({ values, color }: { values: number[]; color: string }) => (
    <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(36, minmax(0, 1fr))', direction: 'ltr' }}>
      {values.map((v, i) => (
        <span key={i} title={`${Math.round(v * 100)}%`} className="h-4 rounded-[4px]" style={{ background: v > 0 ? color : '#F6F6F4', opacity: v > 0 ? 0.25 + v * 0.75 : 1 }} />
      ))}
    </div>
  )
  return (
    <ResultFrame result={result}>
      <Card>
        <CardTitle>{t('results.calendar')}</CardTitle>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr] gap-3 sm:gap-4 pb-2">
              <span />
              <div className="grid grid-cols-12 text-caption text-text-secondary" style={{ direction: 'ltr' }}>
                {months.map((m) => (
                  <span key={m} className="text-center">
                    {m}
                  </span>
                ))}
              </div>
            </div>
            {cal.rows.map((r) => (
              <Row
                key={`${r.plot_id}-${r.crop}`}
                label={
                  <>
                    <CropIcon crop={r.crop} size={28} /> {cropName(r.crop)}
                  </>
                }
                sub={
                  <>
                    {manyPlots && `${r.plot_label.replaceAll('، ', listSep())} · `}
                    {r.best_window ? `${dayMonth(r.best_window.start)} – ${dayMonth(r.best_window.end)}` : t(r.perennial ? 'results.yearRound' : 'results.noWindow')}
                  </>
                }
              >
                <ScoreStrip scores={r.period_scores.map((s) => s.score)} highlight={r.best_window ? [dekadOfIso(r.best_window.start), dekadOfIso(r.best_window.end)] : null} />
              </Row>
            ))}
            <Row label={<><Icon name="snow" size={16} className="text-water" /> {t('results.frost')}</>} sub={t('results.probability')}>
              <ProbStrip values={cal.frost_periods.map((p) => p.probability)} color="#2F7FD1" />
            </Row>
            <Row label={<><Icon name="thermo" size={16} className="text-warning" /> {t('results.heat')}</>} sub={result.heat_threshold_c ? `> ${result.heat_threshold_c}°C · ${t('results.probability')}` : t('results.probability')}>
              <ProbStrip values={cal.heat_periods.map((p) => p.probability)} color="#E8892B" />
            </Row>
            <Row label={<><Icon name="cloudRain" size={16} className="text-water" /> {t('results.rainfall')}</>} sub={t('units.mm')}>
              <div className="grid grid-cols-12 gap-1 items-end h-16" style={{ direction: 'ltr' }}>
                {cal.monthly_rainfall_mm.map((m) => (
                  <div key={m.month} className="flex flex-col items-center justify-end h-full gap-0.5">
                    <span className="text-[10px] text-text-secondary tabular-nums">{Math.round(m.value)}</span>
                    <span className="w-full max-w-8 rounded-t-[4px] bg-water" style={{ height: `${Math.max(2, (m.value / maxRain) * 100)}%`, opacity: 0.8 }} />
                  </div>
                ))}
              </div>
            </Row>
            <Row label={<><Icon name="drop" size={16} className="text-green-600" /> {t('results.soilMoisture')}</>} sub="%">
              <div className="grid grid-cols-12 gap-1" style={{ direction: 'ltr' }}>
                {cal.monthly_soil_moisture.map((m) => (
                  <span key={m.month} className="h-7 rounded-[6px] flex items-center justify-center text-[11px] tabular-nums" style={{ background: m.value === null ? '#F6F6F4' : m.value >= 60 ? '#7FC190' : m.value >= 45 ? '#B0D9BB' : m.value >= 30 ? '#D7ECDC' : '#EEF7F0' }}>
                    {m.value === null ? '—' : Math.round(m.value)}
                  </span>
                ))}
              </div>
            </Row>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-4 text-caption text-text-secondary">
          {[['#2F8F4E', '80+'], ['#7FC190', '60–79'], ['#D7ECDC', '40–59'], ['#EEF7F0', '<40']].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1">
              <span className="size-3 rounded-[3px] border border-border" style={{ background: c }} /> {l}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-[3px] outline outline-2 outline-green-700" /> {t('results.bestWindow')}
          </span>
        </div>
      </Card>
    </ResultFrame>
  )
}

// ---------------- Rotation ----------------

function BiList({ items }: { items: Bi[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((x, i) => (
        <li key={i} className="text-label flex items-start gap-2">
          <span className="size-1.5 rounded-pill bg-green-500 mt-2 shrink-0" /> {loc(x)}
        </li>
      ))}
    </ul>
  )
}

export function StrategyColumn({ s, onApply, applying }: { s: RotationStrategy; onApply?: (s: RotationStrategy) => void; applying?: boolean }) {
  const { t } = useTranslation()
  const Section = ({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) => (
    <section className="border-t border-border pt-4">
      <h4 className="text-label font-semibold flex items-center gap-2 mb-2">
        <Icon name={icon} size={16} className="text-green-600" /> {title}
      </h4>
      {children}
    </section>
  )
  return (
    <Card as="article" className={cx('flex flex-col gap-4', s.key === 'current' ? '' : 'border border-green-200')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-h2 font-semibold">{loc(s.title)}</h3>
        {s.key === 'current' ? <Pill tone="outline">{t('rotation.current')}</Pill> : <Pill tone="green" icon="sprout">{t(`rotation.focus.${s.focus}`)}</Pill>}
      </div>
      <ol className="flex flex-col gap-2">
        {s.sequence.map((q) => (
          <li key={q.season} className="flex items-center gap-3 rounded-tile bg-surface-muted p-3">
            <CropIcon crop={q.crop} size={36} />
            <span className="flex-1 min-w-0">
              <span className="block text-label font-semibold">{cropName(q.crop)}</span>
              <span className="block text-caption text-text-secondary" dir="ltr" style={{ textAlign: 'start' }}>{q.season}</span>
            </span>
            {q.suitability_score !== null && <b className="text-label font-semibold tabular-nums">{q.suitability_score}</b>}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-3">
        <FactorBar label={t('rotation.waterUse')} value={s.scores.water_use} icon={<Icon name="drop" size={16} />} />
        <FactorBar label={t('rotation.soilHealth')} value={s.scores.soil_health} icon={<Icon name="leaf" size={16} />} />
        <FactorBar label={t('rotation.income')} value={s.scores.income_potential} icon={<Icon name="chart" size={16} />} />
      </div>
      <Section icon="info" title={t('rotation.why')}>
        <BiList items={s.why} />
      </Section>
      <Section icon="satellite" title={t('rotation.evidence')}>
        <EvidenceList items={s.evidence} />
      </Section>
      <Section icon="check" title={t('rotation.benefits')}>
        <BiList items={s.benefits} />
      </Section>
      <Section icon="search" title={t('rotation.gaps')}>
        <BiList items={s.information_gaps} />
      </Section>
      <Section icon="alert" title={t('rotation.review')}>
        <BiList items={s.risks_for_review} />
      </Section>
      {onApply && s.key !== 'current' && (
        <Button className="mt-auto" variant="secondary" icon="check" loading={applying} onClick={() => onApply(s)}>
          {t('rotation.apply')}
        </Button>
      )}
    </Card>
  )
}

export function RotationView({ result, farm, plots, onApply, applying }: { result: AnalysisResult; farm: Farm; plots: Plot[]; onApply?: (plotId: string, s: RotationStrategy) => void; applying?: boolean }) {
  const { t } = useTranslation()
  const list = result.rotation ?? []
  const [pid, setPid] = useState(list[0]?.plot_id)
  const cur = list.find((r) => r.plot_id === pid) ?? list[0]
  if (!cur) return <EmptyState title={t('states.missingData')} />
  return (
    <ResultFrame result={result}>
      <PlotSwitcher farm={farm} plots={plots} ids={list.map((r) => r.plot_id)} labels={Object.fromEntries(list.map((r) => [r.plot_id, r.plot_label]))} value={cur.plot_id} onChange={setPid} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h1 font-semibold me-auto">
          {t('rotation.compare')} · {t('common.plot')} {cur.plot_label}
        </h2>
        <Pill tone="outline">{t('analysis.priority')}: {t(`analysis.priorities.${cur.priority}`)}</Pill>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
        {cur.strategies.map((s) => (
          <StrategyColumn key={s.key} s={s} applying={applying} onApply={onApply ? (x) => onApply(cur.plot_id, x) : undefined} />
        ))}
      </div>
    </ResultFrame>
  )
}

// ---------------- Water ----------------

export function WaterView({ result, farm, plots }: { result: AnalysisResult; farm: Farm; plots: Plot[] }) {
  const { t } = useTranslation()
  const list = result.water ?? []
  const [pid, setPid] = useState(list[0]?.plot_id)
  const w = list.find((x) => x.plot_id === pid) ?? list[0]
  if (!w) return <EmptyState title={t('states.missingData')} />
  const data = w.monthly.map((m) => ({ ...m, name: monthName(m.month, true) }))
  const Stat = ({ label, value, unit }: { label: string; value: number; unit: string }) => (
    <div className="bg-surface-muted rounded-tile p-4">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="text-h1 font-light tabular-nums">
        {num(value, 0)} <span className="text-label text-text-secondary">{unit}</span>
      </p>
    </div>
  )
  return (
    <ResultFrame result={result}>
      <PlotSwitcher farm={farm} plots={plots} ids={list.map((x) => x.plot_id)} labels={Object.fromEntries(list.map((x) => [x.plot_id, x.plot_label]))} value={w.plot_id} onChange={setPid} />
      <Card className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <CropIcon crop={w.crop} size={48} />
          <div>
            <h2 className="text-h2 font-semibold">
              {t('results.water')}: {cropName(w.crop)}
            </h2>
            <p className="text-caption text-text-secondary">
              {t('common.plot')} {w.plot_label} · {t(w.irrigation_available ? 'setup.details.irrigation' : 'irrigation.none')}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label={t('results.etc')} value={w.season_total.etc_mm} unit={t('units.mm')} />
          <Stat label={t('results.effRain')} value={w.season_total.effective_rain_mm} unit={t('units.mm')} />
          <Stat label={t('results.irrigation')} value={w.season_total.irrigation_mm} unit={t('units.mm')} />
          <Stat label={`${t('results.irrigation')} (${t('results.seasonTotal')})`} value={w.season_total.irrigation_m3} unit={t('units.m3')} />
        </div>
        <div className="h-[320px]" dir="ltr" role="img" aria-label={t('results.water')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E2E2DE" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B706B' }} tickLine={false} axisLine={{ stroke: '#E2E2DE' }} />
              <YAxis tick={{ fontSize: 12, fill: '#6B706B' }} tickLine={false} axisLine={false} width={40} />
              <Tooltip formatter={(v, n) => [`${num(Number(v), 0)} mm`, String(n)]} contentStyle={{ borderRadius: 12, border: '1px solid #E2E2DE', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="etc_mm" name={t('results.etc')} fill="#2F8F4E" radius={[6, 6, 0, 0]} maxBarSize={22} />
              <Bar dataKey="effective_rain_mm" name={t('results.effRain')} fill="#B0D9BB" radius={[6, 6, 0, 0]} maxBarSize={22} />
              <Bar dataKey="irrigation_mm" name={t('results.irrigation')} fill="#2F7FD1" radius={[6, 6, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-label">{loc(w.explanation)}</p>
      </Card>
    </ResultFrame>
  )
}

// ---------------- Risks ----------------

export function RiskView({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const risks = result.risks ?? []
  return (
    <ResultFrame result={result}>
      <Card>
        <CardTitle>{t('risks.title')}</CardTitle>
        <RiskChips risks={risks} />
      </Card>
      {(result.plots ?? []).length > 0 && (
        <Card>
          <CardTitle>{t('risks.affected')}</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-label">
              <tbody>
                {(result.plots ?? []).map((p) => (
                  <tr key={p.plot_id} className="border-t border-border first:border-0">
                    <td className="py-3 font-semibold w-16">{p.plot_label}</td>
                    <td className="py-3">
                      <span className="flex items-center gap-2">
                        <CropIcon crop={p.crop} size={28} /> {cropName(p.crop)}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="flex flex-wrap gap-1">
                        {p.risks.length === 0 && <span className="text-text-tertiary">—</span>}
                        {p.risks.map((r) => (
                          <Pill key={r.type} tone={SEV_TONE[r.severity]} icon={RISK_ICON[r.type] ?? 'alert'}>
                            {t(`risks.types.${r.type}`)} · {t(`results.severity.${r.severity}`)}
                          </Pill>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </ResultFrame>
  )
}
