// Runs one analysis end-to-end and reports the real processing stages.
import { ApiError } from '../api'
import { getClimate, powerMeta } from '../climate/environment'
import { dekadProbabilities, effectiveRainMonthly, kcAt, mean, monthlyClimatology, monthlySeries, scaleStages, type Climate } from '../climate/features'
import { toDay } from '../climate/power'
import type { NewAnalysisInput } from '../data/repo'
import type { AnalysisResult, CropHistoryItem, Farm, Plot, PlotSuitability, RankedCrop, Risk, WaterPlot } from '../types'
import { ENGINE_VERSION, statusOf } from './config'
import { CROPS, CROP_LIST, type CropKB } from './crops'
import { buildRotation, type Priority } from './rotation'
import {
  bestWindow,
  buildEvidence,
  buildExplanation,
  buildRequirements,
  buildRisks,
  dekadOf,
  mainReason,
  periodScores,
  recommendedActions,
  scanYear,
  waterDemandLevel,
  windowDates,
  type Evaluation,
  type PlotCtx,
} from './suitability'

export interface RunContext {
  input: NewAnalysisInput
  farm: Farm
  plots: Plot[]
  history: Record<string, CropHistoryItem[]>
}

const r0 = (x: number) => Math.round(x)
const r1 = (x: number) => Math.round(x * 10) / 10
const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms))

const DISCLAIMER = {
  ar: 'تعكس الدرجة الملاءمة البيئية فقط، ولا تضمن الإنتاج. يُرجى التأكد مع مهندس زراعي محلي. الحسابات من محرك قواعد أولي داخل المتصفح (rules-web-v0) لم تُعايَر أوزانه محلياً بعد.',
  en: 'The score reflects environmental suitability, not guaranteed yield. Confirm with a local agricultural engineer. Computed by a provisional in-browser rule engine (rules-web-v0) whose weights are not yet locally calibrated.',
}

function soilAnomaly(c: Climate): number | null {
  const d = c.daily
  const end = toDay(d.lastDate) - c.s0
  const v: number[] = []
  for (let k = Math.max(0, end - 29); k <= end; k++) if (d.gwr[k] !== null) v.push(d.gwr[k] as number)
  const rows = monthlySeries(c)
  const cur = rows[rows.length - 1]
  const clim = monthlyClimatology(rows, (r) => r.gwr, cur.key)[cur.month - 1]
  return v.length && clim !== null ? mean(v) - clim : null
}

export async function runAnalysis(ctx: RunContext, onStage: (stage: string) => void): Promise<AnalysisResult> {
  const { input, farm, plots } = ctx
  const type = input.analysis_type
  if (input.crop_id && !CROPS[input.crop_id]) throw new ApiError(422, 'UNSUPPORTED_CROP', `Unsupported crop ${input.crop_id}`)

  // 1) retrieve environmental data (NASA POWER, cached per 0.5° cell)
  onStage('retrieving_environmental_data')
  const climate = await getClimate(farm.centroid.lat, farm.centroid.lon)
  await pause()

  // 2) process: quality checks, ET0, anomalies, climatologies
  onStage('processing_satellite_information')
  if (climate.recordYears < 3) throw new ApiError(422, 'MISSING_DATA', 'Not enough historical data for this location')
  const anomaly = soilAnomaly(climate)
  const rows = monthlySeries(climate)
  await pause()

  // 3) evaluate crop requirements
  onStage('evaluating_crop_requirements')
  const memo = new Map<string, Evaluation[]>()
  const ctxOf = (p: Plot): PlotCtx => ({ irrigation_available: p.irrigation_available, irrigation_method: p.irrigation_method, soil_ph: p.soil_ph, soil_type: p.soil_type })
  const scan = (crop: CropKB, p: Plot) => {
    const key = `${crop.id}|${p.irrigation_available ? p.irrigation_method : 'rainfed'}`
    if (!memo.has(key)) memo.set(key, scanYear(climate, crop, ctxOf(p)))
    return memo.get(key)!
  }
  const today = new Date()
  const pick = (evals: Evaluation[], plantingDate?: string | null) => {
    const w = bestWindow(evals)
    const bestIdx = w ? w.best : evals.reduce((b, e, i) => (e.score > evals[b].score ? i : b), 0)
    const chosen = plantingDate && !evals[0].crop.perennial ? dekadOf(+plantingDate.slice(5, 7), +plantingDate.slice(8, 10)) : bestIdx
    return { w, e: evals[chosen], bestIdx }
  }
  const ranked = (p: Plot) =>
    CROP_LIST.map((c) => {
      const evals = scan(c, p)
      const { w, e } = pick(evals)
      return { c, evals, w, e }
    }).sort((a, b) => b.e.score - a.e.score)

  const suitability = (p: Plot, crop: CropKB, plantingDate?: string | null): PlotSuitability => {
    const evals = scan(crop, p)
    const { w, e } = pick(evals, plantingDate)
    const win = w && !crop.perennial ? windowDates(w.start, w.end, today) : null
    const risks = buildRisks(climate, e, ctxOf(p), anomaly)
    return {
      plot_id: p.id,
      plot_label: p.label,
      plot_name: p.name,
      crop: crop.id,
      suitability_score: r0(e.score),
      suitability_status: statusOf(e.score),
      recommended_planting_window: win,
      environmental_scores: { temperature: r0(e.factors.temperature), soil_moisture: r0(e.factors.soil_moisture), precipitation: r0(e.factors.precipitation), solar_radiation: r0(e.factors.solar_radiation) },
      risks,
      alternative_crops: ranked(p)
        .filter((x) => x.c.id !== crop.id)
        .slice(0, 3)
        .map((x) => ({ crop: x.c.id, suitability_score: r0(x.e.score) })),
      explanation: buildExplanation(e, ctxOf(p)),
      recommended_actions: recommendedActions(e, risks, ctxOf(p), win),
      evidence: buildEvidence(climate, e),
      requirements: buildRequirements(e, ctxOf(p)),
      period_scores: periodScores(evals, today.getUTCFullYear()),
    }
  }
  /** Crop to analyse for a plot: the requested one, else what is planted, else the best-ranked crop. */
  const cropFor = (p: Plot): CropKB => CROPS[input.crop_id ?? ''] ?? CROPS[p.current_crop_id ?? ''] ?? ranked(p)[0].c

  const result: AnalysisResult = {
    ...powerMeta(climate, 'historical_climatology'),
    is_demo: farm.is_demo,
    analysis_type: type,
    farm_id: farm.id,
    model_version: ENGINE_VERSION,
    engine_fallback: false,
    disclaimer: DISCLAIMER,
  }

  if (type === 'crop_suitability') {
    if (!input.crop_id) throw new ApiError(422, 'VALIDATION_ERROR', 'crop_id is required')
    result.plots = plots.map((p) => suitability(p, CROPS[input.crop_id!], input.planting_date))
  } else if (type === 'crop_recommendation') {
    result.recommendations = plots.map((p) => ({
      plot_id: p.id,
      plot_label: p.label,
      ranked: ranked(p).map(({ c, w, e }): RankedCrop => ({
        crop: c.id,
        suitability_score: r0(e.score),
        suitability_status: statusOf(e.score),
        planting_window: w && !c.perennial ? windowDates(w.start, w.end, today) : null,
        water_demand: waterDemandLevel(e.stats.etc),
        main_reason: mainReason(e, ctxOf(p)),
        environmental_scores: { temperature: r0(e.factors.temperature), soil_moisture: r0(e.factors.soil_moisture), precipitation: r0(e.factors.precipitation), solar_radiation: r0(e.factors.solar_radiation) },
        requirements: buildRequirements(e, ctxOf(p)),
        explanation: buildExplanation(e, ctxOf(p)),
      })),
    }))
  } else if (type === 'planting_window') {
    const ref = cropFor(plots[0])
    const probs = dekadProbabilities(climate, ref.heat_threshold.value)
    const rainClim = monthlyClimatology(rows, (r) => r.rain)
    const smClim = monthlyClimatology(rows, (r) => r.gwr)
    result.calendar = {
      rows: plots.map((p) => {
        const crop = cropFor(p)
        const evals = scan(crop, p)
        const w = bestWindow(evals)
        return { plot_id: p.id, plot_label: p.label, crop: crop.id, period_scores: periodScores(evals, today.getUTCFullYear()), best_window: w && !crop.perennial ? windowDates(w.start, w.end, today) : null }
      }),
      frost_periods: probs.frost.map((p, k) => ({ period: String(k), probability: r1(p * 100) / 100 })),
      heat_periods: probs.heat.map((p, k) => ({ period: String(k), probability: r1(p * 100) / 100 })),
      monthly_rainfall_mm: rainClim.map((v, m) => ({ month: m + 1, value: v === null ? 0 : r1(v) })),
      monthly_soil_moisture: smClim.map((v, m) => ({ month: m + 1, value: v === null ? null : r1(v * 100) })),
    }
    result.heat_threshold_c = ref.heat_threshold.value
  } else if (type === 'rotation') {
    const priority = (input.priority as Priority) ?? 'improve_soil'
    result.rotation = plots.map((p) => {
      const history = ctx.history[p.id] ?? []
      const { strategies } = buildRotation({ climate, plot: { ...ctxOf(p), current_crop_id: p.current_crop_id, previous_crop_id: p.previous_crop_id }, history, priority, today })
      return { plot_id: p.id, plot_label: p.label, priority, history, strategies }
    })
  } else if (type === 'water') {
    result.water = plots.map((p) => waterFor(climate, p, cropFor(p), pick(scan(cropFor(p), p), input.planting_date).e))
  } else {
    // risk
    const per = plots.map((p) => suitability(p, cropFor(p)))
    result.plots = per
    const merged = new Map<string, Risk>()
    const rank = { low: 1, moderate: 2, high: 3 }
    for (const s of per)
      for (const r of s.risks) {
        const m = merged.get(r.type)
        if (!m) merged.set(r.type, { ...r, affected_plots: [s.plot_label] })
        else {
          m.affected_plots!.push(s.plot_label)
          if (rank[r.severity] > rank[m.severity]) Object.assign(m, { ...r, affected_plots: m.affected_plots })
        }
      }
    result.risks = [...merged.values()].sort((a, b) => rank[b.severity] - rank[a.severity])
  }

  // 4) assemble explanations and provenance
  onStage('generating_recommendations')
  await pause()
  return result
}

/** Month-by-month water balance for the crop season (means over the historical record). */
function waterFor(c: Climate, p: Plot, crop: CropKB, e: Evaluation): WaterPlot {
  const d = c.daily
  const len = crop.season_length.value
  const stages = scaleStages(crop.stages.value, len)
  const kc = { ini: crop.kc.ini.value, mid: crop.kc.mid.value, end: crop.kc.end.value }
  const startM = crop.perennial ? 1 : Math.floor(e.dekad / 3) + 1
  const startD = crop.perennial ? 1 : [1, 11, 21][e.dekad % 3]
  const lastIdx = toDay(d.lastDate) - c.s0
  const acc = new Map<number, { et0: number[]; etc: number[]; eff: number[]; irr: number[]; order: number }>()
  for (let y = c.firstYear; y <= c.lastYear; y++) {
    const a = toDay(`${y}-${String(startM).padStart(2, '0')}-${String(startD).padStart(2, '0')}`) - c.s0
    if (a < 0 || a + len - 1 > lastIdx) continue
    const byMonth = new Map<number, { et0: number; etc: number; p: number }>()
    for (let k = a; k < a + len; k++) {
      const ym = c.ym[k]
      const m = byMonth.get(ym) ?? { et0: 0, etc: 0, p: 0 }
      const e0 = c.et0[k] ?? 0
      m.et0 += e0
      m.etc += e0 * kcAt(k - a, stages, kc)
      m.p += d.pr[k] ?? 0
      byMonth.set(ym, m)
    }
    let order = 0
    for (const [ym, m] of byMonth) {
      const month = (ym % 12) + 1
      const eff = Math.min(effectiveRainMonthly(m.p), m.etc)
      const slot = acc.get(month) ?? { et0: [], etc: [], eff: [], irr: [], order: order }
      slot.et0.push(m.et0)
      slot.etc.push(m.etc)
      slot.eff.push(eff)
      slot.irr.push(Math.max(0, m.etc - eff))
      acc.set(month, slot)
      order++
    }
  }
  const monthly = [...acc.entries()]
    .sort((x, y) => x[1].order - y[1].order)
    .map(([month, s]) => ({ month, et0_mm: r1(mean(s.et0)), etc_mm: r1(mean(s.etc)), effective_rain_mm: r1(mean(s.eff)), irrigation_mm: r1(mean(s.irr)) }))
  const tot = (k: 'etc_mm' | 'effective_rain_mm' | 'irrigation_mm') => r0(monthly.reduce((a, m) => a + m[k], 0))
  const irr = tot('irrigation_mm')
  const m3 = r0((irr / 1000) * p.area_m2)
  return {
    plot_id: p.id,
    plot_label: p.label,
    crop: crop.id,
    irrigation_available: p.irrigation_available,
    monthly,
    season_total: { etc_mm: tot('etc_mm'), effective_rain_mm: tot('effective_rain_mm'), irrigation_mm: irr, irrigation_m3: m3 },
    explanation: {
      ar: `يحتاج ${crop.name.ar} في هذه القطعة نحو ${tot('etc_mm')} ملم من الماء خلال الموسم (ETc = Kc × ET0). يغطي المطر الفعّال ${tot('effective_rain_mm')} ملم، فيبقى احتياج ري صافٍ ${irr} ملم، أي نحو ${m3} م³ لمساحة القطعة. الأرقام صافية ولا تشمل فاقد كفاءة نظام الري.${p.irrigation_available ? '' : ' القطعة بعلية حالياً، فهذا الاحتياج يمثل العجز المائي المتوقع.'}`,
      en: `${crop.name.en} on this plot needs about ${tot('etc_mm')} mm of water over the season (ETc = Kc × ET0). Effective rainfall covers ${tot('effective_rain_mm')} mm, leaving a net irrigation requirement of ${irr} mm, about ${m3} m³ for the plot area. Figures are net and exclude irrigation-system losses.${p.irrigation_available ? '' : ' The plot is currently rainfed, so this is the expected water deficit.'}`,
    },
  }
}
