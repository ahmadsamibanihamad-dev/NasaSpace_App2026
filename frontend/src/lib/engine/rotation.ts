/**
 * Rotation engine: always returns exactly three strategies —
 * the current rotation (scored as-is), Option A (soil-health focus) and Option B
 * (water-saving or income focus, following the farmer's priority).
 * Rules: avoid the same family in consecutive seasons; reward a legume after a non-legume
 * (nitrogen fixation); replace bare fallow with a cover/forage crop when water allows;
 * alternate rooting depths; require a minimum suitability for the plot.
 */
import type { Bi, CropHistoryItem, Evidence, RotationStrategy } from '../types'
import type { Climate } from '../climate/features'
import { ANNUAL_CROPS, CROPS, type CropKB } from './crops'
import { bestWindow, scanYear, type Evaluation, type PlotCtx } from './suitability'

export type Priority = 'save_water' | 'improve_soil' | 'increase_income'
const SEASONS_AHEAD = 3
const MIN_SUITABILITY = 40
const r0 = (x: number) => Math.round(x)
const clamp = (x: number) => Math.max(0, Math.min(100, x))
const rootClass = (c: CropKB) => (c.root_depth.value[1] <= 0.8 ? 'shallow' : c.root_depth.value[1] <= 1.3 ? 'medium' : 'deep')

export interface RotationInput {
  climate: Climate
  plot: PlotCtx & { current_crop_id: string | null; previous_crop_id: string | null }
  history: CropHistoryItem[]
  priority: Priority
  today?: Date
}

function nextSeasons(today: Date): string[] {
  // agricultural season runs autumn → summer; the "current" season starts in September
  const y = today.getUTCMonth() >= 8 ? today.getUTCFullYear() : today.getUTCFullYear() - 1
  return Array.from({ length: SEASONS_AHEAD }, (_, i) => `${y + 1 + i}-${y + 2 + i}`)
}

export function buildRotation(input: RotationInput): { strategies: RotationStrategy[]; seasons: string[] } {
  const { climate, plot, priority } = input
  const seasons = nextSeasons(input.today ?? new Date())
  const best = new Map<string, Evaluation>()
  for (const c of ANNUAL_CROPS) {
    const evals = scanYear(climate, c, plot)
    const w = bestWindow(evals)
    best.set(c.id, evals[w ? w.best : evals.reduce((b, e, i) => (e.score > evals[b].score ? i : b), 0)])
  }
  const suit = (id: string | null) => (id && best.has(id) ? best.get(id)!.score : null)

  // Past sequence, oldest → newest, ending with the crop in the ground now.
  const past: (string | null)[] = [...input.history].sort((a, b) => a.season.localeCompare(b.season)).map((h) => h.crop_id)
  if (!past.length && plot.previous_crop_id !== undefined) past.push(plot.previous_crop_id)
  past.push(plot.current_crop_id)
  const perennial = plot.current_crop_id ? CROPS[plot.current_crop_id]?.perennial : false

  const transitionScore = (prev: (string | null)[], cand: CropKB): number => {
    const p1 = prev[prev.length - 1] ? CROPS[prev[prev.length - 1]!] : null
    const p2 = prev[prev.length - 2] ? CROPS[prev[prev.length - 2]!] : null
    let s = 0
    if (p1 && p1.family === cand.family) s -= 40
    if (p2 && p2.family === cand.family) s -= 15
    if (cand.nitrogen_fixing && (!p1 || !p1.nitrogen_fixing)) s += 30
    if (p1 && rootClass(p1) !== rootClass(cand)) s += 12
    return s
  }

  const plan = (objective: 'soil' | 'water' | 'income', avoidFirst?: string | null): (string | null)[] => {
    const seq: (string | null)[] = []
    for (let i = 0; i < SEASONS_AHEAD; i++) {
      const prev = [...past, ...seq]
      let pick: { id: string; v: number } | null = null
      for (const c of ANNUAL_CROPS) {
        const e = best.get(c.id)!
        if (e.score < MIN_SUITABILITY) continue
        if (i === 0 && avoidFirst === c.id) continue
        let v = transitionScore(prev, c)
        if (objective === 'soil') v = v * 1.3 + e.score * 0.3
        else if (objective === 'water') v = v * 0.7 + e.score * 0.35 - (plot.irrigation_available ? e.stats.irrigation : e.stats.etc) * 0.06
        else v = v * 0.7 + e.score * 0.4 + c.income.value * 14
        if (!pick || v > pick.v) pick = { id: c.id, v }
      }
      seq.push(pick ? pick.id : null)
    }
    return seq
  }

  // Current rotation continued as-is: repeat the recent pattern.
  const pattern = past.slice(-Math.min(3, past.length))
  const current = Array.from({ length: SEASONS_AHEAD }, (_, i) => pattern[i % pattern.length])
  const bObjective: 'water' | 'income' = priority === 'increase_income' ? 'income' : 'water'
  const optionA = plan('soil')
  let optionB = plan(bObjective)
  // The two options must be real alternatives: if both objectives pick the same sequence, start B with a different crop.
  if (optionB.join() === optionA.join()) {
    const alt = plan(bObjective, optionA[0])
    if (alt[0] !== null) optionB = alt
  }
  const seqs: Record<RotationStrategy['key'], (string | null)[]> = perennial ? { current, option_a: current, option_b: current } : { current, option_a: optionA, option_b: optionB }

  const score = (seq: (string | null)[]) => {
    const full = [...past.slice(-1), ...seq]
    let soil = 55
    let etc = 0
    let income = 0
    for (let i = 1; i < full.length; i++) {
      const cur = full[i] ? CROPS[full[i]!] : null
      const prev = full[i - 1] ? CROPS[full[i - 1]!] : null
      if (!cur) {
        soil -= 8 // bare fallow: no cover, no residues
        continue
      }
      const e = best.get(cur.id)
      etc += e ? e.stats.etc : 0
      income += ((cur.income.value / 3) * (e ? e.score : 50)) / 1
      if (cur.nitrogen_fixing) soil += 12
      if (prev && prev.family === cur.family) soil -= 15
      else if (prev) soil += 5
      if (prev && rootClass(prev) !== rootClass(cur)) soil += 5
    }
    const meanEtc = etc / seq.length
    return {
      water_use: r0(clamp(100 - ((meanEtc - 150) / 750) * 100)),
      soil_health: r0(clamp(soil)),
      income_potential: r0(clamp(income / seq.length)),
      meanEtc,
    }
  }

  const name = (id: string | null, l: 'ar' | 'en') => (id ? CROPS[id]?.name[l] ?? id : l === 'ar' ? 'بور' : 'fallow')
  const seqText = (seq: (string | null)[], l: 'ar' | 'en') => seq.map((x) => name(x, l)).join(l === 'ar' ? ' ← ' : ' → ')
  const rainEv = best.get('wheat')!.stats

  const gaps = (): Bi[] => {
    const g: Bi[] = []
    if (plot.soil_ph === null || !plot.soil_type) g.push({ ar: 'لا يوجد فحص تربة للقطعة (pH، نوع التربة، الملوحة، المادة العضوية).', en: 'No soil test for this plot (pH, texture, salinity, organic matter).' })
    if (input.history.length < 2) g.push({ ar: 'سجل المحاصيل أقل من موسمين؛ أضف المواسم السابقة لتقييم أدق.', en: 'Crop history covers fewer than two seasons; add earlier seasons for a better assessment.' })
    g.push({ ar: 'إمكانية الدخل مؤشر نسبي لا يشمل أسعار السوق الحالية ولا تكاليف الإنتاج.', en: 'Income potential is a relative indicator that excludes current market prices and production costs.' })
    g.push({ ar: 'رطوبة التربة والأمطار مقدَّرة من بيانات مناخية على مستوى المنطقة، وليست قياساً ميدانياً في القطعة نفسها.', en: 'Soil moisture and rainfall are estimated from area-level climate data, not measured in the plot itself.' })
    if (plot.irrigation_available) g.push({ ar: 'كمية مياه الري المتاحة فعلياً ونوعيتها (الملوحة) غير معروفة.', en: 'The actual quantity and quality (salinity) of irrigation water are unknown.' })
    return g
  }
  const reviewRisks = (seq: (string | null)[]): Bi[] => {
    const out: Bi[] = [{ ar: 'تأكيد مواعيد الزراعة والأصناف المناسبة للمنطقة.', en: 'Confirm planting dates and varieties suited to the area.' }]
    const fams = seq.map((x) => (x ? CROPS[x]?.family : null))
    if (fams.some((f, i) => f && f === fams[i - 1])) out.push({ ar: 'تكرار العائلة النباتية نفسها في موسمين متتاليين قد يزيد أمراض التربة والآفات.', en: 'Repeating the same plant family in consecutive seasons may increase soil-borne diseases and pests.' })
    if (fams.includes('Solanaceae')) out.push({ ar: 'محاصيل العائلة الباذنجانية (بندورة، بطاطا، باذنجان) حساسة لأمراض التربة والنيماتودا؛ راجع تاريخ الإصابات.', en: 'Solanaceae crops (tomato, potato, eggplant) are sensitive to soil-borne diseases and nematodes; review the infection history.' })
    if (seq.some((x) => x && CROPS[x]?.nitrogen_fixing)) out.push({ ar: 'نجاح تثبيت النيتروجين في البقوليات يعتمد على وجود بكتيريا العقد الجذرية؛ قد يلزم التلقيح.', en: 'Nitrogen fixation by legumes depends on the right rhizobia being present; inoculation may be needed.' })
    if (seq.some((x) => x === null)) out.push({ ar: 'البور المكشوف يعرّض التربة للانجراف وفقد الرطوبة؛ ناقش بدائل التغطية.', en: 'Bare fallow exposes soil to erosion and moisture loss; discuss cover options.' })
    if (!plot.irrigation_available) out.push({ ar: 'الزراعة البعلية تتأثر بتذبذب الأمطار بين السنوات؛ ناقش خيارات الري التكميلي.', en: 'Rainfed cropping depends on year-to-year rainfall; discuss supplemental irrigation options.' })
    return out
  }

  const build = (key: RotationStrategy['key'], focus: string, title: Bi): RotationStrategy => {
    const seq = seqs[key]
    const sc = score(seq)
    const cur = score(seqs.current)
    const legumes = seq.filter((x) => x && CROPS[x]?.nitrogen_fixing).length
    const repeats = seq.filter((x, i) => x && (i ? seq[i - 1] : past[past.length - 1]) && CROPS[x]!.family === CROPS[(i ? seq[i - 1] : past[past.length - 1])!]?.family).length
    const why: Bi[] = []
    if (perennial) {
      why.push({ ar: 'القطعة مزروعة بأشجار معمّرة، لذلك لا تنطبق الدورة الزراعية السنوية؛ تبقى الأشجار في كل الاستراتيجيات.', en: 'The plot carries perennial trees, so an annual rotation does not apply; the trees stay in every strategy.' })
    } else if (key === 'current') {
      why.push({ ar: `استمرار النمط الحالي: ${seqText(seq, 'ar')}، ويُقيَّم كما هو دون تغيير.`, en: `Continuing the current pattern: ${seqText(seq, 'en')}, scored as-is.` })
      if (repeats) why.push({ ar: `يتكرر المحصول أو عائلته في ${repeats} موسم متتالٍ.`, en: `The crop or its family repeats in ${repeats} consecutive season(s).` })
    } else if (key === 'option_a') {
      why.push({ ar: `تركّز على صحة التربة: ${legumes} موسم بقوليات لتثبيت النيتروجين، مع تجنب تكرار العائلة النباتية وتبديل أعماق الجذور.`, en: `Soil-health focus: ${legumes} legume season(s) for nitrogen fixation, avoiding repeated plant families and alternating rooting depths.` })
      why.push({ ar: 'اختيرت فقط المحاصيل التي تتجاوز ملاءمتها 40 من 100 لهذه القطعة.', en: 'Only crops scoring above 40/100 for this plot were considered.' })
    } else {
      why.push(
        bObjective === 'income'
          ? { ar: 'تتبع أولويتك «زيادة الدخل»: تفضّل المحاصيل ذات مؤشر الدخل الأعلى والملاءمة الجيدة، مع احترام قاعدة عدم تكرار العائلة.', en: 'Follows your "increase income" priority: prefers crops with a higher income indicator and good suitability, still avoiding repeated families.' }
          : { ar: 'تتبع أولوية «توفير المياه»: تفضّل المحاصيل الأقل احتياجاً للماء (ETc) والملائمة للقطعة، مع احترام قاعدة عدم تكرار العائلة.', en: 'Follows the "save water" priority: prefers crops with lower water demand (ETc) that fit the plot, still avoiding repeated families.' },
      )
    }
    const evidence: Evidence[] = [
      ...seq
        .filter((x, i) => x && seq.indexOf(x) === i)
        .map((x) => {
          const e = best.get(x!)
          return { metric: `suitability_${x}`, label: { ar: `ملاءمة ${name(x, 'ar')}`, en: `${name(x, 'en')} suitability` }, value: e ? r0(e.score) : null, unit: '/100', period: `${climate.firstYear}–${climate.lastYear}`, source: 'NASA POWER + FAO ECOCROP' } as Evidence
        }),
      { metric: 'mean_seasonal_etc_mm', label: { ar: 'متوسط الاحتياج المائي الموسمي', en: 'Mean seasonal water demand (ETc)' }, value: r0(sc.meanEtc), unit: 'mm', period: `${climate.firstYear}–${climate.lastYear}`, source: 'NASA POWER + FAO-56' },
      { metric: 'winter_season_rainfall_mm', label: { ar: 'أمطار الموسم الشتوي', en: 'Winter-season rainfall' }, value: r0(rainEv.rain), unit: 'mm', period: `${climate.firstYear}–${climate.lastYear}`, source: 'NASA POWER' },
    ]
    const benefits: Bi[] = []
    if (key === 'current') {
      benefits.push({ ar: 'لا تغيير في الممارسات أو المعدات أو التسويق.', en: 'No change in practices, equipment or marketing.' })
    } else {
      const d = (a: number, b: number) => (a - b >= 0 ? `+${a - b}` : `${a - b}`)
      benefits.push({ ar: `مقارنة بالدورة الحالية: صحة التربة ${d(sc.soil_health, cur.soil_health)}، كفاءة المياه ${d(sc.water_use, cur.water_use)}، إمكانية الدخل ${d(sc.income_potential, cur.income_potential)} نقطة.`, en: `Versus the current rotation: soil health ${d(sc.soil_health, cur.soil_health)}, water efficiency ${d(sc.water_use, cur.water_use)}, income potential ${d(sc.income_potential, cur.income_potential)} points.` })
      if (legumes) benefits.push({ ar: 'البقوليات تثبّت النيتروجين الجوي وتترك جزءاً منه للمحصول التالي.', en: 'Legumes fix atmospheric nitrogen and leave part of it for the following crop.' })
      if (!repeats) benefits.push({ ar: 'تبديل العائلات النباتية يكسر دورات الآفات وأمراض التربة.', en: 'Changing plant families breaks pest and soil-borne disease cycles.' })
    }
    return {
      key,
      title,
      focus,
      sequence: seq.map((x, i) => ({ season: seasons[i], crop: x, suitability_score: suit(x) === null ? null : r0(suit(x)!) })),
      scores: { water_use: sc.water_use, soil_health: sc.soil_health, income_potential: sc.income_potential },
      why,
      evidence,
      benefits,
      information_gaps: gaps(),
      risks_for_review: reviewRisks(seq),
    }
  }

  return {
    seasons,
    strategies: [
      build('current', 'current', { ar: 'الدورة الحالية', en: 'Current rotation' }),
      build('option_a', 'soil_health', { ar: 'الخيار أ: صحة التربة', en: 'Option A: soil health' }),
      build('option_b', bObjective, bObjective === 'income' ? { ar: 'الخيار ب: زيادة الدخل', en: 'Option B: higher income' } : { ar: 'الخيار ب: توفير المياه', en: 'Option B: water saving' }),
    ],
  }
}
