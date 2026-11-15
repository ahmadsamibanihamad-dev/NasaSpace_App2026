"""AI-Powered Crop Rotation Planner (MVP).

Builds a preliminary sequential planting plan for a 90-day window from two things that already
exist in this package and are used unchanged:

* the 30-day and 90-day environmental forecasts (forecasting/mvp_inference.py), and
* the rule-based crop recommendation engine (recommendation_system.recommend).

Phases
    Phase 1 = days 1-30, planted with one of the short-term crops.
    Phase 2 = days 31-90, planted with one of the longer-term crops.

Phase-2 conditions are DERIVED from the two forecasts, they are not a trained 60-day forecast:
    mean  = (90 * mean_90 - 30 * mean_30) / 60        (temperature, humidity, soil moisture)
    rain  = total_90 - total_30
Derived values are checked against physical ranges and are never clipped: when they are
inconsistent (for example negative rainfall) phase 2 is reported as unreliable and only a
partial plan is returned.

Scores are heuristic indices on a 0-100 scale, not probabilities. The weights below are
configurable design choices, not scientifically validated values. This is not a validated
multi-year crop rotation system.

This module has no web or database code: it takes numbers and returns a plain dict.
"""

import math
from itertools import product

from .recommendation_system import CATALOG, recommend

# ---- configurable heuristics ----
WEIGHTS = {"first_crop": 0.40, "second_crop": 0.40, "family_diversity": 0.15, "duration": 0.05}
LEGUME_FAMILY = "Fabaceae"
LEGUME_BONUS = 5.0  # small, added to the family-diversity score only; no nitrogen claim is made
PHASE_1 = (1, 30)
PHASE_2 = (31, 90)
FLOAT_NOISE = 1e-9

CROPS = {c["id"]: c for c in CATALOG["crops"]}
SHORT_TERM = [c["id"] for c in CATALOG["crops"] if c["horizon"] == 30]
LONG_TERM = [c["id"] for c in CATALOG["crops"] if c["horizon"] == 90]
VARIABLES = ("temperature_c", "humidity_pct", "soil_moisture_m3_m3", "rainfall_mm")
RANGES = {"temperature_c": (-60.0, 65.0), "humidity_pct": (0.0, 100.0), "soil_moisture_m3_m3": (0.0, 1.0), "rainfall_mm": (0.0, math.inf)}


def T(ar: str, en: str) -> dict:
    return {"ar": ar, "en": en}


def _same(text: str) -> dict:
    return {"ar": text, "en": text}


VAR_NAME = {
    "temperature_c": T("الحرارة", "temperature"),
    "humidity_pct": T("الرطوبة الجوية", "air humidity"),
    "soil_moisture_m3_m3": T("رطوبة التربة", "soil moisture"),
    "rainfall_mm": T("الأمطار", "rainfall"),
}


def derive_phase_2(forecast_30: dict, forecast_90: dict) -> tuple[dict, list[dict]]:
    """Conditions for days 31-90 derived from the 30- and 90-day forecasts, plus any inconsistencies.

    Both forecasts must be for the same location and forecast origin. Nothing is clipped.
    """
    values = {}
    for k in ("temperature_c", "humidity_pct", "soil_moisture_m3_m3"):
        values[k] = (90.0 * forecast_90[k] - 30.0 * forecast_30[k]) / 60.0
    values["rainfall_mm"] = forecast_90["rainfall_mm"] - forecast_30["rainfall_mm"]
    problems = []
    for k in VARIABLES:
        v = values[k]
        lo, hi = RANGES[k]
        if not math.isfinite(v):
            problems.append({"variable": k, "value": None, "message": T(f"قيمة {VAR_NAME[k]['ar']} المشتقة غير صالحة.", f"The derived {VAR_NAME[k]['en']} is not a valid number.")})
        elif v < lo - FLOAT_NOISE or v > hi + FLOAT_NOISE:
            problems.append(
                {
                    "variable": k,
                    "value": v,
                    "message": T(
                        f"توقعا 30 و90 يوماً غير متسقين: {VAR_NAME[k]['ar']} المشتقة للأيام 31–90 خارج المدى الممكن ({v:.2f}).",
                        f"The 30- and 90-day forecasts are inconsistent: derived {VAR_NAME[k]['en']} for days 31-90 is outside the possible range ({v:.2f}).",
                    ),
                }
            )
    return values, problems


def duration_fit(crop: dict, phase_days: int) -> dict:
    """Does the crop's growth duration fit the phase? Score 0-100 = share of its duration range that fits."""
    lo, hi = crop["days"]
    if lo > phase_days:
        return {"fits": False, "conditional": False, "score": 0.0}
    if hi <= phase_days:
        return {"fits": True, "conditional": False, "score": 100.0}
    return {"fits": True, "conditional": True, "score": round(100.0 * (phase_days - lo) / (hi - lo), 1)}


def family_pair_score(a: str | None, b: str | None) -> float | None:
    """100 when two consecutive crops are from different botanical families, 0 when the same. None if one is unknown."""
    if not a or not b:
        return None
    return 0.0 if CROPS[a]["family"] == CROPS[b]["family"] else 100.0


def family_diversity(previous: str | None, sequence: list[str]) -> dict:
    chain = ([previous] if previous else []) + sequence
    pairs = [(x, y, family_pair_score(x, y)) for x, y in zip(chain, chain[1:])]
    scored = [s for _, _, s in pairs if s is not None]
    base = sum(scored) / len(scored) if scored else 100.0
    legume = any(CROPS[c]["family"] == LEGUME_FAMILY for c in sequence)
    return {
        "score": round(min(100.0, base + (LEGUME_BONUS if legume else 0.0)), 1),
        "repeats": [(x, y) for x, y, s in pairs if s == 0.0],
        "legume_bonus_applied": legume,
    }


def evaluate_phase(crop_group_days: int, phase_days: int, conditions: dict, irrigation_available, soil_ph) -> dict:
    """Score one crop group with the existing recommendation engine under a phase's conditions.

    The engine turns total rainfall into a daily rate using the group's own horizon, so the phase
    total is rescaled to that horizon first (same daily rate, no new rule).
    """
    rain = conditions["rainfall_mm"] * crop_group_days / phase_days
    result = recommend(
        crop_group_days,
        temperature_c=conditions["temperature_c"],
        humidity_pct=conditions["humidity_pct"],
        soil_moisture_m3_m3=conditions["soil_moisture_m3_m3"],
        rainfall_mm=rain,
        irrigation_available=irrigation_available,
        soil_ph=soil_ph,
    )
    return {r["crop_id"]: r for r in result["recommendations"]}


def _step(phase: int, window: tuple[int, int], rec: dict, fit: dict, translate, extra_reasons=(), extra_conditions=()) -> dict:
    crop = CROPS[rec["crop_id"]]
    start, end = window
    lo, hi = crop["days"]
    conditions = [translate(x) for x in rec["risks"]] + list(extra_conditions)
    if fit["conditional"]:
        conditions.append(
            T(
                f"يحتاج صنفاً مبكر النضج: مدة النمو {lo}–{hi} يوماً والفترة المتاحة {end - start + 1} يوماً.",
                f"Needs an early-maturing cultivar: growth takes {lo}-{hi} days and the phase is {end - start + 1} days long.",
            )
        )
    return {
        "phase": phase,
        "crop_id": crop["id"],
        "crop_name_ar": crop["name_ar"],
        "crop_name_en": crop["name_en"],
        "family": crop["family"],
        "planting_day": start,
        "phase_end_day": end,
        "growth_days": [lo, hi],
        "earliest_harvest_day": start + lo - 1,
        "latest_harvest_day": start + hi - 1,
        "estimated_harvest_day": min(start + hi - 1, end),
        "suitability_score": rec["score"],
        "suitability_status": rec["status"],
        "factor_scores": rec["factor_scores"],
        "duration_score": fit["score"],
        "requires_early_cultivar": fit["conditional"],
        "note": translate(crop["note_ar"]),
        "reasons": [translate(x) for x in rec["reasons"]] + list(extra_reasons),
        "conditions": conditions,
    }


def _family_texts(previous: str | None, first: str, second: str | None) -> tuple[list, list, list, list]:
    """Reasons and conditions about botanical families, for the first and the second crop."""
    r1, c1, r2, c2 = [], [], [], []
    if previous:
        if CROPS[previous]["family"] == CROPS[first]["family"]:
            c1.append(T(f"من نفس عائلة المحصول السابق ({CROPS[first]['family']}).", f"Same botanical family as the previous crop ({CROPS[first]['family']})."))
        else:
            r1.append(T("عائلة نباتية مختلفة عن المحصول السابق.", "Different botanical family from the previous crop."))
    if second:
        if CROPS[first]["family"] == CROPS[second]["family"]:
            c2.append(T(f"من نفس عائلة المحصول الأول ({CROPS[second]['family']}).", f"Same botanical family as the first crop ({CROPS[second]['family']})."))
        else:
            r2.append(T("عائلة نباتية مختلفة عن المحصول الأول.", "Different botanical family from the first crop."))
        if CROPS[second]["family"] == LEGUME_FAMILY:
            r2.append(T("محصول بقولي: قد يفيد تنويع الدورة، دون ضمان لتحسّن التربة.", "A legume: it may benefit the rotation, with no guarantee of soil improvement."))
    return r1, c1, r2, c2


def plan(
    forecast_30: dict,
    forecast_90: dict | None,
    *,
    planning_horizon_days: int = 90,
    previous_crop: str | None = None,
    irrigation_available: bool | None = None,
    soil_ph: float | None = None,
    translate=_same,
) -> dict:
    """Rank crop sequences for the planning window.

    forecast_30 / forecast_90: {"temperature_c", "humidity_pct", "soil_moisture_m3_m3", "rainfall_mm"}
    from the existing forecasting service, same location and origin. `translate` turns the
    recommendation engine's own (Arabic) text into {"ar", "en"}.
    """
    if planning_horizon_days not in (30, 90):
        raise ValueError("planning horizon must be 30 or 90 days")
    if previous_crop is not None and previous_crop not in CROPS:
        raise ValueError(f"unknown previous crop: {previous_crop}")
    if planning_horizon_days == 90 and forecast_90 is None:
        raise ValueError("a 90-day plan needs the 90-day forecast")

    warnings = [
        T("توقع الأمطار محدود الدقة؛ لا تعتمد عليه لتحديد كميات الري.", "Rainfall forecasts have limited accuracy; do not use them to decide irrigation amounts."),
        T("درجات الملاءمة والدورة مؤشرات قواعد تجريبية، وليست احتمال نجاح.", "Suitability and rotation scores are heuristic indices, not probabilities of success."),
        T("متوسط الفترة لا يكشف الصقيع أو موجات الحر.", "A period average does not reveal frost or heat waves."),
    ]
    if previous_crop is None:
        warnings.append(T("المحصول السابق غير معروف، فلم يُحتسب أثره على التنويع.", "The previous crop is unknown, so its effect on diversity was not counted."))
    if soil_ph is None:
        warnings.append(T("حموضة التربة غير متاحة لهذا الموقع، فلم تدخل في التقييم.", "Soil pH is not available for this location, so it was left out of the scoring."))
    if irrigation_available is None:
        warnings.append(T("توفر الري غير معروف.", "Irrigation availability is unknown."))

    phase_1 = {"start_day": PHASE_1[0], "end_day": PHASE_1[1], **{k: forecast_30[k] for k in VARIABLES}, "method": "forecast_30_day", "reliable": True}
    forecasts = {"phase_1": phase_1}
    len_1 = PHASE_1[1] - PHASE_1[0] + 1
    len_2 = PHASE_2[1] - PHASE_2[0] + 1

    recs_1 = evaluate_phase(30, len_1, forecast_30, irrigation_available, soil_ph)
    fits_1 = {cid: duration_fit(CROPS[cid], len_1) for cid in SHORT_TERM}
    valid_1 = [cid for cid in SHORT_TERM if recs_1[cid]["status"] != "not_recommended" and fits_1[cid]["fits"]]

    recs_2, fits_2, valid_2, problems = {}, {}, [], []
    if planning_horizon_days == 90:
        derived, problems = derive_phase_2(forecast_30, forecast_90)
        forecasts["phase_2"] = {
            "start_day": PHASE_2[0],
            "end_day": PHASE_2[1],
            **derived,
            "method": "derived_from_30_and_90_day_forecasts",
            "reliable": not problems,
        }
        warnings.append(T("ظروف المرحلة الثانية (الأيام 31–90) تقدير مشتق من توقعَي 30 و90 يوماً، وليست توقعاً مستقلاً.", "Second-phase conditions (days 31-90) are estimates derived from the 30- and 90-day forecasts, not an independent forecast."))
        if problems:
            warnings.extend(p["message"] for p in problems)
        else:
            recs_2 = evaluate_phase(90, len_2, derived, irrigation_available, soil_ph)
            fits_2 = {cid: duration_fit(CROPS[cid], len_2) for cid in LONG_TERM}
            valid_2 = [cid for cid in LONG_TERM if recs_2[cid]["status"] != "not_recommended" and fits_2[cid]["fits"]]

    def single(cid: str) -> dict:
        fam = family_diversity(previous_crop, [cid])
        w = WEIGHTS
        total = w["first_crop"] + w["family_diversity"] + w["duration"]
        score = (w["first_crop"] * recs_1[cid]["score"] + w["family_diversity"] * fam["score"] + w["duration"] * fits_1[cid]["score"]) / total
        r1, c1, _, _ = _family_texts(previous_crop, cid, None)
        return {
            "rotation_score": round(score, 1),
            "status": "conditionally_suitable" if (recs_1[cid]["status"] != "suitable_candidate" or fits_1[cid]["conditional"] or fam["repeats"]) else "suitable",
            "components": {"first_crop_suitability": recs_1[cid]["score"], "second_crop_suitability": None, "family_diversity_score": fam["score"], "duration_compatibility_score": fits_1[cid]["score"]},
            "estimated_total_days": [CROPS[cid]["days"][0], CROPS[cid]["days"][1]],
            "sequence": [_step(1, PHASE_1, recs_1[cid], fits_1[cid], translate, r1, c1)],
        }

    def pair(a: str, b: str) -> dict:
        fam = family_diversity(previous_crop, [a, b])
        dur = round((fits_1[a]["score"] + fits_2[b]["score"]) / 2, 1)
        w = WEIGHTS
        score = w["first_crop"] * recs_1[a]["score"] + w["second_crop"] * recs_2[b]["score"] + w["family_diversity"] * fam["score"] + w["duration"] * dur
        clean = (
            recs_1[a]["status"] == "suitable_candidate"
            and recs_2[b]["status"] == "suitable_candidate"
            and not fits_1[a]["conditional"]
            and not fits_2[b]["conditional"]
            and not fam["repeats"]
        )
        r1, c1, r2, c2 = _family_texts(previous_crop, a, b)
        return {
            "rotation_score": round(score, 1),
            "status": "suitable" if clean else "conditionally_suitable",
            "components": {"first_crop_suitability": recs_1[a]["score"], "second_crop_suitability": recs_2[b]["score"], "family_diversity_score": fam["score"], "duration_compatibility_score": dur},
            "estimated_total_days": [PHASE_1[1] + CROPS[b]["days"][0], PHASE_1[1] + CROPS[b]["days"][1]],
            "sequence": [_step(1, PHASE_1, recs_1[a], fits_1[a], translate, r1, c1), _step(2, PHASE_2, recs_2[b], fits_2[b], translate, r2, c2)],
        }

    rejected = []
    for cid in SHORT_TERM:
        if cid not in valid_1:
            rejected.append({"phase": 1, "crop_id": cid, "reason": "duration" if not fits_1[cid]["fits"] else "environment", "suitability_score": recs_1[cid]["score"]})
    for cid in LONG_TERM if recs_2 else []:
        if cid not in valid_2:
            rejected.append({"phase": 2, "crop_id": cid, "reason": "duration" if not fits_2[cid]["fits"] else "environment", "suitability_score": recs_2[cid]["score"]})

    explanation = []
    if planning_horizon_days == 90 and valid_1 and valid_2:
        ranked = sorted((pair(a, b) for a, b in product(valid_1, valid_2)), key=lambda p: -p["rotation_score"])
        status = "success"
    elif valid_1:
        ranked = sorted((single(a) for a in valid_1), key=lambda p: -p["rotation_score"])
        if planning_horizon_days == 30:
            status = "success"
        else:
            status = "partial_plan"
            if problems:
                explanation.append(T("لا يمكن اقتراح محصول ثانٍ لأن توقعَي 30 و90 يوماً غير متسقين، فلا تُعرف ظروف الأيام 31–90.", "A second crop cannot be recommended because the 30- and 90-day forecasts are inconsistent, so conditions for days 31-90 are unknown."))
            else:
                explanation.append(T("لا يمكن اقتراح محصول ثانٍ حالياً: لا يوجد محصول طويل المدة ملائم لظروف الأيام 31–90 المتوقعة.", "A second crop cannot be recommended now: no longer-term crop suits the conditions expected for days 31-90."))
    else:
        ranked, status = [], "no_plan_available"
        explanation.append(T("لا يوجد محصول قصير المدة ملائم للظروف المتوقعة في الأيام 1–30، فلا توجد خطة.", "No short-term crop suits the conditions expected for days 1-30, so there is no plan."))

    best = ranked[0] if ranked else None
    if best:
        seq = best["sequence"]
        explanation.append(T("المحاصيل المختارة هي الأعلى ملاءمة للظروف المتوقعة في كل مرحلة.", "The chosen crops fit the conditions expected in each phase best."))
        if len(seq) == 2 and seq[0]["family"] != seq[1]["family"]:
            explanation.append(T(f"المحصولان من عائلتين مختلفتين ({seq[0]['family']} ثم {seq[1]['family']})، ما يقلل تكرار العائلة نفسها.", f"The two crops are from different families ({seq[0]['family']} then {seq[1]['family']}), which reduces repeating one family."))
        if previous_crop and CROPS[previous_crop]["family"] != seq[0]["family"]:
            explanation.append(T("المحصول الأول من عائلة مختلفة عن المحصول السابق.", "The first crop is from a different family than the previous crop."))
        if any(s["requires_early_cultivar"] for s in seq):
            explanation.append(T("الخطة مشروطة باستخدام أصناف مبكرة النضج لتناسب مدة كل مرحلة.", "The plan depends on using early-maturing cultivars to fit each phase."))
        else:
            explanation.append(T("مدة نمو المحاصيل تناسب المدة المتاحة في كل مرحلة.", "The crops' growth durations fit the time available in each phase."))

    return {
        "status": status,
        "planning_horizon_days": planning_horizon_days,
        "previous_crop": previous_crop,
        "forecasts": forecasts,
        "best_rotation": best,
        "alternative_rotations": ranked[1:3],
        "rejected": rejected,
        "explanation": explanation,
        "warnings": warnings,
        "weights": WEIGHTS,
        "rule_version": CATALOG["version"],
    }
