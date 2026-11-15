"""Transparent rule-based suitability engine (no black box).

Port of frontend/src/lib/engine/suitability.ts; tests/test_engine_parity.py keeps both in step.

How a score is built
- temperature: the crop's ECOCROP trapezoid applied to every day's mean temperature, averaged over
  the season (trees: annual mean and coldest month).
- water: share of crop water demand (ETc, FAO-56) met by effective rainfall, weighted by rainfall
  reliability and sowing-period rain; irrigation removes a rainfall-deficit penalty.
- soil moisture and solar radiation: generic trapezoids.
- overall: weighted combination, limited by the weaker of temperature / water, minus risk penalties.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.engine.config import cfg, status_of, trapezoid, trapezoid_array
from app.engine.features import (
    DEKADS,
    Climate,
    SeasonParams,
    SeasonStats,
    coldest_month_mean,
    dekad_probabilities,
    dekad_start,
    fraction_of_years_meeting,
    r0,
    r1,
    season_stats,
)

MONTHS_AR = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"]
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SRC = "NASA POWER"


@dataclass
class PlotCtx:
    irrigation_available: bool = False
    irrigation_method: Optional[str] = None
    soil_ph: Optional[float] = None
    soil_type: Optional[str] = None
    soil_ph_from_lab: bool = False

    @property
    def key(self) -> str:
        return self.irrigation_method or "surface" if self.irrigation_available else "rainfed"


@dataclass
class Evaluation:
    crop: dict
    dekad: int
    stats: SeasonStats
    factors: dict
    rain_score: float
    rain_reliability: float
    penalties: dict
    score: float


def v(crop: dict, *path: str):
    cur = crop
    for p in path:
        cur = cur[p]
    return cur["value"]


def _limits(group: dict) -> tuple[float, float, float, float]:
    return group["abs_min"]["value"], group["opt_min"]["value"], group["opt_max"]["value"], group["abs_max"]["value"]


def evaluate(c: Climate, crop: dict, dekad: int, plot: PlotCtx) -> Evaluation:
    k = cfg()
    T = _limits(crop["temp"])
    R = _limits(crop["rain"])
    perennial = crop["perennial"]
    month, day = (1, 1) if perennial else dekad_start(dekad)
    stats = season_stats(
        c,
        SeasonParams(
            start_month=month,
            start_day=day,
            length_days=v(crop, "season_length"),
            t_base=v(crop, "base_temp"),
            heat_threshold=v(crop, "heat_threshold"),
            kc={"ini": v(crop, "kc", "ini"), "mid": v(crop, "kc", "mid"), "end": v(crop, "kc", "end")},
            stages=list(v(crop, "stages")),
            temp_suitability=lambda t: trapezoid_array(t, *T),
        ),
    )
    if perennial:
        # a tree must suit the average year AND get through the coldest month
        temperature = (trapezoid(stats.tmean, *T) + trapezoid(coldest_month_mean(c), *T)) / 2
    else:
        temperature = stats.temp_score if math.isfinite(stats.temp_score) else 0.0
    # trees are scored on annual rainfall against the (annual) ECOCROP range; annual crops on water satisfaction
    rain_score = trapezoid(stats.rain, *R) if perennial else stats.water_satisfaction * 100
    rain_reliability = fraction_of_years_meeting(stats, R[0])
    irrigated = plot.irrigation_available
    deficit = stats.rain < R[1] if perennial else stats.water_satisfaction < 0.95
    precipitation = rain_score * (0.7 + 0.3 * rain_reliability)
    if not irrigated and not perennial:
        w = k["ESTABLISHMENT_WEIGHT"]
        precipitation *= 1 - w + w * stats.establishment  # rainfed annual crops need rain at sowing
    if stats.rain > R[2]:
        precipitation = min(precipitation, trapezoid(stats.rain, *R))  # too much rain is limiting too
    if irrigated and deficit:
        precipitation = max(precipitation, k["IRRIGATION_FLOOR"].get(plot.irrigation_method or "surface", 85))
    sw_lim = k["SOIL_WETNESS_LIMITS"]
    soil = 50.0 if stats.soil_wetness is None else trapezoid(stats.soil_wetness, *sw_lim)
    if irrigated and stats.soil_wetness is not None and stats.soil_wetness < sw_lim[1]:
        soil = max(soil, k["IRRIGATED_SOIL_FLOOR"])
    solar = trapezoid(stats.rs, *k["SOLAR_LIMITS"])
    factors = {"temperature": temperature, "precipitation": precipitation, "soil_moisture": soil, "solar_radiation": solar}
    W = k["WEIGHTS"]
    base = temperature * W["temperature"] + precipitation * W["precipitation"] + soil * W["soil_moisture"] + solar * W["solar_radiation"]

    P = k["PENALTY"]
    frost = min(P["frostCap"], stats.frost_days * P["frostPerDay"][v(crop, "frost_tolerance")])
    heat = min(P["heatCap"], stats.heat_days * P["heatPerDay"])
    if irrigated or perennial:
        dry = 0.0
    else:
        dry = min(P["drySpellCap"], max(0.0, stats.longest_dry_spell - P["drySpellFreeDays"]) * P["drySpellPerDay"] * P["drySpellTolerance"][v(crop, "drought_tolerance")])
    total = min(P["totalCap"], frost + heat + dry)
    # limiting-factor rule (Liebig): soil moisture or radiation cannot compensate for unsuitable temperature or water
    limited = min(base, min(temperature, precipitation) + k["LIMITING_MARGIN"])
    score = 0.0 if stats.n == 0 else max(0.0, min(100.0, limited - total))
    if score != score:  # NaN guard when the record is too short
        score = 0.0
    return Evaluation(crop, dekad, stats, factors, rain_score, rain_reliability, {"frost": frost, "heat": heat, "dry_spell": dry, "total": total}, score)


def scan_year(c: Climate, crop: dict, plot: PlotCtx) -> list[Evaluation]:
    """Evaluate every 10-day planting period of the year."""
    if crop["perennial"]:
        e = evaluate(c, crop, 0, plot)
        return [Evaluation(e.crop, k, e.stats, e.factors, e.rain_score, e.rain_reliability, e.penalties, e.score) for k in range(DEKADS)]
    return [evaluate(c, crop, k, plot) for k in range(DEKADS)]


def best_index(evals: list[Evaluation]) -> int:
    best = 0
    for i, e in enumerate(evals):
        if e.score > evals[best].score:
            best = i
    return best


def best_window(evals: list[Evaluation]) -> Optional[dict]:
    """Best contiguous run of dekads around the maximum (within 5 points of it, and at least marginal)."""
    best = best_index(evals)
    top = evals[best].score
    if top < 40:
        return None
    ok = lambda i: evals[(i + DEKADS) % DEKADS].score >= max(40, top - 5)  # noqa: E731
    start = end = best
    guard = 0
    while ok(start - 1) and guard < DEKADS - 1:
        guard += 1
        start -= 1
    while ok(end + 1) and end - start < DEKADS - 1:
        end += 1
    return {"start": (start + DEKADS) % DEKADS, "end": (end + DEKADS) % DEKADS, "best": best}


def _utc(y: int, month: int, day: int) -> datetime:
    """Date.UTC semantics: the day may overflow into the next month."""
    return datetime(y, month, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)


def window_dates(start: int, end: int, today: Optional[datetime] = None) -> dict:
    """Next calendar occurrence (from `today`) of a dekad range."""
    today = today or datetime.now(timezone.utc)
    sm, sd_ = dekad_start(start)
    y = today.year
    sd = _utc(y, sm, sd_)
    span = ((end - start + DEKADS) % DEKADS) + 1
    lm, ld = dekad_start((start + span - 1) % DEKADS)

    def end_of(frm: datetime) -> datetime:
        ed = _utc(frm.year, lm, ld + 9)
        if ed < frm:
            ed = _utc(frm.year + 1, lm, ld + 9)
        return ed

    if end_of(sd) < today:
        sd = _utc(y + 1, sm, sd_)
    return {"start": sd.date().isoformat(), "end": end_of(sd).date().isoformat()}


def period_scores(evals: list[Evaluation], year: int) -> list[dict]:
    out = []
    for e in evals:
        m, d = dekad_start(e.dekad)
        out.append({"period": f"{m:02d}-{d:02d}", "start": f"{year}-{m:02d}-{d:02d}", "score": r0(e.score)})
    return out


def water_demand_level(etc: float) -> int:
    bins = cfg()["WATER_DEMAND_BINS"]
    return 1 if etc < bins[0] else 2 if etc < bins[1] else 3


def season_label(crop: dict, dekad: int) -> dict:
    if crop["perennial"]:
        return {"ar": "على مدار السنة", "en": "Whole year"}
    m, d = dekad_start(dekad)
    end_m = (m - 1 + int(math.floor((d - 1 + v(crop, "season_length")) / 30.4))) % 12
    return {"ar": f"{MONTHS_AR[m - 1]} – {MONTHS_AR[end_m]}", "en": f"{MONTHS_EN[m - 1]} – {MONTHS_EN[end_m]}"}


def _sev(value: float, t: dict) -> str:
    return "high" if value >= t["high"] else "moderate" if value >= t["moderate"] else "low"


def _num(x) -> str:
    """Number formatting like JS template literals (20 not 20.0)."""
    return str(int(x)) if float(x).is_integer() else str(x)


def build_risks(c: Climate, e: Evaluation, plot: PlotCtx, soil_anomaly: Optional[float]) -> list[dict]:
    RISK = cfg()["RISK"]
    crop, s = e.crop, e.stats
    ar, en = crop["name"]["ar"], crop["name"]["en"]
    period = season_label(crop, e.dekad)
    years = s.n
    risks: list[dict] = []

    if s.frost_days >= 0.2:
        tol = {"low": 1, "moderate": 0.6, "high": 0.3}[v(crop, "frost_tolerance")]
        probs = dekad_probabilities_cached(c, v(crop, "heat_threshold"))["frost"]
        months = []
        for k, p in enumerate(probs):
            if p >= 0.2 and k // 3 not in months:
                months.append(k // 3)
        per = {"ar": "، ".join(MONTHS_AR[m] for m in months), "en": ", ".join(MONTHS_EN[m] for m in months)} if months else period
        risks.append({
            "type": "frost",
            "severity": _sev(s.frost_days * tol, RISK["frostDays"]),
            "period": per,
            "explanation": {
                "ar": f"في المتوسط {r1(s.frost_days)} يوم صقيع (الصغرى دون 0°م) خلال موسم {ar}، وحدث الصقيع في {r0(s.frost_year_fraction * 100)}٪ من {years} موسماً. أدنى حرارة مسجلة {r1(s.abs_min_t)}°م.",
                "en": f"On average {r1(s.frost_days)} frost days (Tmin below 0 °C) occur during the {en} season, and frost occurred in {r0(s.frost_year_fraction * 100)}% of {years} seasons. Lowest recorded temperature: {r1(s.abs_min_t)} °C.",
            },
            "action": {
                "ar": "أخّر الزراعة إلى ما بعد فترة الصقيع إن أمكن، وغطِّ الشتلات الحساسة أو اروِ رياً خفيفاً قبل الليالي الباردة.",
                "en": "Delay planting until after the frost period where possible; cover sensitive seedlings or irrigate lightly before cold nights.",
            },
        })
    if s.heat_days >= 1:
        thr = _num(v(crop, "heat_threshold"))
        risks.append({
            "type": "heat_stress",
            "severity": _sev(s.heat_days, RISK["heatDays"]),
            "period": period,
            "explanation": {
                "ar": f"في المتوسط {r1(s.heat_days)} يوماً يتجاوز فيها متوسط الحرارة اليومي {thr}°م (الحد الأعلى لـ{ar}) خلال الموسم.",
                "en": f"On average {r1(s.heat_days)} days have a daily mean temperature above {thr} °C (the upper limit for {en}) during the season.",
            },
            "action": {
                "ar": "بكّر موعد الزراعة لتجنب الحر في مرحلة الإزهار، واروِ في الصباح الباكر، واستخدم التغطية (الملش) أو التظليل للخضار.",
                "en": "Plant earlier so flowering avoids the heat, irrigate in the early morning, and use mulch or shading for vegetables.",
            },
        })
    if not plot.irrigation_available and (e.rain_reliability < 1 or s.water_satisfaction < 0.6):
        rr = RISK["rainReliability"]
        if e.rain_reliability < rr["high"] or s.water_satisfaction < 0.4:
            sev = "high"
        elif e.rain_reliability < rr["moderate"] or s.water_satisfaction < 0.6:
            sev = "moderate"
        else:
            sev = "low"
        rmin = _num(v(crop, "rain", "abs_min"))
        risks.append({
            "type": "drought",
            "severity": sev,
            "period": period,
            "explanation": {
                "ar": f"متوسط أمطار الموسم {r0(s.rain)} ملم يغطي {r0(s.water_satisfaction * 100)}٪ من الاحتياج المائي لـ{ar} ({r0(s.etc)} ملم). الحد الأدنى للمطر ({rmin} ملم) تحقق في {r0(e.rain_reliability * 100)}٪ من {years} موسماً، والقطعة بعلية.",
                "en": f"Mean seasonal rainfall of {r0(s.rain)} mm covers {r0(s.water_satisfaction * 100)}% of the water demand of {en} ({r0(s.etc)} mm). The minimum rainfall ({rmin} mm) was met in {r0(e.rain_reliability * 100)}% of {years} seasons, and the plot is rainfed.",
            },
            "action": {
                "ar": "وفّر رياً تكميلياً إن أمكن، أو اختر محصولاً أكثر تحملاً للجفاف، واعتمد الحصاد المائي وتقليل الحراثة لحفظ رطوبة التربة.",
                "en": "Provide supplemental irrigation if possible, or choose a more drought-tolerant crop; use water harvesting and reduced tillage to conserve soil moisture.",
            },
        })
    ds = RISK["drySpellDays"]
    if not plot.irrigation_available and not crop["perennial"] and s.longest_dry_spell >= ds["moderate"]:
        risks.append({
            "type": "dry_spell",
            "severity": _sev(s.longest_dry_spell, ds),
            "period": period,
            "explanation": {
                "ar": f"أطول فترة متتالية بلا مطر (أقل من 1 ملم/يوم) خلال الموسم تبلغ في المتوسط {r0(s.longest_dry_spell)} يوماً.",
                "en": f"The longest run of consecutive dry days (under 1 mm/day) during the season averages {r0(s.longest_dry_spell)} days.",
            },
            "action": {
                "ar": "خطّط لرية تكميلية في المراحل الحساسة (الإنبات والإزهار)، وحافظ على غطاء التربة.",
                "en": "Plan a supplemental irrigation at sensitive stages (emergence and flowering) and keep the soil covered.",
            },
        })
    er = RISK["extremeRainDays"]
    if s.extreme_rain_days >= er["moderate"] or s.rain > v(crop, "rain", "opt_max"):
        r95 = r0(c.r95) if math.isfinite(c.r95) else 0
        risks.append({
            "type": "excessive_rainfall",
            "severity": "high" if s.rain > v(crop, "rain", "abs_max") else _sev(s.extreme_rain_days, er),
            "period": period,
            "explanation": {
                "ar": f"في المتوسط {r1(s.extreme_rain_days)} يوماً في الموسم يتجاوز فيها المطر {r95} ملم/يوم (أعلى 5٪ من الأيام الماطرة محلياً). مجموع أمطار الموسم {r0(s.rain)} ملم.",
                "en": f"On average {r1(s.extreme_rain_days)} days per season exceed {r95} mm/day (the local top 5% of wet days). Seasonal rainfall totals {r0(s.rain)} mm.",
            },
            "action": {
                "ar": "تأكد من تصريف المياه في القطعة، وتجنب الزراعة في المنخفضات، وافتح قنوات تصريف قبل موسم الأمطار.",
                "en": "Make sure the plot drains well, avoid planting in low spots, and open drainage channels before the rainy season.",
            },
        })
    sa = RISK["soilWetnessAnomaly"]
    if soil_anomaly is not None and soil_anomaly <= sa["moderate"]:
        pts = r0(abs(soil_anomaly) * 100)
        risks.append({
            "type": "low_soil_moisture",
            "severity": "high" if soil_anomaly <= sa["high"] else "moderate",
            "period": {"ar": "آخر 30 يوماً", "en": "Last 30 days"},
            "explanation": {
                "ar": f"رطوبة منطقة الجذور في آخر 30 يوماً أقل من معدلها لهذا الوقت من السنة بـ {pts} نقطة مئوية.",
                "en": f"Root-zone wetness over the last 30 days is {pts} percentage points below normal for this time of year.",
            },
            "action": {
                "ar": "افحص رطوبة التربة ميدانياً قبل الزراعة، وأجّل البذار حتى أول مطر فعّال أو اروِ رية إنبات.",
                "en": "Check soil moisture in the field before planting; delay sowing until the first effective rain or apply a germination irrigation.",
            },
        })
    rank = {"high": 0, "moderate": 1, "low": 2}
    return sorted(risks, key=lambda r: rank[r["severity"]])


def dekad_probabilities_cached(c: Climate, heat_threshold: float) -> dict:
    key = ("dekad", heat_threshold)
    if key not in c._cache:
        c._cache[key] = dekad_probabilities(c, heat_threshold)
    return c._cache[key]


def build_evidence(c: Climate, e: Evaluation) -> list[dict]:
    s = e.stats
    per = f"{c.first_year}–{c.last_year}"

    def ev(metric, ar, en, value, unit):
        ok = value is not None and math.isfinite(value)
        return {"metric": metric, "label": {"ar": ar, "en": en}, "value": r1(value) if ok else None, "unit": unit, "period": per, "source": SRC}

    return [
        ev("seasonal_mean_temperature_c", "متوسط حرارة الموسم", "Seasonal mean temperature", s.tmean, "°C"),
        ev("seasonal_rainfall_mm", "أمطار الموسم", "Seasonal rainfall", s.rain, "mm"),
        ev("rainfall_variability_cv", "تذبذب الأمطار بين السنوات", "Rainfall year-to-year variability (CV)", s.rain_cv * 100, "%"),
        ev("water_demand_met_by_rain_pct", "نسبة تلبية الاحتياج المائي بالمطر", "Water demand met by rainfall", s.water_satisfaction * 100, "%"),
        ev("sowing_rain_adequacy_pct", "كفاية أمطار فترة الإنبات", "Sowing-period rain adequacy", s.establishment * 100, "%"),
        ev("years_meeting_min_rainfall_pct", "مواسم حققت الحد الأدنى للمطر", "Seasons meeting the minimum rainfall", e.rain_reliability * 100, "%"),
        ev("root_zone_wetness_pct", "رطوبة منطقة الجذور", "Root-zone soil wetness", None if s.soil_wetness is None else s.soil_wetness * 100, "%"),
        ev("solar_radiation_mj_m2_day", "الإشعاع الشمسي", "Solar radiation", s.rs, "MJ/m²/day"),
        ev("growing_degree_days", "درجات الحرارة المتراكمة", "Growing degree days", s.gdd, "°C·d"),
        ev("frost_days", "أيام الصقيع", "Frost days", s.frost_days, "days"),
        ev("heat_stress_days", "أيام الإجهاد الحراري", "Heat-stress days", s.heat_days, "days"),
        ev("longest_dry_spell_days", "أطول فترة جفاف", "Longest dry spell", s.longest_dry_spell, "days"),
        ev("reference_et0_mm", "التبخر المرجعي ET0", "Reference ET0", s.et0, "mm"),
        ev("crop_water_demand_etc_mm", "احتياج المحصول ETc", "Crop water demand ETc", s.etc, "mm"),
        ev("irrigation_requirement_mm", "احتياج الري", "Irrigation requirement", s.irrigation, "mm"),
    ]


def build_explanation(e: Evaluation, plot: PlotCtx) -> dict:
    crop, s, f = e.crop, e.stats, e.factors
    st = status_of(e.score)
    st_ar = {"highly_suitable": "ملائم جداً", "suitable": "ملائم", "marginal": "ملائم بشروط", "unsuitable": "غير ملائم"}[st]
    st_en = {"highly_suitable": "highly suitable", "suitable": "suitable", "marginal": "marginal", "unsuitable": "unsuitable"}[st]
    tmin, tmax = _num(v(crop, "temp", "opt_min")), _num(v(crop, "temp", "opt_max"))
    rmin = _num(v(crop, "rain", "abs_min"))
    if plot.irrigation_available:
        w_ar = f"القطعة مروية، لذلك لا يُحتسب نقص المطر ({r0(s.rain)} ملم) عائقاً؛ احتياج الري المقدّر {r0(s.irrigation)} ملم للموسم."
        w_en = f"The plot is irrigated, so the rainfall shortfall ({r0(s.rain)} mm) is not treated as limiting; estimated irrigation need is {r0(s.irrigation)} mm for the season."
    else:
        w_ar = f"القطعة بعلية: أمطار الموسم {r0(s.rain)} ملم تغطي {r0(s.water_satisfaction * 100)}٪ من احتياج المحصول المائي ({r0(s.etc)} ملم)، وتحقق الحد الأدنى للمطر ({rmin} ملم) في {r0(e.rain_reliability * 100)}٪ من المواسم."
        w_en = f"The plot is rainfed: seasonal rainfall of {r0(s.rain)} mm covers {r0(s.water_satisfaction * 100)}% of the crop's water demand ({r0(s.etc)} mm), and the minimum rainfall ({rmin} mm) was met in {r0(e.rain_reliability * 100)}% of seasons."
    p = e.penalties
    pen_ar = f" خُصم {r0(p['total'])} نقطة بسبب المخاطر (صقيع {r0(p['frost'])}، حرارة {r0(p['heat'])}، فترات جفاف {r0(p['dry_spell'])})." if p["total"] > 0 else ""
    pen_en = f" {r0(p['total'])} points were deducted for risks (frost {r0(p['frost'])}, heat {r0(p['heat'])}, dry spells {r0(p['dry_spell'])})." if p["total"] > 0 else ""
    sw_ar = "غير متوفرة" if s.soil_wetness is None else f"{r0(s.soil_wetness * 100)}٪"
    sw_en = "unavailable" if s.soil_wetness is None else f"{r0(s.soil_wetness * 100)}%"
    return {
        "ar": f"{crop['name']['ar']} {st_ar} لهذه القطعة بدرجة {r0(e.score)} من 100. متوسط حرارة الموسم {r1(s.tmean)}°م مقابل نطاق مثالي {tmin}–{tmax}°م (درجة الحرارة {r0(f['temperature'])}). {w_ar} رطوبة منطقة الجذور {sw_ar} والإشعاع الشمسي {r1(s.rs)} ميجاجول/م²/يوم.{pen_ar}",
        "en": f"{crop['name']['en']} is {st_en} for this plot with a score of {r0(e.score)} out of 100. Seasonal mean temperature is {r1(s.tmean)} °C against an optimal {tmin}–{tmax} °C (temperature score {r0(f['temperature'])}). {w_en} Root-zone wetness is {sw_en} and solar radiation {r1(s.rs)} MJ/m²/day.{pen_en}",
    }


def main_reason(e: Evaluation, plot: PlotCtx) -> dict:
    f, s, crop = e.factors, e.stats, e.crop
    if e.score >= 60:
        if plot.irrigation_available:
            return {"ar": f"الحرارة مناسبة ({r1(s.tmean)}°م) والري متاح؛ احتياج الري نحو {r0(s.irrigation)} ملم.", "en": f"Temperature fits ({r1(s.tmean)} °C) and irrigation is available; irrigation need is about {r0(s.irrigation)} mm."}
        return {"ar": f"الحرارة مناسبة ({r1(s.tmean)}°م) وأمطار الموسم {r0(s.rain)} ملم تغطي {r0(s.water_satisfaction * 100)}٪ من احتياج المحصول.", "en": f"Temperature fits ({r1(s.tmean)} °C) and seasonal rainfall of {r0(s.rain)} mm covers {r0(s.water_satisfaction * 100)}% of the crop's demand."}
    worst = "temperature"
    for name in ("temperature", "precipitation", "soil_moisture", "solar_radiation"):
        if f[name] < f[worst]:
            worst = name
    tmin, tmax = _num(v(crop, "temp", "opt_min")), _num(v(crop, "temp", "opt_max"))
    sw = "—" if s.soil_wetness is None else str(r0(s.soil_wetness * 100))
    names = {
        "temperature": {"ar": f"الحرارة ({r1(s.tmean)}°م) خارج النطاق المثالي {tmin}–{tmax}°م", "en": f"temperature ({r1(s.tmean)} °C) is outside the optimal {tmin}–{tmax} °C"},
        "precipitation": {"ar": f"أمطار الموسم ({r0(s.rain)} ملم) تغطي {r0(s.water_satisfaction * 100)}٪ فقط من احتياج المحصول ({r0(s.etc)} ملم) ولا يوجد ري", "en": f"seasonal rainfall ({r0(s.rain)} mm) covers only {r0(s.water_satisfaction * 100)}% of the crop's demand ({r0(s.etc)} mm) with no irrigation"},
        "soil_moisture": {"ar": f"رطوبة التربة منخفضة ({sw}٪)", "en": f"soil moisture is low ({sw}%)"},
        "solar_radiation": {"ar": f"الإشعاع الشمسي ({r1(s.rs)} ميجاجول/م²/يوم) غير مثالي", "en": f"solar radiation ({r1(s.rs)} MJ/m²/day) is not ideal"},
    }
    n = names[worst]
    return {"ar": f"العامل المحدِّد: {n['ar']}.", "en": f"Limiting factor: {n['en']}."}


def build_requirements(e: Evaluation, plot: PlotCtx) -> list[dict]:
    crop, s = e.crop, e.stats

    def within(x, a, b, c, d):
        return "match" if b <= x <= c else "partial" if a < x < d else "mismatch"

    T, R, P = _limits(crop["temp"]), _limits(crop["rain"]), _limits(crop["ph"])
    n = _num
    kc = crop["kc"]
    root = v(crop, "root_depth")
    abs_min = s.abs_min_t if math.isfinite(s.abs_min_t) else math.nan
    return [
        {"key": "temperature", "label": {"ar": "متوسط حرارة الموسم", "en": "Seasonal mean temperature"},
         "required": f"{n(T[1])}–{n(T[2])} °C ({n(T[0])}–{n(T[3])})", "observed": f"{r1(s.tmean)} °C",
         "status": within(s.tmean, *T), "source": crop["temp"]["opt_min"]["source"], "needs_review": False},
        {"key": "rainfall", "label": {"ar": "أمطار الموسم", "en": "Seasonal rainfall"},
         "required": f"{n(R[1])}–{n(R[2])} mm ({n(R[0])}–{n(R[3])})",
         "observed": f"{r0(s.rain)} mm" + (f" + {plot.irrigation_method or 'irrigation'}" if plot.irrigation_available else ""),
         "status": "partial" if plot.irrigation_available and s.rain < R[1] else within(s.rain, *R),
         "source": crop["rain"]["opt_min"]["source"], "needs_review": False},
        {"key": "water_demand", "label": {"ar": "الاحتياج المائي للموسم (ETc)", "en": "Seasonal crop water demand (ETc)"},
         "required": f"Kc {n(kc['ini']['value'])} / {n(kc['mid']['value'])} / {n(kc['end']['value'])}", "observed": f"{r0(s.etc)} mm",
         "status": "match" if plot.irrigation_available or s.eff_rain >= s.etc * 0.8 else "partial" if s.eff_rain >= s.etc * 0.5 else "mismatch",
         "source": kc["mid"]["source"], "needs_review": bool(kc["mid"].get("needs_review"))},
        {"key": "frost", "label": {"ar": "تحمّل الصقيع (درجة القتل)", "en": "Frost (killing temperature)"},
         "required": f"{n(v(crop, 'killing_temp'))} °C", "observed": f"{r1(abs_min) if abs_min == abs_min else '—'} °C · {r1(s.frost_days)} d",
         "status": "match" if s.frost_days < 0.2 else "partial" if s.abs_min_t > v(crop, "killing_temp") else "mismatch",
         "source": crop["killing_temp"]["source"], "needs_review": bool(crop["killing_temp"].get("needs_review"))},
        {"key": "season_length", "label": {"ar": "طول الموسم", "en": "Season length"},
         "required": f"{n(v(crop, 'cycle_days', 'min'))}–{n(v(crop, 'cycle_days', 'max'))} d", "observed": f"{n(v(crop, 'season_length'))} d",
         "status": "match", "source": crop["season_length"]["source"], "needs_review": bool(crop["season_length"].get("needs_review"))},
        {"key": "soil_ph", "label": {"ar": "حموضة التربة pH", "en": "Soil pH"},
         "required": f"{n(P[1])}–{n(P[2])} ({n(P[0])}–{n(P[3])})", "observed": "—" if plot.soil_ph is None else n(plot.soil_ph),
         "observed_source": {"ar": "فحص مخبري", "en": "laboratory test"} if plot.soil_ph_from_lab else None,
         "status": "unknown" if plot.soil_ph is None else within(plot.soil_ph, *P),
         "source": crop["ph"]["opt_min"]["source"], "needs_review": False},
        {"key": "root_depth", "label": {"ar": "عمق الجذور", "en": "Rooting depth"},
         "required": f"{n(root[0])}–{n(root[1])} m", "observed": "—", "status": "unknown",
         "source": crop["root_depth"]["source"], "needs_review": bool(crop["root_depth"].get("needs_review"))},
    ]


def recommended_actions(e: Evaluation, risks: list[dict], plot: PlotCtx, win: Optional[dict]) -> list[dict]:
    out = []
    if win and not e.crop["perennial"]:
        day = lambda iso, months: f"{int(iso[8:10])} {months[int(iso[5:7]) - 1]}"  # noqa: E731
        out.append({
            "ar": f"أفضل موعد للزراعة بين {day(win['start'], MONTHS_AR)} و{day(win['end'], MONTHS_AR)}، حسب سجل المناخ في منطقتك.",
            "en": f"The best time to plant is between {day(win['start'], MONTHS_EN)} and {day(win['end'], MONTHS_EN)}, based on your area's climate record.",
        })
    s = e.stats
    if plot.irrigation_available:
        out.append({
            "ar": f"خطّط لنحو {r0(s.irrigation)} ملم من مياه الري خلال الموسم (ETc {r0(s.etc)} ملم ناقص المطر الفعّال {r0(s.eff_rain)} ملم).",
            "en": f"Plan for about {r0(s.irrigation)} mm of irrigation over the season (ETc {r0(s.etc)} mm minus effective rain {r0(s.eff_rain)} mm).",
        })
    out.extend(r["action"] for r in [x for x in risks if x["severity"] != "low"][:3])
    if plot.soil_ph is None:
        out.append({"ar": "أجرِ فحص تربة (pH والملوحة) لتأكيد ملاءمة المحصول.", "en": "Run a soil test (pH and salinity) to confirm the crop fits."})
    return out


def today_utc() -> datetime:
    return datetime.now(timezone.utc)

