/**
 * Provisional rule-based suitability engine (transparent, no black box).
 *
 * NOTE ON ARCHITECTURE: the product spec places all recommendation logic in the backend.
 * This module exists only because the app currently runs frontend-only; it sits behind
 * lib/data/repo.ts so it can be replaced by the backend engine (or the team's ML model)
 * without touching any screen. Results carry model_version "rules-web-v0".
 */
import type { Bi, Evidence, RequirementMatch, Risk, Severity } from '../types'
import { DEKADS, dekadOf, dekadProbabilities, dekadStart, fractionOfYearsMeeting, seasonStats, type Climate, type SeasonStats } from '../climate/features'
import { IRRIGATED_SOIL_FLOOR, IRRIGATION_FLOOR, PENALTY, RISK, SOIL_WETNESS_LIMITS, SOLAR_LIMITS, WATER_DEMAND_BINS, WEIGHTS, statusOf, trapezoid } from './config'
import type { CropKB } from './crops'

export interface PlotCtx {
  irrigation_available: boolean
  irrigation_method: string | null
  soil_ph: number | null
  soil_type: string | null
}

export interface Evaluation {
  crop: CropKB
  dekad: number
  stats: SeasonStats
  factors: { temperature: number; precipitation: number; soil_moisture: number; solar_radiation: number }
  rainScore: number
  rainReliability: number
  penalties: { frost: number; heat: number; dry_spell: number; total: number }
  score: number
}

const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const r0 = (x: number) => Math.round(x)
const r1 = (x: number) => Math.round(x * 10) / 10
const SRC = 'NASA POWER'

export function evaluate(c: Climate, crop: CropKB, dekad: number, plot: PlotCtx): Evaluation {
  const start = crop.perennial ? { month: 1, day: 1 } : dekadStart(dekad)
  const stats = seasonStats(c, {
    startMonth: start.month,
    startDay: start.day,
    lengthDays: crop.season_length.value,
    tBase: crop.base_temp.value,
    heatThreshold: crop.heat_threshold.value,
    kc: { ini: crop.kc.ini.value, mid: crop.kc.mid.value, end: crop.kc.end.value },
    stages: crop.stages.value,
  })
  const T = crop.temp
  const R = crop.rain
  const temperature = trapezoid(stats.tmean, T.abs_min.value, T.opt_min.value, T.opt_max.value, T.abs_max.value)
  const rainScore = trapezoid(stats.rain, R.abs_min.value, R.opt_min.value, R.opt_max.value, R.abs_max.value)
  const rainReliability = fractionOfYearsMeeting(stats, R.abs_min.value)
  const irrigated = plot.irrigation_available
  const deficit = stats.rain < R.opt_min.value
  let precipitation = rainScore * (0.7 + 0.3 * rainReliability)
  // Irrigation covers a rainfall deficit (not an excess).
  if (irrigated && deficit) precipitation = Math.max(precipitation, IRRIGATION_FLOOR[plot.irrigation_method ?? 'surface'] ?? 85)
  let soil = stats.soilWetness === null ? 50 : trapezoid(stats.soilWetness, ...SOIL_WETNESS_LIMITS)
  if (irrigated && stats.soilWetness !== null && stats.soilWetness < SOIL_WETNESS_LIMITS[1]) soil = Math.max(soil, IRRIGATED_SOIL_FLOOR)
  const solar = trapezoid(stats.rs, ...SOLAR_LIMITS)
  const factors = { temperature, precipitation, soil_moisture: soil, solar_radiation: solar }
  const base = temperature * WEIGHTS.temperature + precipitation * WEIGHTS.precipitation + soil * WEIGHTS.soil_moisture + solar * WEIGHTS.solar_radiation

  const frost = Math.min(PENALTY.frostCap, stats.frostDays * PENALTY.frostPerDay[crop.frost_tolerance.value])
  const heat = Math.min(PENALTY.heatCap, stats.heatDays * PENALTY.heatPerDay)
  const dry =
    irrigated || crop.perennial
      ? 0
      : Math.min(PENALTY.drySpellCap, Math.max(0, stats.longestDrySpell - PENALTY.drySpellFreeDays) * PENALTY.drySpellPerDay * PENALTY.drySpellTolerance[crop.drought_tolerance.value])
  const total = Math.min(PENALTY.totalCap, frost + heat + dry)
  // A crop outside its absolute temperature limits cannot be rescued by the other factors.
  const limited = temperature === 0 ? Math.min(base, 35) : base
  const score = stats.n === 0 ? 0 : Math.max(0, Math.min(100, limited - total))
  return { crop, dekad, stats, factors, rainScore, rainReliability, penalties: { frost, heat, dry_spell: dry, total }, score }
}

/** Evaluate every 10-day planting period of the year. */
export function scanYear(c: Climate, crop: CropKB, plot: PlotCtx): Evaluation[] {
  if (crop.perennial) {
    const e = evaluate(c, crop, 0, plot)
    return Array.from({ length: DEKADS }, (_, k) => ({ ...e, dekad: k }))
  }
  return Array.from({ length: DEKADS }, (_, k) => evaluate(c, crop, k, plot))
}

/** Best contiguous run of dekads around the maximum (within 5 points of it, and at least marginal). */
export function bestWindow(evals: Evaluation[]): { start: number; end: number; best: number } | null {
  let best = 0
  evals.forEach((e, i) => {
    if (e.score > evals[best].score) best = i
  })
  const top = evals[best].score
  if (top < 40) return null
  const ok = (i: number) => evals[(i + DEKADS) % DEKADS].score >= Math.max(40, top - 5)
  let start = best
  let end = best
  let guard = 0
  while (ok(start - 1) && guard++ < DEKADS - 1) start--
  while (ok(end + 1) && end - start < DEKADS - 1) end++
  return { start: (start + DEKADS) % DEKADS, end: (end + DEKADS) % DEKADS, best }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Next calendar occurrence (from `today`) of a dekad range. */
export function windowDates(start: number, end: number, today = new Date()): { start: string; end: string } {
  const s = dekadStart(start)
  const y = today.getUTCFullYear()
  let sd = new Date(Date.UTC(y, s.month - 1, s.day))
  const span = ((end - start + DEKADS) % DEKADS) + 1
  const endOf = (from: Date) => {
    const last = dekadStart((start + span - 1) % DEKADS)
    let ed = new Date(Date.UTC(from.getUTCFullYear(), last.month - 1, last.day + 9))
    if (ed < from) ed = new Date(Date.UTC(from.getUTCFullYear() + 1, last.month - 1, last.day + 9))
    return ed
  }
  if (endOf(sd) < today) sd = new Date(Date.UTC(y + 1, s.month - 1, s.day))
  return { start: iso(sd), end: iso(endOf(sd)) }
}

export function periodScores(evals: Evaluation[], year = new Date().getUTCFullYear()) {
  return evals.map((e) => {
    const s = dekadStart(e.dekad)
    const mm = String(s.month).padStart(2, '0')
    const dd = String(s.day).padStart(2, '0')
    return { period: `${mm}-${dd}`, start: `${year}-${mm}-${dd}`, score: r0(e.score) }
  })
}

export function waterDemandLevel(etc: number): 1 | 2 | 3 {
  return etc < WATER_DEMAND_BINS[0] ? 1 : etc < WATER_DEMAND_BINS[1] ? 2 : 3
}

function seasonLabel(crop: CropKB, dekad: number): Bi {
  if (crop.perennial) return { ar: 'على مدار السنة', en: 'Whole year' }
  const s = dekadStart(dekad)
  const endM = (s.month - 1 + Math.floor((s.day - 1 + crop.season_length.value) / 30.4)) % 12
  return { ar: `${MONTHS_AR[s.month - 1]} – ${MONTHS_AR[endM]}`, en: `${MONTHS_EN[s.month - 1]} – ${MONTHS_EN[endM]}` }
}

const sev = (v: number, t: { moderate: number; high: number }): Severity => (v >= t.high ? 'high' : v >= t.moderate ? 'moderate' : 'low')

export function buildRisks(c: Climate, e: Evaluation, plot: PlotCtx, soilAnomaly: number | null): Risk[] {
  const { crop, stats } = e
  const period = seasonLabel(crop, e.dekad)
  const risks: Risk[] = []
  const years = stats.n

  if (stats.frostDays >= 0.2) {
    const tolFactor = { low: 1, moderate: 0.6, high: 0.3 }[crop.frost_tolerance.value]
    const probs = dekadProbabilities(c, crop.heat_threshold.value).frost
    const months = [...new Set(probs.map((p, k) => (p >= 0.2 ? Math.floor(k / 3) : -1)).filter((m) => m >= 0))]
    const p: Bi = months.length ? { ar: months.map((m) => MONTHS_AR[m]).join('، '), en: months.map((m) => MONTHS_EN[m]).join(', ') } : period
    risks.push({
      type: 'frost',
      severity: sev(stats.frostDays * tolFactor, RISK.frostDays),
      period: p,
      explanation: {
        ar: `في المتوسط ${r1(stats.frostDays)} يوم صقيع (الصغرى دون 0°م) خلال موسم ${crop.name.ar}، وحدث الصقيع في ${r0(stats.frostYearFraction * 100)}٪ من ${years} موسماً. أدنى حرارة مسجلة ${r1(stats.absMinT)}°م.`,
        en: `On average ${r1(stats.frostDays)} frost days (Tmin below 0 °C) occur during the ${crop.name.en} season, and frost occurred in ${r0(stats.frostYearFraction * 100)}% of ${years} seasons. Lowest recorded temperature: ${r1(stats.absMinT)} °C.`,
      },
      action: {
        ar: 'أخّر الزراعة إلى ما بعد فترة الصقيع إن أمكن، وغطِّ الشتلات الحساسة أو اروِ رياً خفيفاً قبل الليالي الباردة.',
        en: 'Delay planting until after the frost period where possible; cover sensitive seedlings or irrigate lightly before cold nights.',
      },
    })
  }
  if (stats.heatDays >= 1) {
    risks.push({
      type: 'heat_stress',
      severity: sev(stats.heatDays, RISK.heatDays),
      period,
      explanation: {
        ar: `في المتوسط ${r1(stats.heatDays)} يوماً تتجاوز فيها العظمى ${crop.heat_threshold.value}°م (الحد الأعلى لـ${crop.name.ar}) خلال الموسم.`,
        en: `On average ${r1(stats.heatDays)} days exceed ${crop.heat_threshold.value} °C (the upper limit for ${crop.name.en}) during the season.`,
      },
      action: {
        ar: 'بكّر موعد الزراعة لتجنب الحر في مرحلة الإزهار، واروِ في الصباح الباكر، واستخدم التغطية (الملش) أو التظليل للخضار.',
        en: 'Plant earlier so flowering avoids the heat, irrigate in the early morning, and use mulch or shading for vegetables.',
      },
    })
  }
  if (!plot.irrigation_available && e.rainReliability < 1 && stats.rain < crop.rain.opt_min.value) {
    const s: Severity = e.rainReliability < RISK.rainReliability.high ? 'high' : e.rainReliability < RISK.rainReliability.moderate ? 'moderate' : 'low'
    risks.push({
      type: 'drought',
      severity: s,
      period,
      explanation: {
        ar: `متوسط أمطار الموسم ${r0(stats.rain)} ملم، والحد الأدنى لـ${crop.name.ar} ${crop.rain.abs_min.value} ملم. تحقق هذا الحد في ${r0(e.rainReliability * 100)}٪ فقط من المواسم (${years} موسماً)، والقطعة بعلية.`,
        en: `Mean seasonal rainfall is ${r0(stats.rain)} mm against a minimum of ${crop.rain.abs_min.value} mm for ${crop.name.en}. That minimum was met in only ${r0(e.rainReliability * 100)}% of ${years} seasons, and the plot is rainfed.`,
      },
      action: {
        ar: 'وفّر رياً تكميلياً إن أمكن، أو اختر محصولاً أكثر تحملاً للجفاف، واعتمد الحصاد المائي وتقليل الحراثة لحفظ رطوبة التربة.',
        en: 'Provide supplemental irrigation if possible, or choose a more drought-tolerant crop; use water harvesting and reduced tillage to conserve soil moisture.',
      },
    })
  }
  if (!plot.irrigation_available && !crop.perennial && stats.longestDrySpell >= RISK.drySpellDays.moderate) {
    risks.push({
      type: 'dry_spell',
      severity: sev(stats.longestDrySpell, { moderate: RISK.drySpellDays.moderate, high: RISK.drySpellDays.high }),
      period,
      explanation: {
        ar: `أطول فترة متتالية بلا مطر (أقل من 1 ملم/يوم) خلال الموسم تبلغ في المتوسط ${r0(stats.longestDrySpell)} يوماً.`,
        en: `The longest run of consecutive dry days (under 1 mm/day) during the season averages ${r0(stats.longestDrySpell)} days.`,
      },
      action: {
        ar: 'خطّط لرية تكميلية في المراحل الحساسة (الإنبات والإزهار)، وحافظ على غطاء التربة.',
        en: 'Plan a supplemental irrigation at sensitive stages (emergence and flowering) and keep the soil covered.',
      },
    })
  }
  if (stats.extremeRainDays >= RISK.extremeRainDays.moderate || stats.rain > crop.rain.opt_max.value) {
    risks.push({
      type: 'excessive_rainfall',
      severity: stats.rain > crop.rain.abs_max.value ? 'high' : sev(stats.extremeRainDays, RISK.extremeRainDays),
      period,
      explanation: {
        ar: `في المتوسط ${r1(stats.extremeRainDays)} يوماً في الموسم يتجاوز فيها المطر ${r0(c.r95)} ملم/يوم (أعلى 5٪ من الأيام الماطرة محلياً). مجموع أمطار الموسم ${r0(stats.rain)} ملم.`,
        en: `On average ${r1(stats.extremeRainDays)} days per season exceed ${r0(c.r95)} mm/day (the local top 5% of wet days). Seasonal rainfall totals ${r0(stats.rain)} mm.`,
      },
      action: {
        ar: 'تأكد من تصريف المياه في القطعة، وتجنب الزراعة في المنخفضات، وافتح قنوات تصريف قبل موسم الأمطار.',
        en: 'Make sure the plot drains well, avoid planting in low spots, and open drainage channels before the rainy season.',
      },
    })
  }
  if (soilAnomaly !== null && soilAnomaly <= RISK.soilWetnessAnomaly.moderate) {
    risks.push({
      type: 'low_soil_moisture',
      severity: soilAnomaly <= RISK.soilWetnessAnomaly.high ? 'high' : 'moderate',
      period: { ar: 'آخر 30 يوماً', en: 'Last 30 days' },
      explanation: {
        ar: `رطوبة منطقة الجذور في آخر 30 يوماً أقل من معدلها لهذا الوقت من السنة بـ ${r0(Math.abs(soilAnomaly) * 100)} نقطة مئوية (مؤشر GWETROOT من NASA POWER).`,
        en: `Root-zone wetness over the last 30 days is ${r0(Math.abs(soilAnomaly) * 100)} percentage points below normal for this time of year (NASA POWER GWETROOT index).`,
      },
      action: {
        ar: 'افحص رطوبة التربة ميدانياً قبل الزراعة، وأجّل البذار حتى أول مطر فعّال أو اروِ رية إنبات.',
        en: 'Check soil moisture in the field before planting; delay sowing until the first effective rain or apply a germination irrigation.',
      },
    })
  }
  const rank = { high: 0, moderate: 1, low: 2 }
  return risks.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export function buildEvidence(c: Climate, e: Evaluation): Evidence[] {
  const s = e.stats
  const per = `${c.firstYear}–${c.lastYear} · ${seasonLabel(e.crop, e.dekad).en}`
  const ev = (metric: string, ar: string, en: string, value: number | null, unit: string): Evidence => ({ metric, label: { ar, en }, value: value === null || !Number.isFinite(value) ? null : r1(value), unit, period: per, source: SRC })
  return [
    ev('seasonal_mean_temperature_c', 'متوسط حرارة الموسم', 'Seasonal mean temperature', s.tmean, '°C'),
    ev('seasonal_rainfall_mm', 'أمطار الموسم', 'Seasonal rainfall', s.rain, 'mm'),
    ev('rainfall_variability_cv', 'تذبذب الأمطار بين السنوات', 'Rainfall year-to-year variability (CV)', s.rainCV * 100, '%'),
    ev('years_meeting_min_rainfall_pct', 'مواسم حققت الحد الأدنى للمطر', 'Seasons meeting the minimum rainfall', e.rainReliability * 100, '%'),
    ev('root_zone_wetness_pct', 'رطوبة منطقة الجذور', 'Root-zone soil wetness', s.soilWetness === null ? null : s.soilWetness * 100, '%'),
    ev('solar_radiation_mj_m2_day', 'الإشعاع الشمسي', 'Solar radiation', s.rs, 'MJ/m²/day'),
    ev('growing_degree_days', 'درجات الحرارة المتراكمة', 'Growing degree days', s.gdd, '°C·d'),
    ev('frost_days', 'أيام الصقيع', 'Frost days', s.frostDays, 'days'),
    ev('heat_stress_days', 'أيام الإجهاد الحراري', 'Heat-stress days', s.heatDays, 'days'),
    ev('longest_dry_spell_days', 'أطول فترة جفاف', 'Longest dry spell', s.longestDrySpell, 'days'),
    ev('reference_et0_mm', 'التبخر المرجعي ET0', 'Reference ET0', s.et0, 'mm'),
    ev('crop_water_demand_etc_mm', 'احتياج المحصول ETc', 'Crop water demand ETc', s.etc, 'mm'),
    ev('irrigation_requirement_mm', 'احتياج الري', 'Irrigation requirement', s.irrigation, 'mm'),
  ]
}

export function buildExplanation(e: Evaluation, plot: PlotCtx): Bi {
  const { crop, stats: s, factors: f } = e
  const st = statusOf(e.score)
  const stAr = { highly_suitable: 'ملائم جداً', suitable: 'ملائم', marginal: 'ملائم بشروط', unsuitable: 'غير ملائم' }[st]
  const stEn = { highly_suitable: 'highly suitable', suitable: 'suitable', marginal: 'marginal', unsuitable: 'unsuitable' }[st]
  const T = crop.temp
  const waterAr = plot.irrigation_available
    ? `القطعة مروية، لذلك لا يُحتسب نقص المطر (${r0(s.rain)} ملم) عائقاً؛ احتياج الري المقدّر ${r0(s.irrigation)} ملم للموسم.`
    : `القطعة بعلية: أمطار الموسم ${r0(s.rain)} ملم مقابل نطاق مثالي ${crop.rain.opt_min.value}–${crop.rain.opt_max.value} ملم، وتحقق الحد الأدنى (${crop.rain.abs_min.value} ملم) في ${r0(e.rainReliability * 100)}٪ من المواسم.`
  const waterEn = plot.irrigation_available
    ? `The plot is irrigated, so the rainfall shortfall (${r0(s.rain)} mm) is not treated as limiting; estimated irrigation need is ${r0(s.irrigation)} mm for the season.`
    : `The plot is rainfed: seasonal rainfall is ${r0(s.rain)} mm against an optimal ${crop.rain.opt_min.value}–${crop.rain.opt_max.value} mm, and the minimum (${crop.rain.abs_min.value} mm) was met in ${r0(e.rainReliability * 100)}% of seasons.`
  const penAr = e.penalties.total > 0 ? ` خُصم ${r0(e.penalties.total)} نقطة بسبب المخاطر (صقيع ${r0(e.penalties.frost)}، حرارة ${r0(e.penalties.heat)}، فترات جفاف ${r0(e.penalties.dry_spell)}).` : ''
  const penEn = e.penalties.total > 0 ? ` ${r0(e.penalties.total)} points were deducted for risks (frost ${r0(e.penalties.frost)}, heat ${r0(e.penalties.heat)}, dry spells ${r0(e.penalties.dry_spell)}).` : ''
  return {
    ar: `${crop.name.ar} ${stAr} لهذه القطعة بدرجة ${r0(e.score)} من 100. متوسط حرارة الموسم ${r1(s.tmean)}°م مقابل نطاق مثالي ${T.opt_min.value}–${T.opt_max.value}°م (درجة الحرارة ${r0(f.temperature)}). ${waterAr} رطوبة منطقة الجذور ${s.soilWetness === null ? 'غير متوفرة' : r0(s.soilWetness * 100) + '٪'} والإشعاع الشمسي ${r1(s.rs)} ميجاجول/م²/يوم.${penAr}`,
    en: `${crop.name.en} is ${stEn} for this plot with a score of ${r0(e.score)} out of 100. Seasonal mean temperature is ${r1(s.tmean)} °C against an optimal ${T.opt_min.value}–${T.opt_max.value} °C (temperature score ${r0(f.temperature)}). ${waterEn} Root-zone wetness is ${s.soilWetness === null ? 'unavailable' : r0(s.soilWetness * 100) + '%'} and solar radiation ${r1(s.rs)} MJ/m²/day.${penEn}`,
  }
}

export function mainReason(e: Evaluation, plot: PlotCtx): Bi {
  const f = e.factors
  const entries: [keyof typeof f, number][] = [
    ['temperature', f.temperature],
    ['precipitation', f.precipitation],
    ['soil_moisture', f.soil_moisture],
    ['solar_radiation', f.solar_radiation],
  ]
  const worst = entries.reduce((a, b) => (b[1] < a[1] ? b : a))
  const s = e.stats
  if (e.score >= 60) {
    return plot.irrigation_available
      ? { ar: `الحرارة مناسبة (${r1(s.tmean)}°م) والري متاح؛ احتياج الري نحو ${r0(s.irrigation)} ملم.`, en: `Temperature fits (${r1(s.tmean)} °C) and irrigation is available; irrigation need is about ${r0(s.irrigation)} mm.` }
      : { ar: `الحرارة مناسبة (${r1(s.tmean)}°م) وأمطار الموسم ${r0(s.rain)} ملم تكفي في ${r0(e.rainReliability * 100)}٪ من السنوات.`, en: `Temperature fits (${r1(s.tmean)} °C) and seasonal rainfall of ${r0(s.rain)} mm is enough in ${r0(e.rainReliability * 100)}% of years.` }
  }
  const names: Record<string, Bi> = {
    temperature: { ar: `الحرارة (${r1(s.tmean)}°م) خارج النطاق المثالي ${e.crop.temp.opt_min.value}–${e.crop.temp.opt_max.value}°م`, en: `temperature (${r1(s.tmean)} °C) is outside the optimal ${e.crop.temp.opt_min.value}–${e.crop.temp.opt_max.value} °C` },
    precipitation: { ar: `أمطار الموسم (${r0(s.rain)} ملم) أقل من حاجة المحصول (${e.crop.rain.opt_min.value} ملم) ولا يوجد ري`, en: `seasonal rainfall (${r0(s.rain)} mm) is below the crop's need (${e.crop.rain.opt_min.value} mm) with no irrigation` },
    soil_moisture: { ar: `رطوبة التربة منخفضة (${s.soilWetness === null ? '—' : r0(s.soilWetness * 100)}٪)`, en: `soil moisture is low (${s.soilWetness === null ? '—' : r0(s.soilWetness * 100)}%)` },
    solar_radiation: { ar: `الإشعاع الشمسي (${r1(s.rs)} ميجاجول/م²/يوم) غير مثالي`, en: `solar radiation (${r1(s.rs)} MJ/m²/day) is not ideal` },
  }
  const n = names[worst[0]]
  return { ar: `العامل المحدِّد: ${n.ar}.`, en: `Limiting factor: ${n.en}.` }
}

export function buildRequirements(e: Evaluation, plot: PlotCtx): RequirementMatch[] {
  const { crop, stats: s } = e
  const within = (x: number, a: number, b: number, c: number, d: number): RequirementMatch['status'] => (x >= b && x <= c ? 'match' : x > a && x < d ? 'partial' : 'mismatch')
  const T = crop.temp
  const R = crop.rain
  const P = crop.ph
  const out: RequirementMatch[] = [
    {
      key: 'temperature',
      label: { ar: 'متوسط حرارة الموسم', en: 'Seasonal mean temperature' },
      required: `${T.opt_min.value}–${T.opt_max.value} °C (${T.abs_min.value}–${T.abs_max.value})`,
      observed: `${r1(s.tmean)} °C`,
      status: within(s.tmean, T.abs_min.value, T.opt_min.value, T.opt_max.value, T.abs_max.value),
      source: T.opt_min.source,
      needs_review: false,
    },
    {
      key: 'rainfall',
      label: { ar: 'أمطار الموسم', en: 'Seasonal rainfall' },
      required: `${R.opt_min.value}–${R.opt_max.value} mm (${R.abs_min.value}–${R.abs_max.value})`,
      observed: `${r0(s.rain)} mm${plot.irrigation_available ? ' + ' + (plot.irrigation_method ?? 'irrigation') : ''}`,
      status: plot.irrigation_available && s.rain < R.opt_min.value ? 'partial' : within(s.rain, R.abs_min.value, R.opt_min.value, R.opt_max.value, R.abs_max.value),
      source: R.opt_min.source,
      needs_review: false,
    },
    {
      key: 'water_demand',
      label: { ar: 'الاحتياج المائي للموسم (ETc)', en: 'Seasonal crop water demand (ETc)' },
      required: `Kc ${crop.kc.ini.value} / ${crop.kc.mid.value} / ${crop.kc.end.value}`,
      observed: `${r0(s.etc)} mm`,
      status: plot.irrigation_available || s.effRain >= s.etc * 0.8 ? 'match' : s.effRain >= s.etc * 0.5 ? 'partial' : 'mismatch',
      source: crop.kc.mid.source,
      needs_review: !!crop.kc.mid.needs_review,
    },
    {
      key: 'frost',
      label: { ar: 'تحمّل الصقيع (درجة القتل)', en: 'Frost (killing temperature)' },
      required: `${crop.killing_temp.value} °C`,
      observed: `${r1(s.absMinT)} °C · ${r1(s.frostDays)} d`,
      status: s.frostDays < 0.2 ? 'match' : s.absMinT > crop.killing_temp.value ? 'partial' : 'mismatch',
      source: crop.killing_temp.source,
      needs_review: !!crop.killing_temp.needs_review,
    },
    {
      key: 'season_length',
      label: { ar: 'طول الموسم', en: 'Season length' },
      required: `${crop.cycle_days.min.value}–${crop.cycle_days.max.value} d`,
      observed: `${crop.season_length.value} d`,
      status: 'match',
      source: crop.season_length.source,
      needs_review: !!crop.season_length.needs_review,
    },
    {
      key: 'soil_ph',
      label: { ar: 'حموضة التربة pH', en: 'Soil pH' },
      required: `${P.opt_min.value}–${P.opt_max.value} (${P.abs_min.value}–${P.abs_max.value})`,
      observed: plot.soil_ph === null ? '—' : String(plot.soil_ph),
      status: plot.soil_ph === null ? 'unknown' : within(plot.soil_ph, P.abs_min.value, P.opt_min.value, P.opt_max.value, P.abs_max.value),
      source: P.opt_min.source,
      needs_review: false,
    },
    {
      key: 'root_depth',
      label: { ar: 'عمق الجذور', en: 'Rooting depth' },
      required: `${crop.root_depth.value[0]}–${crop.root_depth.value[1]} m`,
      observed: '—',
      status: 'unknown',
      source: crop.root_depth.source,
      needs_review: !!crop.root_depth.needs_review,
    },
  ]
  return out
}

export function recommendedActions(e: Evaluation, risks: Risk[], plot: PlotCtx, win: { start: string; end: string } | null): Bi[] {
  const out: Bi[] = []
  if (win && !e.crop.perennial) out.push({ ar: `ازرع بين ${win.start} و ${win.end} حسب بيانات المناخ التاريخية.`, en: `Plant between ${win.start} and ${win.end} according to the historical climate record.` })
  if (plot.irrigation_available) out.push({ ar: `خطّط لنحو ${r0(e.stats.irrigation)} ملم من مياه الري خلال الموسم (ETc ${r0(e.stats.etc)} ملم ناقص المطر الفعّال ${r0(e.stats.effRain)} ملم).`, en: `Plan for about ${r0(e.stats.irrigation)} mm of irrigation over the season (ETc ${r0(e.stats.etc)} mm minus effective rain ${r0(e.stats.effRain)} mm).` })
  for (const r of risks.filter((x) => x.severity !== 'low').slice(0, 3)) out.push(r.action)
  if (plot.soil_ph === null) out.push({ ar: 'أجرِ فحص تربة (pH والملوحة) لتأكيد ملاءمة المحصول.', en: 'Run a soil test (pH and salinity) to confirm the crop fits.' })
  return out
}

export { dekadOf }
