"""Runs one analysis end to end. Port of frontend/src/lib/engine/run.ts.

The same functions serve signed-in users (results are saved) and guests (nothing is saved).
"""

from __future__ import annotations

from datetime import datetime
from typing import Callable, Optional

import numpy as np

from app.core.errors import AppError
from app.engine.config import ENGINE_VERSION, crop_list, crops, status_of
from app.engine.environment import data_meta, soil_anomaly
from app.engine.features import Climate, _mean, dekad_of, effective_rain_monthly, kc_curve, monthly_climatology, monthly_series, r0, r1, scale_stages, to_day
from app.engine.rotation import build_rotation
from app.engine.suitability import (
    Evaluation,
    PlotCtx,
    best_index,
    best_window,
    build_evidence,
    build_explanation,
    build_requirements,
    build_risks,
    dekad_probabilities_cached,
    main_reason,
    period_scores,
    recommended_actions,
    scan_year,
    today_utc,
    water_demand_level,
    window_dates,
)

STAGES = ["retrieving_environmental_data", "processing_satellite_information", "evaluating_crop_requirements", "generating_recommendations"]

DISCLAIMER = {
    "ar": "الدرجة تقدير للملاءمة البيئية ولا تضمن كمية الإنتاج. استشر مهندساً زراعياً محلياً قبل اتخاذ القرار.",
    "en": "The score estimates environmental suitability and does not guarantee yield. Consult a local agricultural engineer before deciding.",
}


class Scanner:
    """Scores every crop for every planting period once per irrigation setup (parcels of a farm share the climate)."""

    def __init__(self, climate: Climate, today: Optional[datetime] = None):
        self.climate = climate
        self.today = today or today_utc()
        self._memo: dict[str, list[Evaluation]] = {}

    def scan(self, crop: dict, ctx: PlotCtx) -> list[Evaluation]:
        key = f"{crop['id']}|{ctx.key}"
        if key not in self._memo:
            self._memo[key] = scan_year(self.climate, crop, ctx)
        return self._memo[key]

    def pick(self, evals: list[Evaluation], planting_date: Optional[str] = None):
        w = best_window(evals)
        idx = w["best"] if w else best_index(evals)
        if planting_date and not evals[0].crop["perennial"]:
            idx = dekad_of(int(planting_date[5:7]), int(planting_date[8:10]))
        return w, evals[idx]

    def ranked(self, ctx: PlotCtx) -> list[tuple[dict, Optional[dict], Evaluation]]:
        out = []
        for c in crop_list():
            w, e = self.pick(self.scan(c, ctx))
            out.append((c, w, e))
        return sorted(out, key=lambda x: -x[2].score)

    def window(self, crop: dict, w: Optional[dict]) -> Optional[dict]:
        return window_dates(w["start"], w["end"], self.today) if w and not crop["perennial"] else None


def _factors(e: Evaluation) -> dict:
    f = e.factors
    return {"temperature": r0(f["temperature"]), "soil_moisture": r0(f["soil_moisture"]), "precipitation": r0(f["precipitation"]), "solar_radiation": r0(f["solar_radiation"])}


def ranked_crops(sc: Scanner, ctx: PlotCtx, detailed: bool = True) -> list[dict]:
    out = []
    for c, w, e in sc.ranked(ctx):
        item = {
            "crop": c["id"],
            "suitability_score": r0(e.score),
            "suitability_status": status_of(e.score),
            "planting_window": sc.window(c, w),
            "water_demand": water_demand_level(e.stats.etc),
            "main_reason": main_reason(e, ctx),
            "environmental_scores": _factors(e),
        }
        if detailed:
            item["requirements"] = build_requirements(e, ctx)
            item["explanation"] = build_explanation(e, ctx)
        out.append(item)
    return out


def plot_ctx(p) -> PlotCtx:
    return PlotCtx(bool(p.irrigation_available), p.irrigation_method, p.soil_ph, p.soil_type)


def suitability_for(sc: Scanner, p, crop: dict, anomaly: Optional[float], planting_date: Optional[str] = None) -> dict:
    ctx = plot_ctx(p)
    evals = sc.scan(crop, ctx)
    w, e = sc.pick(evals, planting_date)
    win = sc.window(crop, w)
    risks = build_risks(sc.climate, e, ctx, anomaly)
    return {
        "plot_id": p.id,
        "plot_label": p.label,
        "plot_name": p.name,
        "crop": crop["id"],
        "suitability_score": r0(e.score),
        "suitability_status": status_of(e.score),
        "recommended_planting_window": win,
        "environmental_scores": _factors(e),
        "risks": risks,
        "alternative_crops": [{"crop": c["id"], "suitability_score": r0(x.score)} for c, _, x in sc.ranked(ctx) if c["id"] != crop["id"]][:3],
        "explanation": build_explanation(e, ctx),
        "recommended_actions": recommended_actions(e, risks, ctx, win),
        "evidence": build_evidence(sc.climate, e),
        "requirements": build_requirements(e, ctx),
        "period_scores": period_scores(evals, sc.today.year),
    }


def water_for(c: Climate, p, crop: dict, e: Evaluation) -> dict:
    """Month-by-month water balance for the crop season (means over the historical record)."""
    d = c.daily
    L = crop["season_length"]["value"]
    kc = kc_curve(L, scale_stages(list(crop["stages"]["value"]), L), {k: crop["kc"][k]["value"] for k in ("ini", "mid", "end")})
    start_m = 1 if crop["perennial"] else e.dekad // 3 + 1
    start_d = 1 if crop["perennial"] else (1, 11, 21)[e.dekad % 3]
    acc: dict[int, dict] = {}
    for y in range(c.first_year, c.last_year + 1):
        a = to_day(f"{y}-{start_m:02d}-{start_d:02d}") - c.s0
        if a < 0 or a + L - 1 > c.last_idx:
            continue
        pr = np.nan_to_num(d.pr[a: a + L], nan=0.0)
        e0 = np.nan_to_num(c.et0[a: a + L], nan=0.0)
        months, first, inv = np.unique(c.ym[a: a + L], return_index=True, return_inverse=True)
        p_m = np.bincount(inv, weights=pr)
        e0_m = np.bincount(inv, weights=e0)
        etc_m = np.bincount(inv, weights=e0 * kc)
        for order, i in enumerate(np.argsort(first).tolist()):
            month = int(months[i]) % 12 + 1
            eff = min(effective_rain_monthly(float(p_m[i])), float(etc_m[i]))
            slot = acc.setdefault(month, {"et0": [], "etc": [], "eff": [], "irr": [], "order": order})
            slot["et0"].append(float(e0_m[i]))
            slot["etc"].append(float(etc_m[i]))
            slot["eff"].append(eff)
            slot["irr"].append(max(0.0, float(etc_m[i]) - eff))
    monthly = [
        {"month": m, "et0_mm": r1(_mean(s["et0"])), "etc_mm": r1(_mean(s["etc"])), "effective_rain_mm": r1(_mean(s["eff"])), "irrigation_mm": r1(_mean(s["irr"]))}
        for m, s in sorted(acc.items(), key=lambda kv: kv[1]["order"])
    ]
    tot = lambda k: r0(sum(m[k] for m in monthly))  # noqa: E731
    etc, eff, irr = tot("etc_mm"), tot("effective_rain_mm"), tot("irrigation_mm")
    m3 = r0(irr / 1000 * p.area_m2)
    ar, en = crop["name"]["ar"], crop["name"]["en"]
    rainfed_ar = "" if p.irrigation_available else " القطعة بعلية حالياً، فهذا الاحتياج يمثل العجز المائي المتوقع."
    rainfed_en = "" if p.irrigation_available else " The plot is currently rainfed, so this is the expected water deficit."
    return {
        "plot_id": p.id,
        "plot_label": p.label,
        "crop": crop["id"],
        "irrigation_available": bool(p.irrigation_available),
        "monthly": monthly,
        "season_total": {"etc_mm": etc, "effective_rain_mm": eff, "irrigation_mm": irr, "irrigation_m3": m3},
        "explanation": {
            "ar": f"يحتاج {ar} في هذه القطعة نحو {etc} ملم من الماء خلال الموسم (ETc = Kc × ET0). يغطي المطر الفعّال {eff} ملم، فيبقى احتياج ري صافٍ تقديري {irr} ملم، أي نحو {m3} م³ لمساحة القطعة. الأرقام تقديرية وصافية ولا تشمل فاقد كفاءة نظام الري.{rainfed_ar}",
            "en": f"{en} on this plot needs about {etc} mm of water over the season (ETc = Kc × ET0). Effective rainfall covers {eff} mm, leaving an estimated net irrigation requirement of {irr} mm, about {m3} m³ for the plot area. Figures are estimates, net of irrigation-system losses.{rainfed_en}",
        },
    }


def run_analysis(
    climate: Climate,
    farm,
    plots: list,
    history: dict[str, list[dict]],
    analysis_type: str,
    crop_id: Optional[str] = None,
    planting_date: Optional[str] = None,
    priority: Optional[str] = None,
    on_stage: Callable[[str], None] = lambda s: None,
    today: Optional[datetime] = None,
) -> dict:
    """Compute the result for one analysis. `on_stage` reports the real processing stages."""
    CROPS = crops()
    if crop_id and crop_id not in CROPS:
        raise AppError(422, "UNSUPPORTED_CROP", f"Unsupported crop {crop_id}")
    if not plots:
        raise AppError(422, "VALIDATION_ERROR", "No parcels selected")

    on_stage(STAGES[1])  # quality checks, anomalies, climatologies (stage 0, data retrieval, is done by the caller)
    if climate.record_years < 3:
        raise AppError(422, "MISSING_DATA", "Not enough historical data for this location")
    anomaly = soil_anomaly(climate)
    rows = monthly_series(climate)

    on_stage(STAGES[2])
    sc = Scanner(climate, today)

    def crop_for(p) -> dict:
        """Crop to analyse for a parcel: the requested one, else what is planted, else the best-ranked crop."""
        return CROPS.get(crop_id or "") or CROPS.get(p.current_crop_id or "") or sc.ranked(plot_ctx(p))[0][0]

    result: dict = {
        **data_meta(climate, "historical_climatology", bool(farm.is_demo)),
        "analysis_type": analysis_type,
        "farm_id": farm.id,
        "model_version": ENGINE_VERSION,
        "engine_fallback": False,
        "forecast_used": False,
        "disclaimer": DISCLAIMER,
    }

    if analysis_type == "crop_suitability":
        if not crop_id:
            raise AppError(422, "VALIDATION_ERROR", "crop_id is required for a crop suitability analysis")
        result["plots"] = [suitability_for(sc, p, CROPS[crop_id], anomaly, planting_date) for p in plots]
    elif analysis_type == "crop_recommendation":
        result["recommendations"] = [{"plot_id": p.id, "plot_label": p.label, "ranked": ranked_crops(sc, plot_ctx(p))} for p in plots]
    elif analysis_type == "planting_window":
        ref = crop_for(plots[0])
        probs = dekad_probabilities_cached(climate, ref["heat_threshold"]["value"])
        rain_clim = monthly_climatology(rows, lambda r: r.rain)
        sm_clim = monthly_climatology(rows, lambda r: r.gwr)
        cal_rows = []
        if crop_id:
            # One chosen crop: a row per parcel.
            groups = [(p, p.label) for p in plots]
        else:
            # Every crop, best first. Parcels of one farm share the same climate, so parcels that
            # also share the same irrigation get one set of rows instead of thirteen rows each.
            by_water: dict = {}
            for p in plots:
                by_water.setdefault((bool(p.irrigation_available), p.irrigation_method if p.irrigation_available else None), []).append(p)
            groups = [(ps[0], "، ".join(x.label for x in ps)) for ps in by_water.values()]
        for p, label in groups:
            ctx = plot_ctx(p)
            for crop in [CROPS[crop_id]] if crop_id else [c for c, _, _ in sc.ranked(ctx)]:
                evals = sc.scan(crop, ctx)
                cal_rows.append({"plot_id": p.id, "plot_label": label, "irrigation_available": bool(p.irrigation_available), "crop": crop["id"], "perennial": bool(crop["perennial"]), "period_scores": period_scores(evals, sc.today.year), "best_window": sc.window(crop, best_window(evals))})
        result["calendar"] = {
            "rows": cal_rows,
            "frost_periods": [{"period": str(k), "probability": r1(x * 100) / 100} for k, x in enumerate(probs["frost"])],
            "heat_periods": [{"period": str(k), "probability": r1(x * 100) / 100} for k, x in enumerate(probs["heat"])],
            "monthly_rainfall_mm": [{"month": m + 1, "value": 0 if x is None else r1(x)} for m, x in enumerate(rain_clim)],
            "monthly_soil_moisture": [{"month": m + 1, "value": None if x is None else r1(x * 100)} for m, x in enumerate(sm_clim)],
        }
        result["heat_threshold_c"] = ref["heat_threshold"]["value"]
    elif analysis_type == "rotation":
        pr = priority or "improve_soil"
        out = []
        for p in plots:
            ctx = plot_ctx(p)
            hist = history.get(p.id, [])
            best = {}
            for c in crop_list():
                if not c["perennial"]:
                    evals = sc.scan(c, ctx)
                    w = best_window(evals)
                    best[c["id"]] = evals[w["best"] if w else best_index(evals)]
            r = build_rotation(climate, ctx, p.current_crop_id, p.previous_crop_id, hist, pr, sc.today, best)
            out.append({"plot_id": p.id, "plot_label": p.label, "priority": pr, "history": hist, "strategies": r["strategies"]})
        result["rotation"] = out
    elif analysis_type == "water":
        result["water"] = []
        for p in plots:
            crop = crop_for(p)
            _, e = sc.pick(sc.scan(crop, plot_ctx(p)), planting_date)
            result["water"].append(water_for(climate, p, crop, e))
    elif analysis_type == "risk":
        per = [suitability_for(sc, p, crop_for(p), anomaly) for p in plots]
        result["plots"] = per
        rank = {"low": 1, "moderate": 2, "high": 3}
        merged: dict[str, dict] = {}
        for s in per:
            for r in s["risks"]:
                m = merged.get(r["type"])
                if m is None:
                    merged[r["type"]] = {**r, "affected_plots": [s["plot_label"]]}
                else:
                    m["affected_plots"].append(s["plot_label"])
                    if rank[r["severity"]] > rank[m["severity"]]:
                        affected = m["affected_plots"]
                        m.clear()
                        m.update({**r, "affected_plots": affected})
        result["risks"] = sorted(merged.values(), key=lambda r: -rank[r["severity"]])
    else:
        raise AppError(422, "VALIDATION_ERROR", f"Unknown analysis type {analysis_type}")

    on_stage(STAGES[3])
    return result


def summarize(result: dict, crop_id: Optional[str], labels: list[str]) -> dict:
    first = (result.get("plots") or [None])[0]
    return {"headline_score": first["suitability_score"] if first else None, "crop": (first or {}).get("crop") or crop_id, "plots": labels}


def recommend_for_location(climate: Climate, ctx: PlotCtx, top: int = 6, today: Optional[datetime] = None) -> dict:
    """What to grow at a location: used for guests. Nothing is stored."""
    if climate.record_years < 3:
        raise AppError(422, "MISSING_DATA", "Not enough historical data for this location")
    sc = Scanner(climate, today)
    ranked = ranked_crops(sc, ctx, detailed=False)
    return {
        **data_meta(climate, "historical_climatology"),
        "model_version": ENGINE_VERSION,
        "forecast_used": False,
        "disclaimer": DISCLAIMER,
        "recommended_crops": ranked[:top],
        "all_crops": [{"crop": r["crop"], "suitability_score": r["suitability_score"], "suitability_status": r["suitability_status"]} for r in ranked],
    }
