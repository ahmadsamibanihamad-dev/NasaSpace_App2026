/**
 * Data repository — the ONLY module the UI uses to read/write data.
 *
 * Current implementation: browser localStorage (frontend-only mode, data stays on this device).
 * To move to the real backend, re-implement these functions with `api()` from ../api.ts
 * (same signatures); nothing else in the UI needs to change.
 */
import type { Polygon } from 'geojson'
import { ApiError } from '../api'
import { areaM2, centroidOf, fromPolygon, governorateFor, insideJordan, perimeterM, validateRing } from '../geometry'
import type { Analysis, AnalysisType, CropHistoryItem, Farm, LocateResponse, Plot, PlotDraft, User } from '../types'
import { newId, nowIso, readTable, readValue, writeTable, writeValue } from './storage'

interface StoredUser extends User {
  salt: string
  password_hash: string
}
interface StoredHistory extends CropHistoryItem {
  plot_id: string
}
type StoredPlot = Omit<Plot, 'latest_score' | 'latest_status' | 'latest_top_risk'>

const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms))

// ---------------- Auth (local profile; NOT a security boundary) ----------------

async function hash(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  if (!crypto?.subtle) return `plain-unavailable:${salt}`
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
const publicUser = ({ salt: _s, password_hash: _p, ...u }: StoredUser): User => u

export function currentUserId(): string | null {
  return readValue<string>('session')
}
function requireUser(): string {
  const id = currentUserId()
  if (!id) throw new ApiError(401, 'UNAUTHORIZED', 'Not signed in')
  return id
}

export async function register(full_name: string, email: string, password: string): Promise<User> {
  await delay()
  const users = readTable<StoredUser>('users')
  const e = email.trim().toLowerCase()
  if (users.some((u) => u.email === e)) throw new ApiError(409, 'EMAIL_TAKEN', 'Email already registered')
  if (password.length < 8) throw new ApiError(422, 'VALIDATION_ERROR', 'Password too short')
  const salt = newId()
  const u: StoredUser = { id: newId(), email: e, full_name: full_name.trim(), language: 'ar', area_unit: 'dunum', created_at: nowIso(), salt, password_hash: await hash(password, salt) }
  writeTable('users', [...users, u])
  writeValue('session', u.id)
  return publicUser(u)
}

export async function login(email: string, password: string): Promise<User> {
  await delay()
  const u = readTable<StoredUser>('users').find((x) => x.email === email.trim().toLowerCase())
  if (!u || (await hash(password, u.salt)) !== u.password_hash) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password')
  writeValue('session', u.id)
  return publicUser(u)
}

export async function me(): Promise<User | null> {
  const id = currentUserId()
  const u = id ? readTable<StoredUser>('users').find((x) => x.id === id) : null
  return u ? publicUser(u) : null
}

export async function updateMe(patch: Partial<Pick<User, 'full_name' | 'language' | 'area_unit'>>): Promise<User> {
  const id = requireUser()
  const users = readTable<StoredUser>('users')
  const i = users.findIndex((u) => u.id === id)
  if (i < 0) throw new ApiError(401, 'UNAUTHORIZED', 'Not signed in')
  users[i] = { ...users[i], ...patch }
  writeTable('users', users)
  return publicUser(users[i])
}

export function logout() {
  writeValue('session', null)
}

export async function forgotPassword(_email: string): Promise<{ ok: true; stub: true }> {
  await delay(300)
  return { ok: true, stub: true } // UI stub: no email is sent in frontend-only mode
}

// ---------------- Geo ----------------

export async function locate(lat: number, lon: number): Promise<LocateResponse> {
  const inside = insideJordan(lat, lon)
  return { lat, lon, inside_jordan: inside, governorate: inside ? governorateFor(lat, lon) : null }
}

function requireInJordan(lat: number, lon: number) {
  if (!insideJordan(lat, lon)) throw new ApiError(422, 'UNSUPPORTED_LOCATION', 'Location is outside Jordan')
}

// ---------------- Farms ----------------

function ownFarm(id: string): Farm {
  const f = readTable<Farm>('farms').find((x) => x.id === id && x.user_id === requireUser())
  if (!f) throw new ApiError(404, 'NOT_FOUND', 'Farm not found')
  return f
}

export async function listFarms(): Promise<Farm[]> {
  const uid = requireUser()
  return readTable<Farm>('farms').filter((f) => f.user_id === uid)
}

export async function createFarm(input: { name: string; lat: number; lon: number; owner_name?: string; owner_phone?: string; is_demo?: boolean }): Promise<Farm> {
  const uid = requireUser()
  if (!input.name.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'Farm name is required')
  requireInJordan(input.lat, input.lon)
  const f: Farm = {
    id: newId(),
    user_id: uid,
    name: input.name.trim(),
    governorate: governorateFor(input.lat, input.lon),
    centroid: { lat: +input.lat.toFixed(6), lon: +input.lon.toFixed(6) },
    owner_name: input.owner_name?.trim() ?? '',
    owner_phone: input.owner_phone?.trim() ?? '',
    is_demo: !!input.is_demo,
    created_at: nowIso(),
  }
  writeTable('farms', [...readTable<Farm>('farms'), f])
  return f
}

export async function updateFarm(id: string, patch: Partial<Pick<Farm, 'name' | 'owner_name' | 'owner_phone'>>): Promise<Farm> {
  ownFarm(id)
  if (patch.name !== undefined && !patch.name.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'Farm name is required')
  const farms = readTable<Farm>('farms').map((f) => (f.id === id ? { ...f, ...patch } : f))
  writeTable('farms', farms)
  return farms.find((f) => f.id === id)!
}

export async function deleteFarm(id: string): Promise<void> {
  ownFarm(id)
  const plotIds = new Set(readTable<StoredPlot>('plots').filter((p) => p.farm_id === id).map((p) => p.id))
  writeTable('history', readTable<StoredHistory>('history').filter((h) => !plotIds.has(h.plot_id)))
  writeTable('plots', readTable<StoredPlot>('plots').filter((p) => p.farm_id !== id))
  writeTable('analyses', readTable<Analysis>('analyses').filter((a) => a.farm_id !== id))
  writeTable('farms', readTable<Farm>('farms').filter((f) => f.id !== id))
}

/** Keep the farm centre/governorate in sync with its parcels (used for climate data). */
function recenterFarm(farmId: string) {
  const plots = readTable<StoredPlot>('plots').filter((p) => p.farm_id === farmId)
  if (!plots.length) return
  const cs = plots.map((p) => centroidOf(p.polygon))
  const lat = cs.reduce((s, c) => s + c.lat, 0) / cs.length
  const lon = cs.reduce((s, c) => s + c.lon, 0) / cs.length
  writeTable(
    'farms',
    readTable<Farm>('farms').map((f) => (f.id === farmId ? { ...f, centroid: { lat: +lat.toFixed(6), lon: +lon.toFixed(6) }, governorate: governorateFor(lat, lon) ?? f.governorate } : f)),
  )
}

// ---------------- Parcels (plots) ----------------

function latestScores(farmId: string): Record<string, { score?: number; status?: string; risk?: { type: string; severity: string } }> {
  const rank: Record<string, number> = { high: 3, moderate: 2, low: 1 }
  const out: Record<string, { score?: number; status?: string; risk?: { type: string; severity: string } }> = {}
  const rows = readTable<Analysis>('analyses')
    .filter((a) => a.farm_id === farmId && a.status === 'completed' && (a.analysis_type === 'crop_suitability' || a.analysis_type === 'risk'))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 30)
  for (const a of rows) {
    for (const p of a.result?.plots ?? []) {
      const d = (out[p.plot_id] ??= {})
      if (d.score === undefined && p.suitability_score !== undefined && p.suitability_score !== null) {
        d.score = p.suitability_score
        d.status = p.suitability_status
      }
      if (!d.risk && p.risks?.length) {
        const top = [...p.risks].sort((x, y) => (rank[y.severity] ?? 0) - (rank[x.severity] ?? 0))[0]
        d.risk = { type: top.type, severity: top.severity }
      }
    }
  }
  return out
}

function hydrate(p: StoredPlot, scores: ReturnType<typeof latestScores>): Plot {
  const s = scores[p.id] ?? {}
  return { ...p, latest_score: s.score ?? null, latest_status: s.status ?? null, latest_top_risk: s.risk ?? null }
}

export async function listPlots(farmId: string): Promise<Plot[]> {
  ownFarm(farmId)
  const scores = latestScores(farmId)
  return readTable<StoredPlot>('plots')
    .filter((p) => p.farm_id === farmId)
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
    .map((p) => hydrate(p, scores))
}

function checkPolygon(polygon: Polygon) {
  const issues = validateRing(fromPolygon(polygon))
  if (issues.includes('outside_jordan')) throw new ApiError(422, 'UNSUPPORTED_LOCATION', 'Part of the parcel is outside Jordan')
  if (issues.length) throw new ApiError(422, 'INVALID_GEOMETRY', issues.join(','), issues)
}

function checkDraft(farmId: string, d: Partial<PlotDraft>, selfId?: string) {
  if (d.name !== undefined && !d.name.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'name')
  if (d.label !== undefined) {
    if (!d.label.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'label')
    const clash = readTable<StoredPlot>('plots').some((p) => p.farm_id === farmId && p.id !== selfId && p.label.trim() === d.label!.trim())
    if (clash) throw new ApiError(409, 'DUPLICATE_LABEL', 'Parcel number already used in this farm')
  }
  if (d.soil_ph !== undefined && d.soil_ph !== null && (d.soil_ph < 3 || d.soil_ph > 10.5)) throw new ApiError(422, 'VALIDATION_ERROR', 'soil_ph')
}

export function nextLabel(farmId: string): string {
  const nums = readTable<StoredPlot>('plots')
    .filter((p) => p.farm_id === farmId)
    .map((p) => parseInt(p.label, 10))
    .filter((n) => Number.isFinite(n))
  return String((nums.length ? Math.max(...nums) : 0) + 1)
}

export async function createPlot(farmId: string, draft: PlotDraft): Promise<Plot> {
  ownFarm(farmId)
  checkPolygon(draft.polygon)
  checkDraft(farmId, draft)
  const t = nowIso()
  const p: StoredPlot = {
    ...draft,
    name: draft.name.trim(),
    label: draft.label.trim(),
    id: newId(),
    farm_id: farmId,
    area_m2: areaM2(draft.polygon),
    perimeter_m: perimeterM(draft.polygon),
    created_at: t,
    updated_at: t,
  }
  writeTable('plots', [...readTable<StoredPlot>('plots'), p])
  recenterFarm(farmId)
  return hydrate(p, {})
}

export async function updatePlot(id: string, patch: Partial<PlotDraft>): Promise<Plot> {
  const plots = readTable<StoredPlot>('plots')
  const i = plots.findIndex((p) => p.id === id)
  if (i < 0) throw new ApiError(404, 'NOT_FOUND', 'Parcel not found')
  ownFarm(plots[i].farm_id)
  if (patch.polygon) checkPolygon(patch.polygon)
  checkDraft(plots[i].farm_id, patch, id)
  const next: StoredPlot = { ...plots[i], ...patch, updated_at: nowIso() }
  if (patch.polygon) {
    next.area_m2 = areaM2(patch.polygon)
    next.perimeter_m = perimeterM(patch.polygon)
  }
  plots[i] = next
  writeTable('plots', plots)
  if (patch.polygon) recenterFarm(next.farm_id)
  return hydrate(next, latestScores(next.farm_id))
}

export async function deletePlot(id: string): Promise<void> {
  const p = readTable<StoredPlot>('plots').find((x) => x.id === id)
  if (!p) throw new ApiError(404, 'NOT_FOUND', 'Parcel not found')
  ownFarm(p.farm_id)
  writeTable('history', readTable<StoredHistory>('history').filter((h) => h.plot_id !== id))
  writeTable('plots', readTable<StoredPlot>('plots').filter((x) => x.id !== id))
  recenterFarm(p.farm_id)
}

// ---------------- Crop history ----------------

export async function getHistory(plotId: string): Promise<CropHistoryItem[]> {
  return readTable<StoredHistory>('history')
    .filter((h) => h.plot_id === plotId)
    .sort((a, b) => a.season.localeCompare(b.season))
    .map(({ plot_id: _p, ...h }) => h)
}

export async function saveHistory(plotId: string, items: CropHistoryItem[]): Promise<CropHistoryItem[]> {
  const seasons = items.map((i) => i.season)
  if (new Set(seasons).size !== seasons.length) throw new ApiError(422, 'VALIDATION_ERROR', 'Each season can appear only once')
  if (items.some((i) => !/^\d{4}(-\d{4})?$/.test(i.season))) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid season')
  const rest = readTable<StoredHistory>('history').filter((h) => h.plot_id !== plotId)
  writeTable('history', [...rest, ...items.map((i) => ({ id: i.id ?? newId(), season: i.season, crop_id: i.crop_id, plot_id: plotId }))])
  return getHistory(plotId)
}

// ---------------- Analyses ----------------

export interface NewAnalysisInput {
  analysis_type: AnalysisType
  farm_id: string
  plot_ids: string[] | null
  crop_id?: string | null
  planting_date?: string | null
  priority?: string | null
}

export const STAGES = ['retrieving_environmental_data', 'processing_satellite_information', 'evaluating_crop_requirements', 'generating_recommendations'] as const

function withStages(a: Analysis): Analysis {
  const idx = a.status === 'completed' ? STAGES.length : a.stage ? STAGES.indexOf(a.stage as (typeof STAGES)[number]) : -1
  return {
    ...a,
    stages: STAGES.map((key, i) => ({ key, label: { ar: '', en: '' }, status: i < idx ? 'done' : i === idx && a.status === 'running' ? 'running' : a.status === 'completed' ? 'done' : 'pending' })),
  }
}

export function patchAnalysis(id: string, patch: Partial<Analysis>) {
  writeTable('analyses', readTable<Analysis>('analyses').map((a) => (a.id === id ? { ...a, ...patch } : a)))
}

export async function listAnalyses(farmId: string, type?: AnalysisType): Promise<Analysis[]> {
  ownFarm(farmId)
  return readTable<Analysis>('analyses')
    .filter((a) => a.farm_id === farmId && (!type || a.analysis_type === type))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((a) => withStages({ ...a, result: null, summary: a.summary }))
}

export async function getAnalysis(id: string): Promise<Analysis> {
  const a = readTable<Analysis>('analyses').find((x) => x.id === id)
  if (!a) throw new ApiError(404, 'NOT_FOUND', 'Analysis not found')
  ownFarm(a.farm_id)
  // A page reload kills the in-browser job; surface that instead of spinning forever.
  if ((a.status === 'running' || a.status === 'queued') && Date.now() - new Date(a.created_at).getTime() > 3 * 60 * 1000 && !running.has(a.id)) {
    patchAnalysis(a.id, { status: 'failed', error: { code: 'INTERRUPTED', message: 'The analysis was interrupted' } })
    return getAnalysis(id)
  }
  return withStages(a)
}

export async function deleteAnalysis(id: string): Promise<void> {
  writeTable('analyses', readTable<Analysis>('analyses').filter((a) => a.id !== id))
}

const running = new Set<string>()

export async function createAnalysis(input: NewAnalysisInput): Promise<{ analysis_id: string; status: string }> {
  const farm = ownFarm(input.farm_id)
  const all = await listPlots(farm.id)
  const plots = input.plot_ids ? all.filter((p) => input.plot_ids!.includes(p.id)) : all
  if (!plots.length) throw new ApiError(422, 'VALIDATION_ERROR', 'No parcels selected')
  const a: Analysis = {
    id: newId(),
    farm_id: farm.id,
    analysis_type: input.analysis_type,
    scope: input.plot_ids ? 'plots' : 'farm',
    inputs: { ...input },
    status: 'queued',
    stage: null,
    stages: [],
    result: null,
    error: null,
    created_at: nowIso(),
    completed_at: null,
    summary: { headline_score: null, crop: input.crop_id ?? null, plots: plots.map((p) => p.label) },
  }
  writeTable('analyses', [...readTable<Analysis>('analyses'), a])
  running.add(a.id)
  // Background job (in the browser). Stages are reported as the real steps happen.
  void (async () => {
    try {
      const { runAnalysis } = await import('../engine/run')
      const history: Record<string, CropHistoryItem[]> = {}
      for (const p of plots) history[p.id] = await getHistory(p.id)
      const result = await runAnalysis({ input, farm, plots, history }, (stage) => patchAnalysis(a.id, { status: 'running', stage }))
      const first = result.plots?.[0]
      patchAnalysis(a.id, {
        status: 'completed',
        stage: null,
        result,
        completed_at: nowIso(),
        summary: { headline_score: first?.suitability_score ?? null, crop: first?.crop ?? input.crop_id ?? null, plots: plots.map((p) => p.label) },
      })
    } catch (e) {
      const err = e as ApiError
      try {
        patchAnalysis(a.id, { status: 'failed', error: { code: err.code || 'ANALYSIS_FAILED', message: err.message || 'Analysis failed' } })
      } catch {
        /* storage failure already reported to the user by the page */
      }
    } finally {
      running.delete(a.id)
    }
  })()
  return { analysis_id: a.id, status: a.status }
}
