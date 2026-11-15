"""AI-Powered Crop Rotation Planner (MVP), on the multi-factor recommendation engine (mvp-2).

Builds a preliminary sequential planting plan for a 90-day window from things that already exist
in this package:

* the 30-day and 90-day environmental forecasts (forecasting/mvp_inference.py),
* the rule-based crop recommendation engine (recommendation_system.recommend), and
* the soil, terrain and historical observations of the location (environment_service).

Phases
    Phase 1 = days 1-30, planted with one of the short-term crops.
    Phase 2 = days 31-90, planted with one of the longer-term crops.

Phase-2 conditions are DERIVED from the two forecasts, they are not a trained 60-day forecast:
    mean  = (90 * mean_90 - 30 * mean_30) / 60        (temperature, humidity, soil moisture)
    rain  = total_90 - total_30
Derived values are checked against physical ranges and are never clipped: when they are
inconsistent (for example negative rainfall) phase 2 is reported as unreliable and only a
partial plan is returned.

Rotation rules live in one place, the recommendation engine. For the first crop the history is
what the user grew before; for the second crop the first crop becomes the most recent one and the
user's history moves one step back. To avoid counting rotation twice, a sequence is scored from
each crop's ENVIRONMENT score (all factors except rotation) plus the engine's rotation scores:

    rotation_score = 0.40 * first crop environment + 0.40 * second crop environment
                   + 0.15 * rotation compatibility (mean of the two crops) + 0.05 * duration fit

Scores are heuristic indices on a 0-100 scale, not probabilities. The weights are configurable
design choices, not scientifically validated values. This is not a validated multi-year crop
rotation system.

This module has no web or database code: it takes numbers and returns a plain dict.
"""

import math

from .recommendation_system import CATALOG, CROPS, PREVIOUS, normalise_history, recommend

# ---- configurable heuristics ----
WEIGHTS = {"first_crop": 0.40, "second_crop": 0.40, "rotation": 0.15, "duration": 0.05}
PHASE_1 = (1, 30)
PHASE_2 = (31, 90)
FLOAT_NOISE = 1e-9

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


def evaluate_phase(crop_group_days: int, phase_days: int, conditions: dict, irrigation_available, soil_ph=None, *, site=None, history=None, cultivation_type=None) -> dict:
    """Score one crop group with the recommendation engine under a phase's conditions.

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
        site=site,
        crop_history=history,
        cultivation_type=cultivation_type,
    )
    return {r["crop_id"]: r for r in result["recommendations"]}


def _step(phase: int, window: tuple[int, int], rec: dict, fit: dict, translate) -> dict:
    crop = CROPS[rec["crop_id"]]
    start, end = window
    lo, hi = crop["days"]
    notes = [n for n in rec["explanations"] if n["component"] != "duration"]  # the phase length is handled here
    reasons = [{"ar": n["ar"], "en": n["en"]} for n in notes if n["effect"] == "positive"]
    conditions = [{"ar": n["ar"], "en": n["en"]} for n in notes if n["effect"] in ("negative", "caution", "unknown")]
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
        "environment_score": rec["environment_score"],
        "suitability_status": rec["status"],
        "component_scores": rec["component_scores"],
        "group_scores": rec["group_scores"],
        "factor_scores": rec["factor_scores"],
        "rotation": rec["rotation"],
        "coverage_pct": rec["coverage_pct"],
        "duration_score": fit["score"],
        "requires_early_cultivar": fit["conditional"],
        "note": translate(crop["note_ar"]),
        "reasons": reasons,
        "conditions": conditions,
    }


def plan(
    forecast_30: dict,
    forecast_90: dict | None,
    *,
    planning_horizon_days: int = 90,
    previous_crop: str | None = None,
    crop_history: list | None = None,
    irrigation_available: bool | None = None,
    soil_ph: float | None = None,
    site_phase_1: dict | None = None,
    site_phase_2: dict | None = None,
    cultivation_type: str | None = None,
    translate=_same,
) -> dict:
    """Rank crop sequences for the planning window.

    forecast_30 / forecast_90: {"temperature_c", "humidity_pct", "soil_moisture_m3_m3", "rainfall_mm"}
    from the forecasting service, same location and origin. `crop_history` is [{"crop_id",
    "years_ago"}]; `previous_crop` is shorthand for years_ago = 1. `site_phase_*` are
    environment_service.site_context dicts for each phase (soil, terrain, historical observations).
    `translate` turns fixed Arabic text of the crop table into {"ar", "en"}.
    """
    if planning_horizon_days not in (30, 90):
        raise ValueError("planning horizon must be 30 or 90 days")
    for cid in [previous_crop] + [h.get("crop_id") for h in crop_history or []]:
        if cid is not None and cid not in PREVIOUS:
            raise ValueError(f"unknown previous crop: {cid}")
    if planning_horizon_days == 90 and forecast_90 is None:
        raise ValueError("a 90-day plan needs the 90-day forecast")
    history = normalise_history(previous_crop, crop_history)

    warnings = [
        T("توقع الأمطار محدود الدقة؛ لا تعتمد عليه لتحديد كميات الري.", "Rainfall forecasts have limited accuracy; do not use them to decide irrigation amounts."),
        T("درجات الملاءمة والدورة مؤشرات قواعد تجريبية، وليست احتمال نجاح.", "Suitability and rotation scores are heuristic indices, not probabilities of success."),
        T("متوسط الفترة لا يكشف الصقيع أو موجات الحر.", "A period average does not reveal frost or heat waves."),
    ]
    if not history:
        warnings.append(T("المحصول السابق غير معروف، فلم يُقيَّم توافق المحصول الأول مع ما قبله.", "The previous crop is unknown, so the first crop's compatibility with what came before was not evaluated."))
    if site_phase_1 is None or not site_phase_1.get("soil", {}).get("has_data"):
        warnings.append(T("بيانات التربة غير متاحة لهذا الموقع، فلم تدخل عوامل التربة والخصوبة في التقييم.", "Soil data is not available for this location, so the soil and fertility factors were left out of the scoring."))
    if irrigation_available is None:
        warnings.append(T("توفر الري غير معروف.", "Irrigation availability is unknown."))

    phase_1 = {"start_day": PHASE_1[0], "end_day": PHASE_1[1], **{k: forecast_30[k] for k in VARIABLES}, "method": "forecast_30_day", "reliable": True}
    forecasts = {"phase_1": phase_1}
    len_1 = PHASE_1[1] - PHASE_1[0] + 1
    len_2 = PHASE_2[1] - PHASE_2[0] + 1

    if cultivation_type == "greenhouse":
        warnings.append(T("زراعة محمية: التوقعات تصف الجو الخارجي لا داخل البيت المحمي، فلم تدخل عوامل الطقس في الدرجات، والخطة مشروطة.", "Greenhouse: forecasts describe outdoor air, not the inside of the greenhouse, so the weather factors were left out of the scores and the plan is conditional."))
    recs_1 = evaluate_phase(30, len_1, forecast_30, irrigation_available, soil_ph, site=site_phase_1, history=history, cultivation_type=cultivation_type)
    fits_1 = {cid: duration_fit(CROPS[cid], len_1) for cid in SHORT_TERM}
    valid_1 = [cid for cid in SHORT_TERM if recs_1[cid]["status"] != "not_recommended" and fits_1[cid]["fits"]]

    derived, problems, phase_2_ok = None, [], False
    fits_2 = {cid: duration_fit(CROPS[cid], len_2) for cid in LONG_TERM}
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
            phase_2_ok = True

    def second_crops(first: str) -> dict:
        """Longer-term crops evaluated after `first`: it becomes the most recent crop of the history."""
        shifted = [{"crop_id": first, "years_ago": 1}] + [{"crop_id": h["crop_id"], "years_ago": h["years_ago"] + 1} for h in history]
        return evaluate_phase(90, len_2, derived, irrigation_available, soil_ph, site=site_phase_2 or site_phase_1, history=shifted, cultivation_type=cultivation_type)

    def single(cid: str) -> dict:
        r = recs_1[cid]
        w = WEIGHTS
        parts = [(w["first_crop"], r["environment_score"]), (w["duration"], fits_1[cid]["score"])]
        if r["rotation"]["score"] is not None:
            parts.append((w["rotation"], r["rotation"]["score"]))
        score = sum(a * b for a, b in parts) / sum(a for a, _ in parts)
        return {
            "rotation_score": round(score, 1),
            "status": "suitable" if (r["status"] == "suitable_candidate" and not fits_1[cid]["conditional"]) else "conditionally_suitable",
            "components": {"first_crop_suitability": r["environment_score"], "second_crop_suitability": None, "family_diversity_score": r["rotation"]["score"], "duration_compatibility_score": fits_1[cid]["score"]},
            "estimated_total_days": [CROPS[cid]["days"][0], CROPS[cid]["days"][1]],
            "sequence": [_step(1, PHASE_1, r, fits_1[cid], translate)],
        }

    def pair(a: str, b: str, recs_2: dict) -> dict:
        ra, rb = recs_1[a], recs_2[b]
        rot = [x for x in (ra["rotation"]["score"], rb["rotation"]["score"]) if x is not None]
        rotation = round(sum(rot) / len(rot), 1)  # the second crop always has the first one as history
        dur = round((fits_1[a]["score"] + fits_2[b]["score"]) / 2, 1)
        w = WEIGHTS
        score = w["first_crop"] * ra["environment_score"] + w["second_crop"] * rb["environment_score"] + w["rotation"] * rotation + w["duration"] * dur
        clean = ra["status"] == "suitable_candidate" and rb["status"] == "suitable_candidate" and not fits_1[a]["conditional"] and not fits_2[b]["conditional"]
        return {
            "rotation_score": round(score, 1),
            "status": "suitable" if clean else "conditionally_suitable",
            "components": {"first_crop_suitability": ra["environment_score"], "second_crop_suitability": rb["environment_score"], "family_diversity_score": rotation, "duration_compatibility_score": dur},
            "estimated_total_days": [PHASE_1[1] + CROPS[b]["days"][0], PHASE_1[1] + CROPS[b]["days"][1]],
            "sequence": [_step(1, PHASE_1, ra, fits_1[a], translate), _step(2, PHASE_2, rb, fits_2[b], translate)],
        }

    rejected = [
        {"phase": 1, "crop_id": cid, "reason": "duration" if not fits_1[cid]["fits"] else "environment", "suitability_score": recs_1[cid]["score"], "critical_failures": recs_1[cid]["critical_failures"]}
        for cid in SHORT_TERM
        if cid not in valid_1
    ]

    pairs = []
    if phase_2_ok:
        for a in valid_1:
            recs_2 = second_crops(a)
            for b in LONG_TERM:
                if recs_2[b]["status"] != "not_recommended" and fits_2[b]["fits"]:
                    pairs.append(pair(a, b, recs_2))
        if not pairs and valid_1:
            recs_2 = second_crops(valid_1[0])
            rejected += [{"phase": 2, "crop_id": b, "reason": "duration" if not fits_2[b]["fits"] else "environment", "suitability_score": recs_2[b]["score"], "critical_failures": recs_2[b]["critical_failures"]} for b in LONG_TERM]

    explanation = []
    if planning_horizon_days == 90 and pairs:
        ranked = sorted(pairs, key=lambda p: -p["rotation_score"])
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
        explanation.append(T("المحاصيل المختارة هي الأعلى في مجموع العوامل: المناخ المتوقع، الماء، التربة، الخصوبة، والدورة الزراعية.", "The chosen crops score highest across the factors: expected climate, water, soil, fertility and rotation."))
        if len(seq) == 2 and seq[0]["family"] != seq[1]["family"]:
            explanation.append(T(f"المحصولان من عائلتين مختلفتين ({seq[0]['family']} ثم {seq[1]['family']})، ما يقلل تكرار العائلة نفسها.", f"The two crops are from different families ({seq[0]['family']} then {seq[1]['family']}), which reduces repeating one family."))
        elif len(seq) == 2:
            explanation.append(T(f"المحصولان من العائلة نفسها ({seq[0]['family']})؛ اختيرا لأن البدائل أقل ملاءمة للظروف.", f"Both crops are from the same family ({seq[0]['family']}); they were chosen because the alternatives fit the conditions less."))
        if history and seq[0]["rotation"]["score"] is not None:
            last = PREVIOUS[history[0]["crop_id"]]
            if last.get("family") and last["family"] != seq[0]["family"]:
                explanation.append(T(f"المحصول الأول من عائلة مختلفة عن المحصول السابق ({last['name_ar']}).", f"The first crop is from a different family than the previous crop ({last['name_en']})."))
        if any(s["requires_early_cultivar"] for s in seq):
            explanation.append(T("الخطة مشروطة باستخدام أصناف مبكرة النضج لتناسب مدة كل مرحلة.", "The plan depends on using early-maturing cultivars to fit each phase."))
        else:
            explanation.append(T("مدة نمو المحاصيل تناسب المدة المتاحة في كل مرحلة.", "The crops' growth durations fit the time available in each phase."))

    return {
        "status": status,
        "planning_horizon_days": planning_horizon_days,
        "previous_crop": history[0]["crop_id"] if history and history[0]["years_ago"] == 1 else None,
        "crop_history": [{**h, "family": (PREVIOUS.get(h["crop_id"]) or {}).get("family")} for h in history],
        "forecasts": forecasts,
        "cultivation_type": cultivation_type or "open_field",
        "best_rotation": best,
        "alternative_rotations": ranked[1:3],
        "rejected": rejected,
        "explanation": explanation,
        "warnings": warnings,
        "weights": WEIGHTS,
        "rule_version": CATALOG["version"],
    }
