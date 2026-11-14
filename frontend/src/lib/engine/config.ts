/**
 * Scoring configuration for the provisional in-browser rule engine.
 *
 * IMPORTANT: these weights, thresholds and penalties are engineering defaults, NOT values from
 * FAO/ECOCROP. They are all needs_review and must be calibrated with a local agricultural engineer
 * (or replaced by the backend engine / the team's ML model).
 */
export const ENGINE_VERSION = 'rules-web-v0'

export const WEIGHTS = { temperature: 0.35, precipitation: 0.3, soil_moisture: 0.2, solar_radiation: 0.15 }

// Generic trapezoids [absolute min, optimal min, optimal max, absolute max]
export const SOIL_WETNESS_LIMITS: [number, number, number, number] = [0.15, 0.35, 0.75, 0.95] // POWER GWETROOT fraction (0–1)
export const SOLAR_LIMITS: [number, number, number, number] = [6, 12, 28, 34] // MJ/m²/day

export const IRRIGATION_FLOOR: Record<string, number> = { drip: 95, sprinkler: 90, surface: 85 }
export const IRRIGATED_SOIL_FLOOR = 85

export const PENALTY = {
  frostPerDay: { low: 4, moderate: 2, high: 0.75 },
  frostCap: 20,
  heatPerDay: 0.5,
  heatCap: 15,
  drySpellFreeDays: 20,
  drySpellPerDay: 0.5,
  drySpellCap: 10,
  drySpellTolerance: { low: 1.2, moderate: 1, high: 0.7 },
  totalCap: 35,
}

export const STATUS = { highly_suitable: 80, suitable: 60, marginal: 40 }

export const RISK = {
  frostDays: { moderate: 1, high: 3 },
  heatDays: { moderate: 5, high: 15 },
  rainReliability: { moderate: 0.8, high: 0.5 }, // fraction of years meeting the crop's minimum rainfall
  drySpellDays: { moderate: 20, high: 30 },
  extremeRainDays: { moderate: 3, high: 6 },
  soilWetnessAnomaly: { moderate: -0.05, high: -0.1 },
}

/** Display binning for the 1–3 water-drop indicator (seasonal crop water demand ETc, mm). */
export const WATER_DEMAND_BINS = [350, 600]

export function statusOf(score: number): string {
  return score >= STATUS.highly_suitable ? 'highly_suitable' : score >= STATUS.suitable ? 'suitable' : score >= STATUS.marginal ? 'marginal' : 'unsuitable'
}

/** Trapezoidal membership: 0 outside [a, d], 100 inside [b, c], linear in between. */
export function trapezoid(x: number, a: number, b: number, c: number, d: number): number {
  if (!Number.isFinite(x)) return 0
  if (x <= a || x >= d) return 0
  if (x >= b && x <= c) return 100
  return x < b ? ((x - a) / (b - a)) * 100 : ((d - x) / (d - c)) * 100
}
