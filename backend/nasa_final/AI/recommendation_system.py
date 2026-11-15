"""Rule-based crop recommendation, version mvp-2: multi-factor and crop-specific.

mvp-1 scored every crop with the same moisture, humidity and rainfall rules, so the ranking was
decided by temperature alone. mvp-2 keeps those screening rules where no crop-specific evidence
exists, and adds factors that really differ between crops:

    temperature        20   forecast mean against the crop's range
    water              15   forecast surface moisture; for deep-rooted crops also the root zone
    rotation           20   previous crops: same crop, same botanical family, nutrient demand, legumes
    texture_drainage   10   USDA texture class of the crop's rooting depth; stones for root crops
    soil_ph            10   pH of the crop's rooting depth against the crop's range
    fertility          10   organic carbon, total nitrogen and CEC relative to the rest of Jordan
    humidity            5   forecast mean
    rainfall            5   forecast total (irrigation satisfies it)
    terrain             5   slope class

Weights are MVP heuristics, not calibrated values (crop_requirements.json -> "weights").

A factor with no data is UNKNOWN: it is left out, its weight is spread over the factors that are
known, and `coverage_pct` reports how much of the total weight was actually evaluated. An unknown
factor is never treated as suitable.

Critical rules are applied apart from the weighted score: a crop that fails one is not recommended,
whatever its rotation compatibility.

Scores are rule-based suitability indices, not probabilities of success. SoilGrids nitrogen is total
nitrogen, not plant-available nitrogen: no fertilizer amount is derived from it. Rainfall forecasts
are weak: rainfall never decides irrigation.
"""

import json
import math
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("crop_requirements.json").read_text(encoding="utf-8"))
WEIGHTS = CATALOG["weights"]
GROUPS = CATALOG["groups"]
S = CATALOG["scoring"]
CROPS = {c["id"]: c for c in CATALOG["crops"]}
PREVIOUS = {p["id"]: p for p in CATALOG["previous_crops"]["items"]}
TEXTURE_GROUP = {cls: g for g in ("light", "medium", "heavy") for cls in CATALOG["texture_groups"][g]}

TEXTURE_AR = {
    "sand": "رملية", "loamy sand": "رملية طميية", "sandy loam": "طميية رملية", "loam": "طميية", "silt loam": "طميية سلتية", "silt": "سلتية",
    "sandy clay loam": "طميية طينية رملية", "clay loam": "طميية طينية", "silty clay loam": "طميية طينية سلتية", "sandy clay": "طينية رملية",
    "silty clay": "طينية سلتية", "clay": "طينية",
}
GROUP_AR = {"light": "خفيفة", "medium": "متوسطة", "heavy": "ثقيلة"}
FAMILY_AR = {
    "Brassicaceae": "الصليبية", "Amaranthaceae": "القطيفية", "Apiaceae": "الخيمية", "Fabaceae": "البقولية", "Poaceae": "النجيلية",
    "Solanaceae": "الباذنجانية", "Cucurbitaceae": "القرعية", "Liliaceae": "الزنبقية", "Asteraceae": "المركبة",
}


def band(value, bounds, margin):
    lo, hi = bounds
    return max(0.0, 1 - max(lo - value, value - hi, 0) / margin)


def _note(component, effect, ar, en):
    """effect: positive | negative | caution | unknown"""
    return {"component": component, "effect": effect, "ar": ar, "en": en}


def _crop_name(cid, lang):
    p = PREVIOUS.get(cid) or CROPS.get(cid)
    return (p or {}).get("name_ar" if lang == "ar" else "name_en", cid)


def normalise_history(previous_crop=None, crop_history=None):
    """One list of {"crop_id", "years_ago"} (1 = last season), most recent first, de-duplicated by years_ago."""
    items = {}
    for h in crop_history or []:
        ya = int(h.get("years_ago", 1) or 1)
        if h.get("crop_id") and ya >= 1:
            items.setdefault(ya, h["crop_id"])
    if previous_crop:
        items[1] = previous_crop  # the explicitly named previous crop is the most recent one
    return [{"crop_id": cid, "years_ago": ya} for ya, cid in sorted(items.items())]


def rotation_compatibility(crop, history):
    """Score 0-100 for planting `crop` after `history`, or None when it cannot be evaluated."""
    R = S["rotation"]
    notes = []
    known = [h for h in history if (PREVIOUS.get(h["crop_id"]) or {}).get("family")]
    if not history:
        notes.append(_note("rotation", "unknown", "المحصول السابق غير معروف، فلم يُقيَّم توافق الدورة الزراعية.", "The previous crop is unknown, so rotation compatibility was not evaluated."))
        return None, notes, {"evaluated": False, "penalties": []}
    if not known:
        notes.append(_note("rotation", "unknown", "عائلة المحصول السابق غير معروفة، فلم يُقيَّم توافق الدورة الزراعية.", "The family of the previous crop is unknown, so rotation compatibility was not evaluated."))
        return None, notes, {"evaluated": False, "penalties": []}
    score, penalties = 100.0, []
    for h in known:
        w = R["year_weights"].get(str(h["years_ago"]), 0.0)
        if not w:
            continue
        prev = PREVIOUS[h["crop_id"]]
        when_ar = "الموسم الماضي" if h["years_ago"] == 1 else f"قبل {h['years_ago']} مواسم"
        when_en = "last season" if h["years_ago"] == 1 else f"{h['years_ago']} seasons ago"
        if h["crop_id"] == crop["id"]:
            p = R["same_crop_penalty"] * w
            penalties.append({"kind": "same_crop", "crop_id": h["crop_id"], "years_ago": h["years_ago"], "penalty": p})
            notes.append(_note("rotation", "negative", f"المحصول نفسه زُرع {when_ar}؛ تكرار المحصول يزيد أمراضه وآفاته.", f"The same crop was grown {when_en}; repeating a crop builds up its diseases and pests."))
        elif prev["family"] == crop["family"]:
            p = R["same_family_penalty"] * w
            penalties.append({"kind": "same_family", "crop_id": h["crop_id"], "years_ago": h["years_ago"], "penalty": p})
            notes.append(
                _note(
                    "rotation",
                    "negative",
                    f"{prev['name_ar']} ({when_ar}) من العائلة نفسها ({FAMILY_AR.get(crop['family'], crop['family'])})، وهي تشترك في الأمراض والآفات.",
                    f"{prev['name_en']} ({when_en}) is from the same family ({crop['family']}), which shares diseases and pests.",
                )
            )
        else:
            p = 0.0
        score -= p
    last = known[0] if known[0]["years_ago"] == 1 else None
    if last:
        prev = PREVIOUS[last["crop_id"]]
        if not any(p["years_ago"] == 1 for p in penalties):
            notes.append(_note("rotation", "positive", f"عائلة نباتية مختلفة عن المحصول السابق ({prev['name_ar']}).", f"A different botanical family from the previous crop ({prev['name_en']})."))
        if prev.get("nutrient_demand") == "high" and crop["nutrient_demand"]["category"] == "high":
            score -= R["heavy_after_heavy_penalty"]
            notes.append(_note("rotation", "caution", "محصول عالي الاحتياج للنيتروجين بعد محصول عالي الاحتياج؛ افحص خصوبة التربة.", "A high nitrogen-demand crop after another high-demand crop; check soil fertility."))
        if prev["family"] == "Fabaceae" and crop["family"] != "Fabaceae":
            score += R["after_legume_bonus"]
            notes.append(_note("rotation", "positive", "المحصول السابق بقولي، وقد يفيد المحصول التالي، دون ضمان لزيادة نيتروجين التربة.", "The previous crop was a legume, which may benefit the next crop; no increase in soil nitrogen is guaranteed."))
    if len(known) < len(history):
        notes.append(_note("rotation", "unknown", "بعض محاصيل السجل غير معروفة العائلة ولم تدخل في التقييم.", "Some crops in the history have no known family and were left out."))
    return round(max(0.0, min(100.0, score)), 1), notes, {"evaluated": True, "penalties": penalties}


def _soil_view(crop, site):
    """Soil values over the crop's rooting depth, or None when the site has no soil data."""
    if not site or not site.get("soil"):
        return None
    top, bottom = crop["rooting"]["soil_layers_cm"]
    dk = f"{top}-{bottom}"
    soil = site["soil"]
    values = soil["by_depth"].get(dk)
    if values is None:
        return None
    return {
        "depth_cm": [top, bottom],
        "values": values,
        "texture_class": soil["texture_class"].get(dk),
        "fertility_percentile": soil["fertility_percentile"].get(dk, {}),
    }


def _terrain_score(slope_pct):
    for limit, score in S["slope_classes_pct"]:
        if slope_pct <= limit:
            return float(score)
    return 0.0


def evaluate_crop(crop, horizon_days, temperature_c, humidity_pct, soil_moisture_m3_m3, rainfall_mm, irrigation_available, soil_ph, site, history):
    notes, critical = [], []
    comp = {}
    soil = _soil_view(crop, site)
    hist = (site or {}).get("history")

    # --- temperature (forecast) ---
    lo, hi = crop["temp"]
    temp = band(temperature_c, crop["temp"], S["temperature_margin_c"])
    comp["temperature"] = round(100 * temp, 1)
    if temp == 1:
        notes.append(_note("temperature", "positive", "متوسط الحرارة ضمن النطاق المقترح للمحصول", "Mean temperature is within the range suggested for the crop"))
    else:
        side_ar, side_en = ("أعلى", "above") if temperature_c > hi else ("أدنى", "below")
        notes.append(_note("temperature", "negative", f"متوسط الحرارة المتوقع ({temperature_c:.1f}°م) {side_ar} من نطاق المحصول ({lo}–{hi}°م)", f"Forecast mean temperature ({temperature_c:.1f} C) is {side_en} the crop's range ({lo}-{hi} C)"))

    # --- water: forecast surface moisture; deep-rooted crops also look at the observed root zone ---
    surface = band(soil_moisture_m3_m3, S["moisture_band_m3_m3"], S["moisture_margin"])
    water_soil, used_root = surface, False
    if crop["moisture"]["uses_root_zone"]:
        rz = (hist or {}).get("root_zone_moisture_m3_m3")
        if rz is not None:
            share = S["root_zone_share_for_deep_rooted"]
            water_soil = (1 - share) * surface + share * band(rz, S["moisture_band_m3_m3"], S["moisture_margin"])
            used_root = True
            notes.append(_note("water", "caution" if band(rz, S["moisture_band_m3_m3"], S["moisture_margin"]) < 0.8 else "positive", f"محصول عميق الجذور: دخلت رطوبة منطقة الجذور المرصودة تاريخياً ({rz:.2f} م³/م³) في التقييم.", f"Deep-rooted crop: historically observed root-zone moisture ({rz:.2f} m3/m3) was included."))
        else:
            notes.append(_note("water", "unknown", "محصول عميق الجذور، لكن رطوبة منطقة الجذور غير متاحة؛ استُخدمت رطوبة السطح فقط.", "Deep-rooted crop, but root-zone moisture is not available; only surface moisture was used."))
    if irrigation_available is True:
        blend = S["irrigation_water_blend"]
        water = (1 - blend) * water_soil + blend * 1.0
    else:
        water = water_soil
    comp["water"] = round(100 * water, 1)
    if surface < 0.8:
        notes.append(_note("water", "negative", "مؤشر رطوبة سطح التربة بعيد عن نطاق الفحص الأولي", "Surface soil moisture is far from the screening range"))
    if irrigation_available is True:
        notes.append(_note("water", "positive", "الري متوفر، فيعوّض نقص رطوبة التربة جزئياً.", "Irrigation is available and partly offsets low soil moisture."))
    elif irrigation_available is None:
        notes.append(_note("water", "unknown", "توفر الري غير معروف", "Irrigation availability is unknown"))
    else:
        notes.append(_note("water", "caution", f"لا يوجد ري، والمحصول {('عالي الاحتياج المائي' if crop['moisture']['demand'].startswith('high') else 'يحتاج ماءً منتظماً')}.", "No irrigation, and the crop has a high water demand."))

    # --- rainfall (forecast total; weak accuracy) ---
    rain_rate = rainfall_mm / horizon_days
    rain = 1.0 if irrigation_available is True else min(1.0, rain_rate / S["rain_rate_full_mm_per_day"])
    comp["rainfall"] = round(100 * rain, 1)
    if rain < 0.5:
        notes.append(_note("rainfall", "negative", "الأمطار المتوقعة قليلة نسبيًا؛ تحقق من توفر الماء", "Expected rainfall is relatively low; check that water is available"))

    # --- humidity (forecast) ---
    humidity = band(humidity_pct, S["humidity_band_pct"], S["humidity_margin"])
    comp["humidity"] = round(100 * humidity, 1)
    if humidity < 0.8:
        notes.append(_note("humidity", "negative", "الرطوبة الجوية خارج نطاق الفحص الأولي", "Air humidity is outside the screening range"))
    if crop["humidity_sensitivity"].get("note") and humidity_pct >= S["humidity_band_pct"][1]:
        notes.append(_note("humidity", "caution", "رطوبة جوية عالية: يزداد خطر أمراض الأوراق عند بقاء المجموع الخضري مبتلاً.", "High air humidity: leaf disease risk rises when foliage stays wet."))

    # --- soil pH over the rooting depth (static, or laboratory value) ---
    ph_item = (soil or {}).get("values", {}).get("ph") if soil else None
    ph_value = ph_item["value"] if ph_item else None
    if ph_value is None and soil_ph is not None:
        ph_value, ph_item = soil_ph, {"value": soil_ph, "source": "provided"}
    if ph_value is None:
        comp["soil_ph"] = None
        notes.append(_note("soil_ph", "unknown", "حموضة التربة غير متاحة", "Soil pH is not available"))
    else:
        ph = band(ph_value, crop["ph"], S["ph_margin"])
        comp["soil_ph"] = round(100 * ph, 1)
        if ph == 1:
            notes.append(_note("soil_ph", "positive", f"حموضة التربة ({ph_value:.1f}) ضمن نطاق المحصول ({crop['ph'][0]}–{crop['ph'][1]}).", f"Soil pH ({ph_value:.1f}) is within the crop's range ({crop['ph'][0]}-{crop['ph'][1]})."))
        else:
            notes.append(_note("soil_ph", "negative", f"حموضة التربة ({ph_value:.1f}) خارج النطاق التقريبي للمحصول ({crop['ph'][0]}–{crop['ph'][1]}).", f"Soil pH ({ph_value:.1f}) is outside the crop's approximate range ({crop['ph'][0]}-{crop['ph'][1]})."))

    # --- texture and drainage over the rooting depth ---
    cls = (soil or {}).get("texture_class") if soil else None
    texture_needs_amendment = False
    if cls is None:
        comp["texture_drainage"] = None
        notes.append(_note("texture_drainage", "unknown", "قوام التربة غير متاح لهذا الموقع.", "Soil texture is not available for this location."))
    else:
        group = TEXTURE_GROUP.get(cls, "medium")
        t = crop["texture"]
        level = "preferred" if group in t["preferred"] else "needs_amendment" if group in t["needs_amendment"] else "acceptable"
        score = float(S["texture_scores"][level])
        texture_needs_amendment = level == "needs_amendment"
        depth = soil["depth_cm"]
        cls_ar = TEXTURE_AR.get(cls, cls)
        if level == "preferred":
            notes.append(_note("texture_drainage", "positive", f"قوام التربة ({cls_ar}، {GROUP_AR[group]}) مفضّل لهذا المحصول (عمق {depth[0]}–{depth[1]} سم).", f"Soil texture ({cls}, {group}) is preferred for this crop ({depth[0]}-{depth[1]} cm)."))
        elif level == "acceptable":
            notes.append(_note("texture_drainage", "caution", f"قوام التربة ({cls_ar}، {GROUP_AR[group]}) مقبول لهذا المحصول وليس المفضّل.", f"Soil texture ({cls}, {group}) is acceptable for this crop, not the preferred one."))
        else:
            notes.append(_note("texture_drainage", "negative", f"تربة {GROUP_AR[group]} ({cls_ar}): هذا المحصول يفضّل تربة أخف وأحسن صرفاً، والتربة الثقيلة تحتاج إضافة مادة عضوية.", f"Heavy soil ({cls}): this crop prefers lighter, better-drained soil; heavy soil needs organic matter added."))
        cf = soil["values"]["coarse_fragments"]["value"]
        if crop["stones_sensitive"]["value"] and cf is not None:
            classes = S["coarse_fragment_classes_pct"]
            if cf >= classes["very_gravelly"]:
                score -= S["coarse_fragment_penalty"]["very_gravelly"]
                notes.append(_note("texture_drainage", "negative", f"حصى وحجارة كثيرة في التربة ({cf:.0f}٪)، وهي تشوّه المحاصيل الجذرية.", f"Many stones in the soil ({cf:.0f} %), which deform root crops."))
            elif cf >= classes["gravelly"]:
                score -= S["coarse_fragment_penalty"]["gravelly"]
                notes.append(_note("texture_drainage", "caution", f"التربة حصوية ({cf:.0f}٪)؛ قد تتشوّه بعض الجذور.", f"Gravelly soil ({cf:.0f} %); some roots may be deformed."))
        if group == "heavy":
            notes.append(_note("texture_drainage", "caution", "الصرف مستنتج من القوام: التربة الثقيلة أبطأ صرفاً، والمحصول يحتاج صرفاً جيداً.", "Drainage is inferred from texture: heavy soil drains slowly and the crop needs good drainage."))
        comp["texture_drainage"] = round(max(0.0, score), 1)

    # --- fertility indicators, relative to the rest of Jordan ---
    ranks = (soil or {}).get("fertility_percentile", {}) if soil else {}
    organic = [ranks.get(k) for k in ("organic_carbon", "nitrogen") if ranks.get(k) is not None]
    parts = ([sum(organic) / len(organic)] if organic else []) + ([ranks["cec"]] if ranks.get("cec") is not None else [])
    if not parts:
        comp["fertility"] = None
        notes.append(_note("fertility", "unknown", "مؤشرات خصوبة التربة غير متاحة لهذا الموقع.", "Soil fertility indicators are not available for this location."))
    else:
        index = sum(parts) / len(parts)
        demand = crop["nutrient_demand"]["category"]
        k = S["fertility_demand_sensitivity"][demand]
        comp["fertility"] = round(100 - k * (100 - index), 1)
        demand_ar = {"high": "عالي", "medium": "متوسط", "low": "منخفض"}[demand]
        effect = "positive" if comp["fertility"] >= 75 else "caution" if comp["fertility"] >= 50 else "negative"
        notes.append(_note("fertility", effect, f"مؤشر الخصوبة أعلى من {index:.0f}٪ من مواقع الأردن، واحتياج المحصول للنيتروجين {demand_ar}.", f"The fertility index is above {index:.0f} % of locations in Jordan, and the crop's nitrogen demand is {demand}."))

    # --- terrain: slope class only ---
    slope = ((site or {}).get("terrain") or {}).get("slope_pct")
    if slope is None:
        comp["terrain"] = None
    else:
        comp["terrain"] = _terrain_score(slope)
        if comp["terrain"] < 100:
            notes.append(_note("terrain", "caution" if comp["terrain"] >= 60 else "negative", f"الأرض مائلة ({slope:.0f}٪): يزيد خطر الانجراف وصعوبة الري.", f"Sloping land ({slope:.0f} %): erosion risk and irrigation difficulty increase."))

    # --- rotation ---
    rot_score, rot_notes, rot_detail = rotation_compatibility(crop, history)
    comp["rotation"] = rot_score
    notes.extend(rot_notes)

    # --- contextual indicators from historical observations (no score) ---
    frost_freq = (hist or {}).get("frost_frequency")
    frost_risk = False
    if hist:
        if crop["frost"]["sensitivity"] == "sensitive" and frost_freq:
            frost_risk = True
            notes.append(_note("history", "negative", f"محصول حساس للصقيع، وحدث صقيع في هذه الفترة في {round(100 * frost_freq)}٪ من السنوات السابقة.", f"Frost-sensitive crop, and frost occurred in this window in {round(100 * frost_freq)} % of earlier years."))
        limit = crop["heat_limit_c"].get("value")
        tmax = hist.get("t2m_max_mean_c")
        if limit is not None and tmax is not None and tmax > limit:
            notes.append(_note("history", "caution", f"متوسط الحرارة العظمى المرصودة تاريخياً ({tmax:.1f}°م) يتجاوز الحد الذي ينمو عنده المحصول جيداً ({limit}°م).", f"Historically observed mean daily maximum ({tmax:.1f} C) exceeds the limit at which the crop grows best ({limit} C)."))
    if crop["days"][1] > horizon_days:
        notes.append(_note("duration", "caution", "قد يتأخر الحصاد عن الفترة المحددة حسب الصنف والظروف", "Harvest may come later than the period, depending on variety and conditions"))
    if crop["frost"]["sensitivity"] == "sensitive" and not hist:
        notes.append(_note("history", "caution", "تحقق من خطر الصقيع قبل الزراعة", "Check the frost risk before planting"))

    # --- weighted score over the known factors ---
    known = {k: v for k, v in comp.items() if v is not None}
    total_w = sum(WEIGHTS[k] for k in known)
    score = sum(WEIGHTS[k] * v for k, v in known.items()) / total_w
    env_known = {k: v for k, v in known.items() if k != "rotation"}
    env_w = sum(WEIGHTS[k] for k in env_known)
    environment = sum(WEIGHTS[k] * v for k, v in env_known.items()) / env_w
    groups = {}
    for g, members in GROUPS.items():
        m = [k for k in members if comp.get(k) is not None]
        groups[g] = round(sum(WEIGHTS[k] * comp[k] for k in m) / sum(WEIGHTS[k] for k in m), 1) if m else None

    # --- critical rules, independent of the weighted score ---
    if temp < 0.4:
        critical.append(_note("temperature", "negative", "الحرارة المتوقعة بعيدة جداً عن نطاق المحصول.", "The forecast temperature is far outside the crop's range."))
    if irrigation_available is False and surface < 0.3 and rain < 0.5:
        critical.append(_note("water", "negative", "لا ري، والتربة جافة، والأمطار المتوقعة قليلة.", "No irrigation, dry soil and little expected rain."))
    if frost_risk and frost_freq >= S["frost"]["critical_frequency"]:
        critical.append(_note("history", "negative", "محصول حساس للصقيع والصقيع متكرر في هذه الفترة.", "Frost-sensitive crop and frost is frequent in this window."))
    blocked = bool(critical)
    if blocked:
        score = min(score, 49.0)
    st = S["status"]
    if blocked or score < st["not_recommended_below"]:
        status = "not_recommended"
    elif (
        score < st["conditional_below"]
        or temp < 1
        or irrigation_available is not True
        or surface < 0.8
        or (comp["soil_ph"] is not None and comp["soil_ph"] < 100)
        or (rot_score is not None and rot_score < st["rotation_conditional_below"])
        or texture_needs_amendment
        or frost_risk
    ):
        status = "conditional"
    else:
        status = "suitable_candidate"

    return {
        "crop_id": crop["id"],
        "name_ar": crop["name_ar"],
        "name_en": crop["name_en"],
        "family": crop["family"],
        "score": round(score, 2),
        "environment_score": round(environment, 2),
        "status": status,
        "days_to_harvest": crop["days"],
        "note_ar": crop["note_ar"],
        "component_scores": comp,
        "factor_scores": {k: v for k, v in comp.items() if v is not None},
        "group_scores": groups,
        "rotation": {"score": rot_score, **rot_detail},
        "coverage_pct": round(100.0 * total_w / sum(WEIGHTS.values()), 1),
        "missing_factors": [k for k, v in comp.items() if v is None],
        "critical_failures": critical,
        "explanations": notes,
        "reasons": [n["ar"] for n in notes if n["effect"] == "positive"],
        "risks": [n["ar"] for n in notes if n["effect"] in ("negative", "caution", "unknown")] + [c["ar"] for c in critical],
        "soil_used": None
        if not soil
        else {"depth_cm": soil["depth_cm"], "rooting_basis": crop["rooting"]["basis"], "texture_class": cls, "water_used_root_zone": used_root},
    }


def recommend(
    horizon_days,
    temperature_c,
    humidity_pct,
    soil_moisture_m3_m3,
    rainfall_mm,
    irrigation_available=None,
    soil_ph=None,
    *,
    site=None,
    previous_crop=None,
    crop_history=None,
):
    """Rank the crops of the horizon.

    The four forecast values are required. `site` is the dict of environment_service.site_context
    (soil by rooting depth, terrain, historical observations); without it the soil, fertility and
    terrain factors are unknown. `previous_crop` / `crop_history` ([{"crop_id", "years_ago"}]) feed
    the rotation factor; without them it is unknown.
    """
    if horizon_days not in (30, 90):
        raise ValueError("horizon must be 30 or 90")
    values = [temperature_c, humidity_pct, soil_moisture_m3_m3, rainfall_mm]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("Non-finite forecast")
    if not (-60 <= temperature_c <= 65 and 0 <= humidity_pct <= 100 and 0 <= soil_moisture_m3_m3 <= 1 and rainfall_mm >= 0):
        raise ValueError("Invalid forecast units/range")
    if soil_ph is not None and not (math.isfinite(soil_ph) and 0 <= soil_ph <= 14):
        raise ValueError("Invalid soil pH")
    for cid in [previous_crop] + [h.get("crop_id") for h in crop_history or []]:
        if cid is not None and cid not in PREVIOUS:
            raise ValueError(f"unknown previous crop: {cid}")
    history = normalise_history(previous_crop, crop_history)

    results = [
        evaluate_crop(crop, horizon_days, temperature_c, humidity_pct, soil_moisture_m3_m3, rainfall_mm, irrigation_available, soil_ph, site, history)
        for crop in CATALOG["crops"]
        if crop["horizon"] == horizon_days
    ]
    results.sort(key=lambda x: (x["status"] != "not_recommended", x["score"]), reverse=True)
    best = next((r["crop_id"] for r in results if r["status"] != "not_recommended"), None)
    previous = [{**h, "family": (PREVIOUS.get(h["crop_id"]) or {}).get("family")} for h in history]
    return {
        "horizon_days": horizon_days,
        "rule_version": CATALOG["version"],
        "status": "ok" if best else "no_suitable_recommendation",
        "best_candidate": best,
        "recommendations": results,
        "previous_crops": previous,
        "weights": WEIGHTS,
        "weight_policy": "A factor with no data is unknown: it is left out and its weight is spread proportionally over the known factors. coverage_pct is the share of the total weight that was evaluated.",
        "warnings": [
            "درجة الملاءمة مؤشر قواعد وليست احتمال نجاح أو ضمان حصاد",
            "توقع الأمطار ضعيف الدقة؛ لا تستخدمه لتحديد كمية الري",
            "متوسط الفترة لا يكشف الصقيع أو موجات الحر؛ تحقق من الطقس الفعلي",
            "قواعد تجريبية غير معايرة محليًا؛ رطوبة السطح ليست رطوبة منطقة الجذور",
            "نيتروجين التربة هنا نيتروجين كلي من SoilGrids وليس المتاح للنبات؛ لا تُحدَّد منه كميات السماد",
        ],
    }
