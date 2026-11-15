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
