import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GeoJSON, Marker, Polyline, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import { JordanMap, FitGeometry } from '../../components/map/JordanMap'
import { HatchDefs } from '../../components/map/HatchDefs'
import { Button, Card, IconButton, Input, Select, Stepper, cx } from '../../components/ui/primitives'
import { Banner } from '../../components/ui/states'
import { Icon } from '../../components/ui/Icon'
import {
  areAdjacent,
  canSplit,
  computePlots,
  createLayout,
  gridForCellSize,
  isLayout,
  mergeGroups,
  moveDivider,
  normalize,
  setGrid,
  splitGroup,
  toLonLat,
  toggleExclude,
  tooSmall,
  type BBox,
  type ComputedPlot,
  type Layout,
} from '../../lib/plotGrid'
import { area as fmtArea, num, areaValue, getAreaUnit } from '../../lib/format'
import type { PlotInput } from '../../lib/types'

const SHADES = ['#7FC190', '#4FA867', '#B0D9BB', '#2F8F4E', '#D7ECDC']
const CELL_PRESETS = [0.5, 1, 2, 5, 10, 20]

function handleIcon(axis: 'x' | 'y') {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:#24753F;border:2px solid #fff;display:flex;align-items:center;justify-content:center;cursor:${axis === 'x' ? 'ew-resize' : 'ns-resize'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" style="transform:rotate(${axis === 'x' ? 0 : 90}deg)"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

export function StepPlots({
  boundary,
  initialLayout,
  saving,
  onBack,
  onSave,
}: {
  boundary: Polygon
  initialLayout: unknown
  saving: boolean
  onBack: () => void
  onSave: (plots: PlotInput[], layout: Layout) => Promise<void>
}) {
  const { t } = useTranslation()
  const feature = useMemo(() => turf.polygon(boundary.coordinates) as Feature<Polygon>, [boundary])
  const bbox = useMemo(() => turf.bbox(feature) as BBox, [feature])
  const farmArea = useMemo(() => turf.area(feature), [feature])
  const defaultLayout = useMemo(() => {
    const { rows, cols } = gridForCellSize(feature, Math.max(1, Math.round(farmArea / 1000 / 6)))
    return createLayout(rows, cols)
  }, [feature, farmArea])

  const [layout, setLayout] = useState<Layout>(() => (isLayout(initialLayout) ? normalize(initialLayout) : defaultLayout))
  const [past, setPast] = useState<Layout[]>([])
  const [future, setFuture] = useState<Layout[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [dragLayout, setDragLayout] = useState<Layout | null>(null)
  const dragStart = useRef<Layout | null>(null)

  const live = dragLayout ?? layout
  const plots = useMemo(() => computePlots(live, feature), [live, feature])
  const small = tooSmall(plots)
  const totalArea = plots.reduce((s, p) => s + p.area_m2, 0)
  const farmedArea = plots.filter((p) => !p.excluded).reduce((s, p) => s + p.area_m2, 0)
  const rows = layout.ys.length + 1
  const cols = layout.xs.length + 1
  const unit = getAreaUnit()

  const commit = (next: Layout, keepSelection = false) => {
    setPast((p) => [...p.slice(-60), layout])
    setFuture([])
    setLayout(next)
    if (!keepSelection) setSelected([])
    setErr(null)
  }
  const undo = () => {
    const prev = past[past.length - 1]
    if (!prev) return
    setFuture((f) => [layout, ...f])
    setPast((p) => p.slice(0, -1))
    setLayout(prev)
    setSelected([])
  }
  const redo = () => {
    const nxt = future[0]
    if (!nxt) return
    setPast((p) => [...p, layout])
    setFuture((f) => f.slice(1))
    setLayout(nxt)
    setSelected([])
  }

  const onPlotClick = (gi: number, shift: boolean) => {
    setErr(null)
    setSelected((s) => (shift ? (s.includes(gi) ? s.filter((x) => x !== gi) : [...s, gi]) : s.length === 1 && s[0] === gi ? [] : [gi]))
  }

  const single = selected.length === 1 ? selected[0] : null
  const canMerge = selected.length >= 2 && areAdjacent(layout, selected)
  const selectedExcluded = single !== null && layout.groups[single]?.excluded

  const save = async () => {
    if (small.length) return setErr(t('setup.plots.tooSmallPlots', { labels: small.join('، ') }))
    if (plots.filter((p) => !p.excluded).length === 0) return setErr(t('states.validation'))
    try {
      await onSave(
        plots.map((p) => ({ label: p.label, name: p.name, polygon: p.geometry, excluded: p.excluded, exclusion_reason: p.reason })),
        // store names by group so they survive re-editing
        { ...layout, groups: layout.groups.map((g, gi) => ({ ...g, name: plots.find((p) => p.groupIndex === gi)?.name })) },
      )
    } catch (e) {
      setErr((e as Error).message || t('states.errorBody'))
    }
  }

  // Divider geometry (lat/lon)
  const [w, s, e, n] = bbox
  const xLines = live.xs.map((x) => {
    const [lon] = toLonLat(bbox, x, 0)
    return { pos: [[n, lon], [s, lon]] as [number, number][], handle: [n, lon] as [number, number] }
  })
  const yLines = live.ys.map((y) => {
    const [, lat] = toLonLat(bbox, 0, y)
    return { pos: [[lat, w], [lat, e]] as [number, number][], handle: [lat, w] as [number, number] }
  })

  const dragged = (axis: 'x' | 'y', i: number, ll: L.LatLng) => {
    const base = dragStart.current ?? layout
    const v = axis === 'x' ? (ll.lng - w) / (e - w) : (n - ll.lat) / (n - s)
    return moveDivider(base, axis, i, v)
  }
  const drag = (axis: 'x' | 'y', i: number, ll: L.LatLng) => setDragLayout(dragged(axis, i, ll))
  const endDrag = (axis: 'x' | 'y', i: number, ll: L.LatLng) => {
    const final = dragged(axis, i, ll)
    dragStart.current = null
    setDragLayout(null)
    commit(final, true)
  }

  const plotStyle = (p: ComputedPlot, i: number): L.PathOptions => {
    const sel = selected.includes(p.groupIndex)
    if (p.excluded) return { color: sel ? '#24753F' : '#FFFFFF', weight: sel ? 3 : 1.5, fillColor: 'url(#hatch)', fillOpacity: 0.9 }
    return { color: sel ? '#24753F' : '#FFFFFF', weight: sel ? 3.5 : 1.5, fillColor: SHADES[i % SHADES.length], fillOpacity: sel ? 0.75 : 0.55 }
  }

  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      <div className="col-span-8 flex flex-col gap-3 min-h-0">
        {/* Toolbar */}
        <Card className="!p-3 flex flex-wrap items-center gap-3">
          <Stepper label={t('setup.plots.rows')} value={rows} min={1} max={20} onChange={(v) => commit(setGrid(v, cols))} />
          <Stepper label={t('setup.plots.cols')} value={cols} min={1} max={20} onChange={(v) => commit(setGrid(rows, v))} />
          <label className="flex items-center gap-2 text-label text-text-secondary">
            {t('setup.plots.cellSize')}
            <Select
              className="!h-9 !w-28 !text-label"
              value=""
              onChange={(ev) => {
                const v = parseFloat(ev.target.value)
                if (!v) return
                const g = gridForCellSize(feature, v)
                commit(setGrid(g.rows, g.cols))
              }}
            >
              <option value="">{t('setup.plots.auto')}</option>
              {CELL_PRESETS.map((c) => (
                <option key={c} value={c}>
                  {c} {t('units.dunum')}
                </option>
              ))}
            </Select>
          </label>
          <span className="w-px h-8 bg-border mx-1" aria-hidden />
          <IconButton icon="splitH" label={t('setup.plots.splitH')} disabled={single === null || !canSplit(layout, single)} onClick={() => single !== null && commit(splitGroup(layout, single, 'h'))} />
          <IconButton icon="splitV" label={t('setup.plots.splitV')} disabled={single === null || !canSplit(layout, single)} onClick={() => single !== null && commit(splitGroup(layout, single, 'v'))} />
          <IconButton icon="merge" label={t('setup.plots.merge')} disabled={!canMerge} onClick={() => commit(mergeGroups(layout, selected))} />
          <IconButton
            icon="ban"
            label={selectedExcluded ? t('setup.plots.include') : t('setup.plots.exclude')}
            active={!!selectedExcluded}
            disabled={single === null}
            onClick={() => single !== null && commit(toggleExclude(layout, single, 'other'), true)}
          />
          <span className="w-px h-8 bg-border mx-1" aria-hidden />
          <IconButton icon="undo" label={t('common.undo')} disabled={!past.length} onClick={undo} />
          <IconButton icon="redo" label={t('common.redo')} disabled={!future.length} onClick={redo} />
          <Button variant="ghost" size="sm" icon="rotate" onClick={() => commit(defaultLayout)}>
            {t('common.reset')}
          </Button>
        </Card>

        <div className="flex-1 rounded-card overflow-hidden relative min-h-[420px]">
          <JordanMap center={[(s + n) / 2, (w + e) / 2]} zoom={17}>
            <FitGeometry geometry={boundary} padding={50} maxZoom={19} />
            <HatchDefs />
            {plots.map((p, i) => (
              <GeoJSON
                key={`${p.groupIndex}-${p.label}-${p.area_m2.toFixed(2)}-${p.excluded}-${selected.includes(p.groupIndex)}-${i}`}
                data={p.geometry}
                style={() => plotStyle(p, i)}
                eventHandlers={{ click: (ev) => onPlotClick(p.groupIndex, (ev.originalEvent as MouseEvent).shiftKey) }}
              >
                <Tooltip permanent direction="center" className="plot-label" interactive={false}>
                  <span dir="ltr">
                    <b>{p.label}</b> · {num(areaValue(p.area_m2, unit), 2)}
                  </span>
                </Tooltip>
              </GeoJSON>
            ))}
            {xLines.map((l, i) => (
              <Polyline key={`x${i}`} positions={l.pos} pathOptions={{ color: '#FFFFFF', weight: 1, dashArray: '4 4', opacity: 0.8 }} interactive={false} />
            ))}
            {yLines.map((l, i) => (
              <Polyline key={`y${i}`} positions={l.pos} pathOptions={{ color: '#FFFFFF', weight: 1, dashArray: '4 4', opacity: 0.8 }} interactive={false} />
            ))}
            {xLines.map((l, i) => (
              <Marker
                key={`hx${i}-${layout.xs[i]}`}
                position={l.handle}
                icon={handleIcon('x')}
                draggable
                title={t('setup.plots.cols')}
                eventHandlers={{
                  dragstart: () => (dragStart.current = layout),
                  drag: (ev) => drag('x', i, (ev.target as L.Marker).getLatLng()),
                  dragend: (ev) => endDrag('x', i, (ev.target as L.Marker).getLatLng()),
                }}
              />
            ))}
            {yLines.map((l, i) => (
              <Marker
                key={`hy${i}-${layout.ys[i]}`}
                position={l.handle}
                icon={handleIcon('y')}
                draggable
                title={t('setup.plots.rows')}
                eventHandlers={{
                  dragstart: () => (dragStart.current = layout),
                  drag: (ev) => drag('y', i, (ev.target as L.Marker).getLatLng()),
                  dragend: (ev) => endDrag('y', i, (ev.target as L.Marker).getLatLng()),
                }}
              />
            ))}
          </JordanMap>
          <div className="absolute bottom-6 inset-x-0 z-[1000] flex justify-center pointer-events-none">
            <span className="bg-surface/95 rounded-pill px-4 py-2 text-label shadow-soft">{selected.length >= 2 && !canMerge ? t('setup.plots.notAdjacent') : selected.length ? t('setup.plots.mergeHint') : t('setup.plots.selectHint')}</span>
          </div>
        </div>
      </div>

      <div className="col-span-4 flex flex-col gap-4 min-h-0">
        <Card className="flex flex-col gap-4 min-h-0 flex-1">
          <div>
            <h2 className="text-h1 font-semibold">{t('setup.plots.title')}</h2>
            <p className="text-label text-text-secondary mt-1">{t('setup.plots.body')}</p>
          </div>
          <div className="flex-1 overflow-y-auto -mx-2 px-2">
            <table className="w-full text-label">
              <thead>
                <tr className="text-text-secondary text-caption">
                  <th className="text-start font-normal py-2 w-12">#</th>
                  <th className="text-start font-normal py-2">{t('setup.plots.name')}</th>
                  <th className="text-end font-normal py-2">{t('setup.plots.area')}</th>
                </tr>
              </thead>
              <tbody>
                {plots.map((p) => {
                  const sel = selected.includes(p.groupIndex)
                  const isSmall = small.includes(p.label)
                  return (
                    <tr key={p.groupIndex} className={cx('border-t border-border', sel && 'bg-green-50')}>
                      <td className="py-2">
                        <button onClick={(ev) => onPlotClick(p.groupIndex, ev.shiftKey)} className={cx('h-7 min-w-9 px-2 rounded-pill text-caption font-semibold', sel ? 'bg-green-600 text-white' : 'bg-surface-muted')} aria-pressed={sel}>
                          {p.label}
                        </button>
                      </td>
                      <td className="py-2 pe-2">
                        {p.excluded ? (
                          <div className="flex items-center gap-2">
                            <Icon name="ban" size={16} className="text-text-tertiary" />
                            <Select
                              aria-label={t('setup.plots.exclusionReason')}
                              className="!h-8 !text-caption !px-2"
                              value={p.reason || 'other'}
                              onChange={(ev) => commit({ ...layout, groups: layout.groups.map((g, gi) => (gi === p.groupIndex ? { ...g, reason: ev.target.value } : g)) }, true)}
                            >
                              {(['house', 'road', 'well', 'other'] as const).map((r) => (
                                <option key={r} value={r}>
                                  {t(`setup.plots.reasons.${r}`)}
                                </option>
                              ))}
                            </Select>
                          </div>
                        ) : (
                          <Input
                            aria-label={`${t('setup.plots.name')} ${p.label}`}
                            className="!h-8 !text-label !px-3"
                            value={p.name}
                            onChange={(ev) => setLayout({ ...layout, groups: layout.groups.map((g, gi) => (gi === p.groupIndex ? { ...g, name: ev.target.value } : g)) })}
                          />
                        )}
                      </td>
                      <td className={cx('py-2 text-end tabular-nums whitespace-nowrap', isSmall && 'text-critical font-semibold')}>
                        {isSmall && <Icon name="alert" size={14} className="inline me-1" />}
                        {fmtArea(p.area_m2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-3" colSpan={2}>
                    {t('setup.plots.total')} ({plots.length})
                  </td>
                  <td className="py-3 text-end tabular-nums">{fmtArea(totalArea)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-caption text-text-secondary">
            {t('setup.plots.minSize')} · {t('farm.area')}: {fmtArea(farmArea)} · {t('setup.plots.excluded')}: {fmtArea(totalArea - farmedArea)}
          </p>
          {small.length > 0 && <Banner icon="alert" tone="warning">{t('setup.plots.tooSmallPlots', { labels: small.join('، ') })}</Banner>}
          {err && <Banner icon="alert" tone="critical">{err}</Banner>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onBack} icon="arrowLeft" className="rtl:[&_svg]:-scale-x-100">
              {t('common.back')}
            </Button>
            <Button className="flex-1" onClick={save} loading={saving} disabled={small.length > 0}>
              {t('common.continue')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
