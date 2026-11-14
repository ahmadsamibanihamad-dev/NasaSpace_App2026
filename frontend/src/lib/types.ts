import type { Polygon } from 'geojson'

export type Bi = { ar: string; en: string }

export interface User {
  id: string
  email: string
  full_name: string
  language: 'ar' | 'en'
  area_unit: 'dunum' | 'hectare'
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

export interface Governorate {
  id: string
  name_ar: string
  name_en: string
}

export interface LocateResponse {
  lat: number
  lon: number
  inside_jordan: boolean
  governorate: Governorate | null
}

export interface Farm {
  id: string
  user_id: string
  name: string
  governorate: Governorate | null
  /** Located point chosen in setup; re-centred on the parcels once they exist. */
  centroid: { lat: number; lon: number }
  owner_name: string
  owner_phone: string
  is_demo: boolean
  created_at: string
}

export type PlotStatus = 'planted' | 'fallow' | 'preparing' | 'unused'

/** A parcel (قطعة) drawn on the map. Always belongs to one farm. */
export interface Plot {
  id: string
  farm_id: string
  /** Parcel number / short code shown on the map (unique inside a farm). */
  label: string
  name: string
  region: string
  polygon: Polygon
  area_m2: number
  perimeter_m: number
  color: string
  status: PlotStatus
  notes: string
  owner_name: string
  owner_phone: string
  current_crop_id: string | null
  previous_crop_id: string | null
  irrigation_available: boolean
  irrigation_method: string | null
  soil_type: string | null
  soil_ph: number | null
  created_at: string
  updated_at: string
  // filled from the latest analyses
  latest_score: number | null
  latest_status: string | null
  latest_top_risk: { type: string; severity: string } | null
}

export type PlotDraft = Omit<Plot, 'id' | 'farm_id' | 'area_m2' | 'perimeter_m' | 'created_at' | 'updated_at' | 'latest_score' | 'latest_status' | 'latest_top_risk'>

export interface CropHistoryItem {
  id?: string
  season: string
  crop_id: string | null
}

export interface SourcedValue<T = number> {
  value: T
  source: string
  needs_review?: boolean
  note?: string
}

export interface Crop {
  id: string
  name: Bi
  scientific_name: string
  family: string
  category: 'cereal' | 'legume' | 'vegetable' | 'tree'
  nitrogen_fixing: boolean
  water_demand_level: 1 | 2 | 3
  relative_income: SourcedValue<number>
  typical_planting_months: SourcedValue<number[]>
  season_length_days: SourcedValue<number>
  temperature: {
    absolute_min: SourcedValue
    absolute_max: SourcedValue
    optimal_min: SourcedValue
    optimal_max: SourcedValue
    base: SourcedValue
    heat_stress: SourcedValue
  }
  water_requirement_mm: { min: SourcedValue; max: SourcedValue }
  rainfall_annual_mm: { absolute_min: SourcedValue; optimal_min: SourcedValue; optimal_max: SourcedValue; absolute_max: SourcedValue }
  kc: { ini: SourcedValue; mid: SourcedValue; end: SourcedValue }
  stage_lengths_days: SourcedValue<number[]>
  root_depth_m: SourcedValue<number[]>
  frost_tolerance: SourcedValue<string>
  drought_tolerance: SourcedValue<string>
  soil_ph: { optimal_min: SourcedValue; optimal_max: SourcedValue }
  needs_review_fields: string[]
}

export interface DataMeta {
  data_sources: string[]
  data_quality: 'good' | 'adequate' | 'limited' | 'poor'
  confidence: 'high' | 'medium' | 'low'
  data_timestamp: string
  analysis_basis: string
  is_demo: boolean
  notes?: Bi[]
}

export interface MetricSummary {
  value: number | null
  unit: string
  source: string
  period: Bi
  trend: { label: string; value: number | null }[]
  historical_mean?: number | null
  anomaly?: number | null
}

export interface EnvSummary extends DataMeta {
  lat: number
  lon: number
  metrics: {
    soil_moisture: MetricSummary
    temperature: MetricSummary
    seasonal_rainfall: MetricSummary
  }
}

export interface TimeSeries extends DataMeta {
  variable: string
  unit: string
  resolution: string
  points: { t: string; value: number | null; historical_mean: number | null }[]
}

export type AnalysisType =
  | 'crop_suitability'
  | 'crop_recommendation'
  | 'planting_window'
  | 'rotation'
  | 'water'
  | 'risk'

export type Severity = 'low' | 'moderate' | 'high'

export interface Risk {
  type: string
  severity: Severity
  period?: Bi | null
  explanation: Bi
  action: Bi
  affected_plots?: string[]
}

export interface Evidence {
  metric: string
  label?: Bi
  value: number | string | null
  unit?: string
  period: string
  source: string
}

export interface RequirementMatch {
  key: string
  label: Bi
  required: string
  observed: string
  status: 'match' | 'partial' | 'mismatch' | 'unknown'
  source: string
  needs_review: boolean
}

export interface PlotSuitability {
  plot_id: string
  plot_label: string
  plot_name?: string
  crop: string
  suitability_score: number
  suitability_status: string
  recommended_planting_window: { start: string; end: string } | null
  environmental_scores: Record<string, number>
  risks: Risk[]
  alternative_crops: { crop: string; suitability_score: number }[]
  explanation: Bi
  recommended_actions: Bi[]
  evidence: Evidence[]
  requirements: RequirementMatch[]
  period_scores: { period: string; start: string; score: number }[]
}

export interface RankedCrop {
  crop: string
  suitability_score: number
  suitability_status: string
  planting_window: { start: string; end: string } | null
  water_demand: 1 | 2 | 3
  main_reason: Bi
  environmental_scores?: Record<string, number>
  requirements?: RequirementMatch[]
  explanation?: Bi
}

export interface CalendarRow {
  plot_id: string
  plot_label: string
  crop: string
  period_scores: { period: string; start: string; score: number }[]
  best_window: { start: string; end: string } | null
}

export interface RotationStrategy {
  key: 'current' | 'option_a' | 'option_b'
  title: Bi
  focus: string
  sequence: { season: string; crop: string | null; suitability_score: number | null }[]
  scores: { water_use: number; soil_health: number; income_potential: number }
  why: Bi[]
  evidence: Evidence[]
  benefits: Bi[]
  information_gaps: Bi[]
  risks_for_review: Bi[]
}

export interface WaterPlot {
  plot_id: string
  plot_label: string
  crop: string
  irrigation_available: boolean
  monthly: { month: number; et0_mm: number; etc_mm: number; effective_rain_mm: number; irrigation_mm: number }[]
  season_total: { etc_mm: number; effective_rain_mm: number; irrigation_mm: number; irrigation_m3: number }
  explanation: Bi
}

export interface AnalysisResult extends DataMeta {
  analysis_type: AnalysisType
  farm_id: string
  model_version: string
  engine_fallback: boolean
  disclaimer: Bi
  // per type
  plots?: PlotSuitability[]
  recommendations?: { plot_id: string; plot_label: string; ranked: RankedCrop[] }[]
  calendar?: {
    rows: CalendarRow[]
    frost_periods: { period: string; probability: number }[]
    heat_periods: { period: string; probability: number }[]
    monthly_rainfall_mm: { month: number; value: number }[]
    monthly_soil_moisture: { month: number; value: number | null }[]
  }
  rotation?: { plot_id: string; plot_label: string; priority: string; history: CropHistoryItem[]; strategies: RotationStrategy[] }[]
  water?: WaterPlot[]
  risks?: Risk[]
  [k: string]: unknown
}

export interface Analysis {
  id: string
  farm_id: string
  analysis_type: AnalysisType
  scope: 'farm' | 'plots'
  inputs: Record<string, unknown>
  status: 'queued' | 'running' | 'completed' | 'failed'
  stage: string | null
  stages: { key: string; label: Bi; status: 'pending' | 'running' | 'done' }[]
  result: AnalysisResult | null
  error: { code: string; message: string } | null
  created_at: string
  completed_at: string | null
  summary?: { headline_score: number | null; crop: string | null; plots: string[] }
}
