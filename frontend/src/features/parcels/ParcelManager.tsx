/**
 * Parcel management: satellite map (main area) + collapsible side panel.
 * Flow for a new parcel: choose method → draw / enter coordinates → data → review → save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Marker } from 'react-leaflet'
import type { Polygon } from 'geojson'
import { FitBounds, FlyTo, JordanMap, MapControls, pinIcon } from '../../components/map/JordanMap'
import { PlaceSearch } from '../../components/map/PlaceSearch'
import { Button, IconButton, Input, Pill, Select, Skeleton, cx } from '../../components/ui/primitives'
import { Banner, EmptyState, ErrorState } from '../../components/ui/states'
import { Icon } from '../../components/ui/Icon'
import { ConfirmDialog } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { CropIcon } from '../../components/crops/CropIcon'
import { useCreatePlot, useDeletePlot, usePlots, useUpdateFarm, useUpdatePlot } from '../../hooks/queries'
import { ApiError } from '../../lib/api'
import { nextLabel } from '../../lib/data/repo'
import { areaM2, boundsOf, formatCoordinates, fromPolygon, insideJordan, parseCoordinates, toPolygon, validateRing, type GeometryIssue, type LatLon } from '../../lib/geometry'
import { area as fmtArea, cropName, meters } from '../../lib/format'
import { CROP_IDS } from '../../lib/places'
import { useSettings } from '../../lib/settings'
import type { Farm, Plot, PlotDraft } from '../../lib/types'
import { DraftLayer } from './DraftLayer'
import { DragShapeLayer } from './DragShapeLayer'
import { ParcelsLayer } from './ParcelsLayer'
import { ParcelForm, ParcelMetrics, STATUSES, type FormErrors } from './ParcelForm'
import { download, emptyDraft, parseGeoJSON, toCSV, toGeoJSON } from './io'

type Tool = 'rect' | 'square' | 'points' | 'pan'
const TOOLS: { id: Tool; icon: 'rect' | 'square' | 'polygon' | 'move' }[] = [
  { id: 'rect', icon: 'rect' },
  { id: 'square', icon: 'square' },
  { id: 'points', icon: 'polygon' },
  { id: 'pan', icon: 'move' },
]
type Mode = 'browse' | 'choose' | 'draw' | 'coords' | 'form' | 'review' | 'reshape' | 'editData'
interface Geo {
  pts: LatLon[]
  closed: boolean
}

export function ParcelManager({ farm, initialPlotId, startAdding }: { farm: Farm; initialPlotId?: string | null; startAdding?: boolean }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const toast = useToast()
  useSettings()
  const plotsQ = usePlots(farm.id)
  const plots = useMemo(() => plotsQ.data ?? [], [plotsQ.data])
  const createPlot = useCreatePlot()
  const updatePlot = useUpdatePlot()
  const deletePlot = useDeletePlot()
  const updateFarm = useUpdateFarm()

  const [mode, setMode] = useState<Mode>(startAdding ? 'choose' : 'browse')
  const [panelOpen, setPanelOpen] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(initialPlotId ?? null)
  const [geo, setGeo] = useState<Geo>({ pts: [], closed: false })
  const committed = useRef<Geo>({ pts: [], closed: false })
  const [undoStack, setUndoStack] = useState<Geo[]>([])
  const [coordsText, setCoordsText] = useState('')
  const [tool, setTool] = useState<Tool>('rect')
  const [draft, setDraft] = useState<PlotDraft | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [query, setQuery] = useState('')
  const [fCrop, setFCrop] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [farmName, setFarmName] = useState(farm.name)
  const [fit, setFit] = useState(0)
  const [fly, setFly] = useState<{ c: [number, number]; z: number; pin?: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => setFarmName(farm.name), [farm.id, farm.name])
  useEffect(() => {
    setFit((n) => n + 1)
  }, [farm.id, plotsQ.isSuccess])

  const selected = plots.find((p) => p.id === selectedId) ?? null
  const geometryMode = mode === 'draw' || mode === 'coords' || mode === 'reshape'
  const draftPolygon: Polygon | null = geo.closed ? toPolygon(geo.pts) : null
  const issues: GeometryIssue[] = geo.pts.length ? (geo.closed ? validateRing(geo.pts) : geo.pts.some(([la, lo]) => !insideJordan(la, lo)) ? ['outside_jordan'] : []) : []
  const geometryOk = geo.closed && issues.length === 0
  const parsed = useMemo(() => parseCoordinates(coordsText), [coordsText])

  // ----- geometry state helpers -----
  const resetGeo = (g: Geo = { pts: [], closed: false }) => {
    committed.current = g
    setGeo(g)
    setUndoStack([])
    setCoordsText(formatCoordinates(g.pts))
  }
  const commitGeo = useCallback((pts: LatLon[], closed: boolean) => {
    setUndoStack((s) => [...s.slice(-80), committed.current])
    committed.current = { pts, closed }
    setGeo({ pts, closed })
    setCoordsText(formatCoordinates(pts))
  }, [])
  const liveGeo = useCallback((pts: LatLon[], closed: boolean) => setGeo({ pts, closed }), [])
  const undo = () => {
    const prev = undoStack[undoStack.length - 1]
    if (!prev) return
    setUndoStack((s) => s.slice(0, -1))
    committed.current = prev
    setGeo(prev)
    setCoordsText(formatCoordinates(prev.pts))
  }
  const onCoordsText = (text: string) => {
    setCoordsText(text)
    // preview the valid lines right away; lines with errors are reported and block saving
    const r = parseCoordinates(text)
    const g = { pts: r.points, closed: r.points.length >= 3 }
    committed.current = g
    setGeo(g)
  }

  // ----- flow -----
  const cancel = () => {
    setMode('browse')
    setDraft(null)
    setErrors({})
    resetGeo()
  }
  const startNew = (m: 'choose' | 'draw' | 'coords') => {
    setSelectedId(null)
    setDraft(null)
    resetGeo()
    setTool('rect')
    setMode(m)
    setPanelOpen(true)
  }
  const toForm = () => {
    if (!geometryOk || !draftPolygon) return
    setDraft((d) => (d ? { ...d, polygon: draftPolygon } : emptyDraft(draftPolygon, nextLabel(plots), plots.length)))
    setMode('form')
  }
  const validateData = (d: PlotDraft, selfId?: string): FormErrors => {
    const e: FormErrors = {}
    if (!d.name.trim()) e.name = t('auth.required')
    if (!d.label.trim()) e.label = t('auth.required')
    else if (plots.some((p) => p.id !== selfId && p.label.trim() === d.label.trim())) e.label = t('parcels.duplicateNumber')
    return e
  }
  const fail = (e: unknown) => {
    const a = e as ApiError
    const msg =
      a.code === 'UNSUPPORTED_LOCATION' ? t('parcels.issues.outside_jordan') : a.code === 'DUPLICATE_LABEL' ? t('parcels.duplicateNumber') : a.code === 'NETWORK_ERROR' ? t('states.serverDownBody') : a.code === 'INVALID_GEOMETRY' && Array.isArray(a.details) && a.details[0] ? t(`parcels.issues.${a.details[0]}`, { defaultValue: t('parcels.saveFailed') }) : t('parcels.saveFailed')
    toast(msg, 'error')
  }
  const saveNew = async () => {
    if (!draft) return
    try {
      const p = await createPlot.mutateAsync({ farmId: farm.id, draft })
      toast(t('parcels.saved'))
      cancel()
      setSelectedId(p.id)
    } catch (e) {
      fail(e)
    }
  }
  const startReshape = (p: Plot) => {
    resetGeo({ pts: fromPolygon(p.polygon), closed: true })
    setMode('reshape')
    setFit((n) => n + 1)
  }
  const saveReshape = async () => {
    if (!selected || !draftPolygon || !geometryOk) return
    try {
      await updatePlot.mutateAsync({ id: selected.id, patch: { polygon: draftPolygon } })
      toast(t('parcels.boundarySaved'))
      setMode('browse')
      resetGeo()
    } catch (e) {
      fail(e)
    }
  }
  const startEditData = (p: Plot) => {
    const { id: _i, farm_id: _f, area_m2: _a, perimeter_m: _p, created_at: _c, updated_at: _u, ...d } = p
    setDraft(d)
    setErrors({})
    setMode('editData')
  }
  const saveData = async () => {
    if (!draft || !selected) return
    const e = validateData(draft, selected.id)
    setErrors(e)
    if (Object.keys(e).length) return
    try {
      const { polygon: _poly, ...patch } = draft
      await updatePlot.mutateAsync({ id: selected.id, patch })
      toast(t('parcels.saved'))
      setMode('browse')
      setDraft(null)
    } catch (err) {
      fail(err)
    }
  }
  const doDelete = async () => {
    if (!selected) return
    try {
      await deletePlot.mutateAsync(selected.id)
      toast(t('parcels.deleted'))
      setSelectedId(null)
    } catch (e) {
      fail(e)
    } finally {
      setConfirmDelete(false)
    }
  }
  const saveFarmName = async () => {
    const name = farmName.trim()
    if (!name) return setFarmName(farm.name)
    if (name === farm.name) return
    try {
      await updateFarm.mutateAsync({ id: farm.id, name })
      toast(t('parcels.farmSaved'))
    } catch (e) {
      fail(e)
    }
  }
  const onImport = async (file: File) => {
    try {
      const { drafts, skipped } = parseGeoJSON(await file.text(), CROP_IDS, parseInt(nextLabel(plots), 10))
      let ok = 0
      for (const d of drafts) {
        try {
          await createPlot.mutateAsync({ farmId: farm.id, draft: d })
          ok++
        } catch {
          /* counted as skipped below */
        }
      }
      const bad = skipped + drafts.length - ok
      toast(t('parcels.imported', { ok, bad }), ok ? 'success' : 'error')
      setFit((n) => n + 1)
    } catch {
      toast(t('parcels.importInvalid'), 'error')
    }
  }

  const select = (id: string) => {
    if (mode !== 'browse') return
    setSelectedId((s) => (s === id ? null : id))
    setPanelOpen(true)
  }

  const filtered = plots.filter((p) => {
    const q = query.trim().toLowerCase()
    if (q && !`${p.name} ${p.label} ${p.region}`.toLowerCase().includes(q)) return false
    if (fCrop && (p.current_crop_id ?? 'fallow') !== fCrop) return false
    if (fStatus && p.status !== fStatus) return false
    return true
  })
  const totalArea = plots.reduce((s, p) => s + p.area_m2, 0)

  const bounds = useMemo(() => {
    if (mode === 'reshape' && selected) return boundsOf([selected.polygon])
    return boundsOf(plots.map((p) => p.polygon))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit])

  const selBounds = selected ? boundsOf([selected.polygon]) : null

  // ----- panel sections -----
  const issueList =
    issues.length > 0 ? (
      <Banner icon="alert" tone="warning">
        <ul className="list-disc ps-4">
          {issues.map((i) => (
            <li key={i}>{t(`parcels.issues.${i}`)}</li>
          ))}
        </ul>
      </Banner>
    ) : null

  const geometryTools = (
    <div className="flex items-center gap-2">
      <IconButton icon="undo" label={t('common.undo')} onClick={undo} disabled={!undoStack.length} size={36} />
      <IconButton icon="trash" label={t('common.clear')} onClick={() => commitGeo([], false)} disabled={!geo.pts.length} size={36} />
      {!geo.closed && geo.pts.length >= 3 && (
        <Button size="sm" variant="secondary" icon="check" onClick={() => commitGeo(geo.pts, true)}>
          {t('parcels.closeShape')}
        </Button>
      )}
    </div>
  )

  const stepTitle = (n: number, label: string) => (
    <div>
      <p className="text-caption text-text-secondary">{t('parcels.step', { n, total: 4 })}</p>
      <h3 className="text-h2 font-semibold">{label}</h3>
    </div>
  )

  let body: React.ReactNode
  if (plotsQ.isLoading) {
    body = (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  } else if (plotsQ.error) {
    body = <ErrorState error={plotsQ.error} onRetry={() => plotsQ.refetch()} />
  } else if (mode === 'choose') {
    body = (
      <div className="flex flex-col gap-4">
        {stepTitle(1, t('parcels.chooseMethod'))}
        {(
          [
            { m: 'draw', icon: 'polygon', title: t('parcels.drawOnMap'), body: t('parcels.drawOnMapBody') },
            { m: 'coords', icon: 'hash', title: t('parcels.enterCoords'), body: t('parcels.enterCoordsBody') },
          ] as const
        ).map((o) => (
          <button key={o.m} onClick={() => setMode(o.m)} className="text-start flex items-start gap-3 rounded-tile border border-border p-4 hover:border-green-600 hover:bg-green-50 transition-colors">
            <span className="size-10 rounded-pill bg-green-50 text-green-700 flex items-center justify-center shrink-0">
              <Icon name={o.icon} size={20} />
            </span>
            <span>
              <span className="block text-body font-semibold">{o.title}</span>
              <span className="block text-label text-text-secondary">{o.body}</span>
            </span>
          </button>
        ))}
        <Button variant="secondary" onClick={cancel}>
          {t('common.cancel')}
        </Button>
      </div>
    )
  } else if (mode === 'draw' || mode === 'coords' || mode === 'reshape') {
    body = (
      <div className="flex flex-col gap-4">
        {mode === 'reshape' ? (
          <div>
            <p className="text-caption text-text-secondary">
              {selected?.label} · {selected?.name}
            </p>
            <h3 className="text-h2 font-semibold">{t('parcels.editBoundary')}</h3>
          </div>
        ) : (
          stepTitle(2, mode === 'draw' ? t('parcels.drawOnMap') : t('parcels.enterCoords'))
        )}
        {mode === 'draw' && !geo.closed && (
          <div role="radiogroup" aria-label={t('parcels.toolsLabel')} className="grid grid-cols-2 gap-2">
            {TOOLS.map((x) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={tool === x.id}
                onClick={() => {
                  if (geo.pts.length && x.id !== tool) commitGeo([], false)
                  setTool(x.id)
                }}
                className={cx('h-11 rounded-tile border flex items-center gap-2 px-3 text-label transition-colors', tool === x.id ? 'border-green-600 bg-green-50 text-green-700 font-semibold' : 'border-border hover:bg-surface-muted')}
              >
                <Icon name={x.icon} size={18} /> {t(`parcels.tools.${x.id}`)}
              </button>
            ))}
          </div>
        )}
        <p className="text-label text-text-secondary">{mode === 'coords' ? t('parcels.coordsHelp') : geo.closed ? t('parcels.reshapeHelp') : t(`parcels.toolHelp.${tool}`)}</p>
        {mode !== 'coords' && geometryTools}
        {(mode === 'coords' || mode === 'reshape') && (
          <div className="flex flex-col gap-1">
            <label htmlFor="coords" className="text-label text-text-secondary">
              {t('parcels.coordsLabel')}
            </label>
            <textarea
              id="coords"
              dir="ltr"
              rows={mode === 'coords' ? 7 : 4}
              spellCheck={false}
              value={coordsText}
              onChange={(e) => onCoordsText(e.target.value)}
              placeholder={'32.556800, 35.846900\n32.557600, 35.846900\n32.557600, 35.848000'}
              className="w-full rounded-input border border-border bg-surface px-3 py-2 text-label font-normal tabular-nums focus:border-green-600 focus:outline-none"
              aria-invalid={parsed.errors.length > 0}
            />
            {parsed.errors.length > 0 && (
              <p role="alert" className="text-caption text-critical">
                {parsed.errors.slice(0, 3).map((e) => t(`parcels.lineError.${e.reason}`, { line: e.line })).join(' · ')}
              </p>
            )}
          </div>
        )}
        <ParcelMetrics polygon={draftPolygon} points={geo.pts.length} />
        {!geo.closed && geo.pts.length > 0 && geo.pts.length < 3 && <p className="text-caption text-text-secondary">{t('parcels.issues.too_few_points')}</p>}
        {issueList}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          {mode === 'reshape' ? (
            <Button className="flex-1" onClick={saveReshape} loading={updatePlot.isPending} disabled={!geometryOk || parsed.errors.length > 0}>
              {t('common.save')}
            </Button>
          ) : (
            <Button className="flex-1" onClick={toForm} disabled={!geometryOk || parsed.errors.length > 0} iconEnd="arrowRight">
              {t('common.next')}
            </Button>
          )}
        </div>
      </div>
    )
  } else if ((mode === 'form' || mode === 'editData') && draft) {
    body = (
      <div className="flex flex-col gap-4">
        {mode === 'form' ? stepTitle(3, t('parcels.dataTitle')) : <h3 className="text-h2 font-semibold">{t('parcels.editData')}</h3>}
        <ParcelForm value={draft} onChange={(p) => setDraft({ ...draft, ...p })} errors={errors} farmName={farm.name} />
        <ParcelMetrics polygon={draft.polygon} />
        <div className="flex gap-2 sticky bottom-0 bg-surface py-2">
          <Button variant="secondary" onClick={mode === 'form' ? () => setMode('draw') : cancel}>
            {mode === 'form' ? t('common.back') : t('common.cancel')}
          </Button>
          {mode === 'form' ? (
            <Button
              className="flex-1"
              iconEnd="arrowRight"
              onClick={() => {
                const e = validateData(draft)
                setErrors(e)
                if (!Object.keys(e).length) setMode('review')
              }}
            >
              {t('parcels.preview')}
            </Button>
          ) : (
            <Button className="flex-1" onClick={saveData} loading={updatePlot.isPending}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </div>
    )
  } else if (mode === 'review' && draft) {
    const rows: [string, string][] = [
      [t('parcels.farmName'), farm.name],
      [t('parcels.name'), draft.name],
      [t('parcels.number'), draft.label],
      [t('parcels.region'), draft.region || '—'],
      [t('parcels.status'), t(`parcels.statuses.${draft.status}`)],
      [t('setup.details.method'), t(`irrigation.${draft.irrigation_available ? draft.irrigation_method ?? 'drip' : 'none'}`)],
      [t('parcels.ownerName'), draft.owner_name || '—'],
      [t('parcels.notes'), draft.notes || '—'],
    ]
    body = (
      <div className="flex flex-col gap-4">
        {stepTitle(4, t('parcels.reviewTitle'))}
        <dl className="rounded-tile border border-border divide-y divide-border">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2 text-label">
              <dt className="text-text-secondary shrink-0">{k}</dt>
              <dd className="font-semibold text-end break-words min-w-0">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 px-4 py-2 text-label items-center">
            <dt className="text-text-secondary">{t('parcels.color')}</dt>
            <dd>
              <span className="inline-block size-5 rounded-pill border border-border" style={{ background: draft.color }} />
            </dd>
          </div>
        </dl>
        <ParcelMetrics polygon={draft.polygon} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMode('form')}>
            {t('common.back')}
          </Button>
          <Button className="flex-1" icon="check" onClick={saveNew} loading={createPlot.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="farm-name" className="text-caption text-text-secondary">
            {t('parcels.farmName')}
          </label>
          <Input id="farm-name" className="!h-10" value={farmName} onChange={(e) => setFarmName(e.target.value)} onBlur={saveFarmName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} maxLength={120} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button className="col-span-2" icon="plus" onClick={() => startNew('choose')}>
            {t('parcels.addNew')}
          </Button>
          <Button variant="secondary" size="sm" icon="polygon" onClick={() => startNew('draw')}>
            {t('parcels.drawOnMapShort')}
          </Button>
          <Button variant="secondary" size="sm" icon="hash" onClick={() => startNew('coords')}>
            {t('parcels.enterCoordsShort')}
          </Button>
        </div>

        {selected && (
          <div className="rounded-tile border border-green-600 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <CropIcon crop={selected.current_crop_id} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-body font-semibold truncate">{selected.name}</p>
                <p className="text-caption text-text-secondary truncate">
                  {t('parcels.number')} {selected.label} · {cropName(selected.current_crop_id)}
                  {selected.region && ` · ${selected.region}`}
                </p>
              </div>
              <IconButton icon="x" label={t('common.close')} size={32} onClick={() => setSelectedId(null)} />
            </div>
            <ParcelMetrics polygon={selected.polygon} />
            {(selected.owner_name || selected.notes) && (
              <p className="text-caption text-text-secondary">
                {selected.owner_name && (
                  <>
                    <Icon name="user" size={12} className="inline" /> {selected.owner_name} {selected.owner_phone && <span dir="ltr">{selected.owner_phone}</span>}
                    <br />
                  </>
                )}
                {selected.notes}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" icon="edit" onClick={() => startEditData(selected)}>
                {t('parcels.editData')}
              </Button>
              <Button size="sm" variant="secondary" icon="polygon" onClick={() => startReshape(selected)}>
                {t('parcels.editBoundary')}
              </Button>
              <Button size="sm" variant="secondary" icon="sprout" onClick={() => nav(`/app/rotation?plot=${selected.id}`)}>
                {t('nav.rotation')}
              </Button>
              <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
                {t('parcels.delete')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Icon name="search" size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('parcels.searchList')}
              aria-label={t('parcels.searchList')}
              className="h-10 w-full rounded-input border border-border bg-surface ps-9 pe-3 text-label placeholder:text-text-tertiary focus:outline-none focus:border-green-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label={t('parcels.cropType')} className="!h-9 !text-caption !px-2" value={fCrop} onChange={(e) => setFCrop(e.target.value)}>
              <option value="">{t('parcels.allCrops')}</option>
              <option value="fallow">{t('crops.fallow')}</option>
              {CROP_IDS.map((c) => (
                <option key={c} value={c}>
                  {t(`crops.${c}`)}
                </option>
              ))}
            </Select>
            <Select aria-label={t('parcels.status')} className="!h-9 !text-caption !px-2" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">{t('parcels.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`parcels.statuses.${s}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {plots.length === 0 ? (
          <EmptyState icon="polygon" title={t('parcels.emptyTitle')} body={t('parcels.emptyBody')} />
        ) : filtered.length === 0 ? (
          <p className="text-label text-text-secondary text-center py-6">{t('parcels.noMatch')}</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label={t('parcels.list')}>
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => select(p.id)}
                  aria-pressed={p.id === selectedId}
                  className={cx('w-full text-start flex items-center gap-3 rounded-tile px-3 py-2 border transition-colors', p.id === selectedId ? 'border-green-600 bg-green-50' : 'border-transparent hover:bg-surface-muted')}
                >
                  <span className="size-4 rounded-pill shrink-0 border border-border" style={{ background: p.color }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold truncate">
                      {p.label} · {p.name}
                    </span>
                    <span className="block text-caption text-text-secondary truncate">
                      {cropName(p.current_crop_id)} · {t(`parcels.statuses.${p.status}`)}
                    </span>
                  </span>
                  <span className="text-label tabular-nums whitespace-nowrap">{fmtArea(p.area_m2)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-tile bg-surface-muted px-4 py-3 flex items-center justify-between">
          <span className="text-label text-text-secondary">
            {t('parcels.totalArea')} ({plots.length})
          </span>
          <span className="text-body font-semibold tabular-nums">{fmtArea(totalArea)}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon="download" disabled={!plots.length} onClick={() => download(`${farm.name}-parcels.csv`, toCSV(farm, plots), 'text/csv;charset=utf-8')}>
            CSV
          </Button>
          <Button size="sm" variant="secondary" icon="download" disabled={!plots.length} onClick={() => download(`${farm.name}-parcels.geojson`, JSON.stringify(toGeoJSON(farm, plots), null, 2), 'application/geo+json')}>
            GeoJSON
          </Button>
          <Button size="sm" variant="secondary" icon="upload" onClick={() => fileRef.current?.click()}>
            {t('parcels.import')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
        </div>
        {farm.is_demo && (
          <Pill tone="warning" icon="info">
            {t('common.demoData')}
          </Pill>
        )}
      </div>
    )
  }

  return (
    <div className="relative h-full flex flex-col-reverse lg:flex-row gap-3 min-h-0">
      {/* Side panel (start side = right in Arabic) */}
      {panelOpen && (
        <aside className="lg:w-[400px] shrink-0 bg-surface rounded-card shadow-soft flex flex-col min-h-0 max-h-[58%] lg:max-h-none" aria-label={t('parcels.title')}>
          <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
            <h2 className="text-h2 font-semibold">{t('parcels.title')}</h2>
            <IconButton icon="panel" label={t('parcels.hidePanel')} size={36} onClick={() => setPanelOpen(false)} />
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-5">{body}</div>
        </aside>
      )}

      {/* Map */}
      <div className={cx('relative flex-1 min-h-[280px] rounded-card overflow-hidden', mode === 'draw' && !geo.closed && tool !== 'pan' && '[&_.leaflet-container]:cursor-crosshair')}>
        <JordanMap center={[farm.centroid.lat, farm.centroid.lon]} zoom={16} showCoords>
          <FitBounds bounds={bounds} token={fit} />
          {mode === 'browse' && selBounds && <FitBounds bounds={selBounds} token={selectedId} maxZoom={18} />}
          {fly && <FlyTo center={fly.c} zoom={fly.z} />}
          {fly?.pin && <Marker position={fly.c} icon={pinIcon()} interactive={false} />}
          <ParcelsLayer plots={plots} selectedId={selectedId} hiddenId={mode === 'reshape' ? selectedId : null} dimOthers={geometryMode} onSelect={mode === 'browse' ? select : undefined} />
          {(geometryMode || mode === 'form' || mode === 'review') && (
            <DraftLayer
              clickToAdd={mode === 'draw' && tool === 'points'}
              moveLabel={t('parcels.moveShape')}
              rotateLabel={t('parcels.rotateShape')}
              points={mode === 'form' || mode === 'review' ? fromPolygon(draft!.polygon) : geo.pts}
              closed={mode === 'form' || mode === 'review' ? true : geo.closed}
              color={draft?.color ?? selected?.color ?? '#4FA867'}
              onChange={geometryMode ? liveGeo : () => {}}
              onCommit={
                geometryMode
                  ? commitGeo
                  : (pts) => {
                      // reshaping during data entry / review keeps area and perimeter in sync
                      const poly = toPolygon(pts)
                      if (poly && draft && validateRing(pts).length === 0) {
                        committed.current = { pts, closed: true }
                        setGeo({ pts, closed: true })
                        setDraft({ ...draft, polygon: poly })
                      }
                    }
              }
            />
          )}
          {mode === 'draw' && !geo.closed && (tool === 'rect' || tool === 'square') && (
            <DragShapeLayer square={tool === 'square'} color={draft?.color ?? '#4FA867'} onDone={(pts) => commitGeo(pts, true)} onTooSmall={() => toast(t('parcels.dragTooSmall'), 'info')} />
          )}
          <MapControls
            onFit={() => setFit((n) => n + 1)}
            onLocated={(lat, lon, found) => {
              if (!insideJordan(lat, lon)) return toast(t('states.unsupportedLocationBody'), 'error')
              const exact = found.source === 'device'
              setFly({ c: [lat, lon], z: exact ? 17 : 12, pin: exact })
              if (!exact) toast(t('setup.locate.approxToast'), 'info')
            }}
            onLocateError={() => toast(t('setup.locate.deniedToast'), 'error')}
          />
        </JordanMap>

        <div className="absolute top-3 start-3 z-[1000] flex items-start gap-2 max-w-[calc(100%-4.5rem)]">
          {!panelOpen && (
            <Button size="md" icon="list" onClick={() => setPanelOpen(true)} className="shadow-soft shrink-0">
              <span className="hidden sm:inline">{t('parcels.title')}</span>
            </Button>
          )}
          <div className="w-72 max-w-full">
            <PlaceSearch
              compact
              placeholder={t('map.searchPlaceholder')}
              onPick={(p) => (insideJordan(p.lat, p.lon) ? setFly({ c: [p.lat, p.lon], z: p.zoom, pin: p.kind === 'coords' }) : toast(t('states.unsupportedLocationBody'), 'error'))}
            />
          </div>
        </div>

        {geometryMode && (
          <div className="absolute bottom-12 inset-x-0 z-[1000] flex justify-center pointer-events-none px-3">
            <span className="bg-surface/95 rounded-pill px-4 py-2 text-label shadow-soft text-center">
              {mode === 'coords' ? t('parcels.coordsHint') : geo.closed ? t('parcels.reshapeHint') : tool !== 'points' ? t(`parcels.toolHint.${tool}`) : geo.pts.length >= 3 ? t('parcels.closeHint') : t('parcels.drawHint')} · {t('parcels.vertices', { n: geo.pts.length })}
              {draftPolygon && <> · {fmtArea(areaM2(draftPolygon))}</>}
            </span>
          </div>
        )}
      </div>

      {confirmDelete && selected && (
        <ConfirmDialog
          title={t('parcels.deleteTitle')}
          body={t('parcels.deleteBody', { name: selected.name, number: selected.label, area: fmtArea(selected.area_m2), perimeter: meters(selected.perimeter_m) })}
          confirmLabel={t('parcels.delete')}
          danger
          busy={deletePlot.isPending}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
