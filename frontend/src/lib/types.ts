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
  plots_count?: number
  area_m2?: number
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
  cultivation_type?: 'open_field' | 'greenhouse'
  soil_type: string | null
  soil_ph: number | null
  created_at: string
  updated_at: string
  // filled from the latest analyses
}

export type PlotDraft = Omit<Plot, 'id' | 'farm_id' | 'area_m2' | 'perimeter_m' | 'created_at' | 'updated_at'>

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
