/**
 * Data repository — the ONLY module the UI uses to read/write data.
 *
 * Every function calls the backend API (FastAPI, see backend/README.md). The frontend holds no
 * recommendation logic: scores, risks, explanations and forecasts all come from the server.
 * Signed-in users keep their farms, parcels and history there; guests store nothing.
 */
import { api, getToken, setToken } from '../api'
import type { Analysis, AnalysisType, AuthResponse, Bi, CropHistoryItem, DataMeta, EnvSummary, Farm, Governorate, LocateResponse, Plot, PlotDraft, RankedCrop, TimeSeries, User } from '../types'

const q = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString()

// ---------------- Auth ----------------

export function hasSession(): boolean {
  return !!getToken()
}

export async function register(full_name: string, email: string, password: string): Promise<User> {
  const r = await api<AuthResponse>('/auth/register', { body: { full_name, email, password } })
  setToken(r.access_token)
  return r.user
}

export async function login(email: string, password: string): Promise<User> {
  setToken(null) // a stale token must not turn a wrong password into a "session expired" sign-out
  const r = await api<AuthResponse>('/auth/login', { body: { email, password } })
  setToken(r.access_token)
  return r.user
}

export async function me(): Promise<User | null> {
  if (!getToken()) return null
  return api<User>('/auth/me')
}

export function updateMe(patch: Partial<Pick<User, 'full_name' | 'language' | 'area_unit'>>): Promise<User> {
  return api<User>('/auth/me', { method: 'PATCH', body: patch })
}

export function logout() {
  setToken(null)
}

export function forgotPassword(email: string): Promise<{ ok: boolean }> {
  return api('/auth/forgot-password', { body: { email } })
}

// ---------------- Geo ----------------

export function locate(lat: number, lon: number): Promise<LocateResponse> {
  return api<LocateResponse>(`/geo/locate?${q({ lat, lon })}`)
}

// ---------------- Farms ----------------

export const listFarms = () => api<Farm[]>('/farms')

export function createFarm(input: { name: string; lat: number; lon: number; owner_name?: string; owner_phone?: string }): Promise<Farm> {
  return api<Farm>('/farms', { body: { name: input.name, lat: input.lat, lon: input.lon, owner_name: input.owner_name ?? '', owner_phone: input.owner_phone ?? '' } })
}

export const createDemoFarm = () => api<Farm>('/farms/demo', { method: 'POST' })

export function updateFarm(id: string, patch: Partial<Pick<Farm, 'name' | 'owner_name' | 'owner_phone'>>): Promise<Farm> {
  return api<Farm>(`/farms/${id}`, { method: 'PATCH', body: patch })
}

export const deleteFarm = (id: string) => api<void>(`/farms/${id}`, { method: 'DELETE' })

// ---------------- Parcels (plots) ----------------

export const listPlots = (farmId: string) => api<Plot[]>(`/farms/${farmId}/plots`)

export const createPlot = (farmId: string, draft: PlotDraft) => api<Plot>(`/farms/${farmId}/plots`, { body: draft })

export const updatePlot = (id: string, patch: Partial<PlotDraft>) => api<Plot>(`/plots/${id}`, { method: 'PATCH', body: patch })

export const deletePlot = (id: string) => api<void>(`/plots/${id}`, { method: 'DELETE' })

/** Next free parcel number, from the parcels already loaded. */
export function nextLabel(plots: Pick<Plot, 'label'>[]): string {
  const nums = plots.filter((p) => /^\d+$/.test(p.label)).map((p) => parseInt(p.label, 10))
  return String((nums.length ? Math.max(...nums) : 0) + 1)
}

// ---------------- Crop history ----------------

export const getHistory = (plotId: string) => api<CropHistoryItem[]>(`/plots/${plotId}/history`)

export const saveHistory = (plotId: string, items: CropHistoryItem[]) =>
  api<CropHistoryItem[]>(`/plots/${plotId}/history`, { method: 'PUT', body: { items: items.map((i) => ({ season: i.season, crop_id: i.crop_id })) } })

// ---------------- Environment ----------------

export const getEnvSummary = (lat: number, lon: number) => api<EnvSummary>(`/environment/summary?${q({ lat, lon })}`)

export const getTimeSeries = (lat: number, lon: number, variable: string, resolution: string) =>
  api<TimeSeries>(`/environment/timeseries?${q({ lat, lon, variable, resolution })}`)

// ---------------- Analyses (saved history of the signed-in user) ----------------

export interface NewAnalysisInput {
  analysis_type: AnalysisType
  farm_id: string
  plot_ids: string[] | null
  crop_id?: string | null
  planting_date?: string | null
  priority?: string | null
}

export const createAnalysis = (input: NewAnalysisInput) => api<{ analysis_id: string; status: string }>('/analyses', { body: input })

export const listAnalyses = (farmId: string, type?: AnalysisType) => api<Analysis[]>(`/analyses?${q({ farm_id: farmId, analysis_type: type })}`)

export const getAnalysis = (id: string) => api<Analysis>(`/analyses/${id}`)

export const deleteAnalysis = (id: string) => api<void>(`/analyses/${id}`, { method: 'DELETE' })

// ---------------- Guests (nothing is saved) ----------------

export interface GuestRecommendation extends DataMeta {
  location: { lat: number; lon: number; governorate: Governorate | null }
  irrigation_available: boolean
  saved: false
  model_version: string
  disclaimer: Bi
  recommended_crops: RankedCrop[]
  all_crops: { crop: string; suitability_score: number; suitability_status: string }[]
}

export const guestRecommend = (input: { lat: number; lon: number; irrigation_available: boolean; irrigation_method?: string | null }) =>
  api<GuestRecommendation>('/guest/recommendations', { body: input })

// ---------------- Forecast outlook (AI team's models and rules; nothing stored) ----------------

type Text2 = { ar: string; en: string }

export interface OutlookForecast {
  key: 'temperature_c' | 'humidity_pct' | 'soil_moisture_m3_m3' | 'rainfall_mm'
  variable: string
  value: number
  unit: string
  method: 'baseline' | 'direct_xgb' | 'residual_xgb'
  baseline: string | null
  validation_mae: number | null
}

export interface OutlookCrop {
  crop_id: string
  name: Text2
  score: number
  status: 'suitable_candidate' | 'conditional' | 'not_recommended'
  days_to_harvest: [number, number]
  note: Text2
  reasons: Text2[]
  risks: Text2[]
  factor_scores: Record<string, number>
}

export interface OutlookPeriod {
  horizon_days: 30 | 90
  period_start: string
  period_end: string
  forecast: OutlookForecast[]
  best_candidate: string | null
  recommendations: OutlookCrop[]
}

export interface SoilInfoData {
  source: string
  depth_cm: [number, number]
  properties: { key: string; value: number; unit: string }[]
}

export interface Outlook {
  data_mode: 'historical_demo' | 'historical_data'
  planting_date: string
  forecast_origin: string
  is_default_date: boolean
  planting_date_min: string
  planting_date_max: string
  grid: { id: string; lat: number; lon: number; distance_km: number }
  irrigation_available: boolean | null
  soil: SoilInfoData | null
  rule_version: string
  periods: OutlookPeriod[]
  warnings: Text2[]
}

export const getOutlook = (input: { lat: number; lon: number; irrigation_available: boolean | null; planting_date?: string | null }) =>
  api<Outlook>('/outlook', { body: input })

/** Soil properties for a location, from the AI team's static soil table. `soil` is null where the table has no value. */
export const getSoil = (lat: number, lon: number) =>
  api<{ grid: { id: string; lat: number; lon: number; distance_km: number }; soil: SoilInfoData | null }>(`/outlook/soil?${q({ lat, lon })}`)

// ---------------- Crop Rotation Planner (AI team's forecasts + rules) ----------------

export type ForecastKey = 'temperature_c' | 'humidity_pct' | 'soil_moisture_m3_m3' | 'rainfall_mm'

export interface RotationPhase extends Record<ForecastKey, number> {
  start_day: number
  end_day: number
  start_date: string
  end_date: string
  method: string
  reliable: boolean
}

export interface RotationStep {
  phase: 1 | 2
  crop_id: string
  crop_name_ar: string
  crop_name_en: string
  family: string
  planting_day: number
  planting_date: string
  phase_end_date: string
  growth_days: [number, number]
  earliest_harvest_date: string
  latest_harvest_date: string
  suitability_score: number
  suitability_status: 'suitable_candidate' | 'conditional' | 'not_recommended'
  factor_scores: Record<string, number>
  duration_score: number
  requires_early_cultivar: boolean
  note: Text2
  reasons: Text2[]
  conditions: Text2[]
}

export interface RotationOption {
  rotation_score: number
  status: 'suitable' | 'conditionally_suitable'
  components: { first_crop_suitability: number; second_crop_suitability: number | null; family_diversity_score: number; duration_compatibility_score: number }
  estimated_total_days: [number, number]
  sequence: RotationStep[]
}

export interface RotationPlanData {
  status: 'success' | 'partial_plan' | 'no_plan_available'
  data_mode: 'historical_demo' | 'historical_data'
  planning_horizon_days: 30 | 90
  planting_date: string
  forecast_origin: string
  is_default_date: boolean
  planting_date_min: string
  planting_date_max: string
  location: { grid_id: string; latitude: number; longitude: number; grid_distance_km: number; governorate: { id: string; name_ar: string; name_en: string } | null }
  previous_crop: string | null
  irrigation_available: boolean | null
  cultivation_type: string | null
  soil: SoilInfoData | null
  forecasts: { phase_1: RotationPhase; phase_2?: RotationPhase }
  best_rotation: RotationOption | null
  alternative_rotations: RotationOption[]
  explanation: Text2[]
  warnings: Text2[]
  saved: boolean
}

export interface RotationPlanInput {
  latitude: number
  longitude: number
  planning_horizon_days: 30 | 90
  planting_date: string | null
  previous_crop: string | null
  irrigation_available: boolean | null
  cultivation_type: 'open_field' | 'greenhouse' | null
}

export interface SavedPlan {
  id: string
  farm_id: string
  plot_id: string | null
  plot_label: string
  created_at: string
  summary: { status: string; planning_horizon_days: number; planting_date: string; rotation_score: number | null; crops: string[] }
  plan?: RotationPlanData
}

export const getRotationPlan = (input: RotationPlanInput) => api<RotationPlanData>('/crop-rotation/plan', { body: input })

export const saveRotationPlan = (input: RotationPlanInput & { farm_id: string; plot_id: string | null }) => api<SavedPlan>('/crop-rotation/plans', { body: input })

export const listRotationPlans = (farmId: string) => api<SavedPlan[]>(`/crop-rotation/plans?${q({ farm_id: farmId })}`)

export const getSavedPlan = (id: string) => api<SavedPlan>(`/crop-rotation/plans/${id}`)

export const deleteSavedPlan = (id: string) => api<void>(`/crop-rotation/plans/${id}`, { method: 'DELETE' })
