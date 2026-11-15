"""Rotation engine: always returns exactly three strategies.

- current: the present rotation continued and scored as-is
- option_a: soil-health focus
- option_b: water-saving or income focus, following the farmer's priority

Rules: avoid the same plant family in consecutive seasons; reward a legume after a non-legume
(nitrogen fixation); alternate rooting depths; only crops scoring at least 40 for the plot.
Each strategy carries the five sections required by the challenge: why, evidence, benefits,
information gaps, and risks to review with a local agricultural engineer.

Port of frontend/src/lib/engine/rotation.ts.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from app.engine.config import annual_crops, crops
from app.engine.features import Climate, r0
from app.engine.suitability import Evaluation, PlotCtx, best_index, best_window, scan_year, today_utc

SEASONS_AHEAD = 3
MIN_SUITABILITY = 40


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


def _root_class(c: dict) -> str:
    deep = c["root_depth"]["value"][1]
    return "shallow" if deep <= 0.8 else "medium" if deep <= 1.3 else "deep"


def next_seasons(today: datetime) -> list[str]:
    # the agricultural season runs autumn to summer; the "current" season starts in September
    y = today.year if today.month >= 9 else today.year - 1
    return [f"{y + 1 + i}-{y + 2 + i}" for i in range(SEASONS_AHEAD)]


def best_evaluations(climate: Climate, plot: PlotCtx, scan=None) -> dict[str, Evaluation]:
    scan = scan or (lambda crop: scan_year(climate, crop, plot))
    best = {}
    for c in annual_crops():
        evals = scan(c)
        w = best_window(evals)
        best[c["id"]] = evals[w["best"] if w else best_index(evals)]
    return best


def build_rotation(
    climate: Climate,
    plot: PlotCtx,
    current_crop_id: Optional[str],
    previous_crop_id: Optional[str],
    history: list[dict],
    priority: str,
    today: Optional[datetime] = None,
    best: Optional[dict[str, Evaluation]] = None,
) -> dict:
    CROPS = crops()
    ANNUAL = annual_crops()
    seasons = next_seasons(today or today_utc())
    best = best or best_evaluations(climate, plot)

    def suit(cid):
        return best[cid].score if cid and cid in best else None

    # past sequence, oldest to newest, ending with the crop in the ground now
    past: list[Optional[str]] = [h["crop_id"] for h in sorted(history, key=lambda h: h["season"])]
    if not past:
        past.append(previous_crop_id)
    past.append(current_crop_id)
    perennial = bool(current_crop_id and CROPS.get(current_crop_id, {}).get("perennial"))

    def crop_of(cid):
        return CROPS.get(cid) if cid else None

    def transition_score(prev: list, cand: dict) -> float:
        p1 = crop_of(prev[-1]) if prev else None
        p2 = crop_of(prev[-2]) if len(prev) >= 2 else None
        s = 0.0
        if p1 and p1["family"] == cand["family"]:
            s -= 40
        if p2 and p2["family"] == cand["family"]:
            s -= 15
        if cand["nitrogen_fixing"] and (not p1 or not p1["nitrogen_fixing"]):
            s += 30
        if p1 and _root_class(p1) != _root_class(cand):
            s += 12
        return s

    def plan(objective: str, avoid_first: Optional[str] = None) -> list[Optional[str]]:
        seq: list[Optional[str]] = []
        for i in range(SEASONS_AHEAD):
            prev = past + seq
            pick = None
            for c in ANNUAL:
                e = best[c["id"]]
                if e.score < MIN_SUITABILITY:
                    continue
                if i == 0 and avoid_first == c["id"]:
                    continue
                val = transition_score(prev, c)
                if objective == "soil":
                    val = val * 1.3 + e.score * 0.3
                elif objective == "water":
                    val = val * 0.7 + e.score * 0.35 - (e.stats.irrigation if plot.irrigation_available else e.stats.etc) * 0.06
                else:
                    val = val * 0.7 + e.score * 0.4 + c["income"]["value"] * 14
                if pick is None or val > pick[1]:
                    pick = (c["id"], val)
            seq.append(pick[0] if pick else None)
        return seq

    # current rotation continued as-is: repeat the recent pattern
    pattern = past[-min(3, len(past)):]
    current = [pattern[i % len(pattern)] for i in range(SEASONS_AHEAD)]
    b_objective = "income" if priority == "increase_income" else "water"
    option_a = plan("soil")
    option_b = plan(b_objective)
    # the two options must be real alternatives
    if option_b == option_a:
        alt = plan(b_objective, option_a[0])
        if alt[0] is not None:
            option_b = alt
    seqs = {"current": current, "option_a": current if perennial else option_a, "option_b": current if perennial else option_b}

    def score(seq: list) -> dict:
        full = past[-1:] + seq
        soil = 55.0
        etc = 0.0
        income = 0.0
        for i in range(1, len(full)):
            cur = crop_of(full[i])
            prev = crop_of(full[i - 1])
            if not cur:
                soil -= 8  # bare fallow: no cover, no residues
                continue
            e = best.get(cur["id"])
            etc += e.stats.etc if e else 0
            income += (cur["income"]["value"] / 3) * (e.score if e else 50)
            if cur["nitrogen_fixing"]:
                soil += 12
            if prev and prev["family"] == cur["family"]:
                soil -= 15
            elif prev:
                soil += 5
            if prev and _root_class(prev) != _root_class(cur):
                soil += 5
        mean_etc = etc / len(seq)
        return {
            "water_use": r0(_clamp(100 - ((mean_etc - 150) / 750) * 100)),
            "soil_health": r0(_clamp(soil)),
            "income_potential": r0(_clamp(income / len(seq))),
            "mean_etc": mean_etc,
        }

    def name(cid, lang):
        if not cid:
            return "بور" if lang == "ar" else "fallow"
        return CROPS[cid]["name"][lang] if cid in CROPS else cid

    def seq_text(seq, lang):
        return (" ← " if lang == "ar" else " → ").join(name(x, lang) for x in seq)

    period = f"{climate.first_year}–{climate.last_year}"
    winter_rain = best["wheat"].stats.rain

    def gaps() -> list[dict]:
        g = []
        if plot.soil_ph is None or not plot.soil_type:
            g.append({"ar": "لا يوجد فحص تربة للقطعة (pH، نوع التربة، الملوحة، المادة العضوية).", "en": "No soil test for this plot (pH, texture, salinity, organic matter)."})
        if len(history) < 2:
            g.append({"ar": "سجل المحاصيل أقل من موسمين؛ أضف المواسم السابقة لتقييم أدق.", "en": "Crop history covers fewer than two seasons; add earlier seasons for a better assessment."})
        g.append({"ar": "إمكانية الدخل مؤشر نسبي لا يشمل أسعار السوق الحالية ولا تكاليف الإنتاج.", "en": "Income potential is a relative indicator that excludes current market prices and production costs."})
        g.append({"ar": "رطوبة التربة والأمطار مقدَّرة من بيانات مناخية على مستوى المنطقة، وليست قياساً ميدانياً في القطعة نفسها.", "en": "Soil moisture and rainfall are estimated from area-level climate data, not measured in the plot itself."})
        if plot.irrigation_available:
            g.append({"ar": "كمية مياه الري المتاحة فعلياً ونوعيتها (الملوحة) غير معروفة.", "en": "The actual quantity and quality (salinity) of irrigation water are unknown."})
        return g

    def review_risks(seq: list) -> list[dict]:
        out = [{"ar": "تأكيد مواعيد الزراعة والأصناف المناسبة للمنطقة.", "en": "Confirm planting dates and varieties suited to the area."}]
        fams = [CROPS[x]["family"] if x and x in CROPS else None for x in seq]
        if any(f and i > 0 and f == fams[i - 1] for i, f in enumerate(fams)):
            out.append({"ar": "تكرار العائلة النباتية نفسها في موسمين متتاليين قد يزيد أمراض التربة والآفات.", "en": "Repeating the same plant family in consecutive seasons may increase soil-borne diseases and pests."})
        if "Solanaceae" in fams:
            out.append({"ar": "محاصيل العائلة الباذنجانية (بندورة، بطاطا، باذنجان) حساسة لأمراض التربة والنيماتودا؛ راجع تاريخ الإصابات.", "en": "Solanaceae crops (tomato, potato, eggplant) are sensitive to soil-borne diseases and nematodes; review the infection history."})
        if any(x and CROPS.get(x, {}).get("nitrogen_fixing") for x in seq):
            out.append({"ar": "نجاح تثبيت النيتروجين في البقوليات يعتمد على وجود بكتيريا العقد الجذرية؛ قد يلزم التلقيح.", "en": "Nitrogen fixation by legumes depends on the right rhizobia being present; inoculation may be needed."})
        if any(x is None for x in seq):
            out.append({"ar": "البور المكشوف يعرّض التربة للانجراف وفقد الرطوبة؛ ناقش بدائل التغطية.", "en": "Bare fallow exposes soil to erosion and moisture loss; discuss cover options."})
        if not plot.irrigation_available:
            out.append({"ar": "الزراعة البعلية تتأثر بتذبذب الأمطار بين السنوات؛ ناقش خيارات الري التكميلي.", "en": "Rainfed cropping depends on year-to-year rainfall; discuss supplemental irrigation options."})
        return out

    cur_score = score(seqs["current"])

    def build(key: str, focus: str, title: dict) -> dict:
        seq = seqs[key]
        sc = score(seq)
        legumes = sum(1 for x in seq if x and CROPS.get(x, {}).get("nitrogen_fixing"))
        repeats = 0
        for i, x in enumerate(seq):
            before = seq[i - 1] if i else past[-1]
            if x and before and before in CROPS and CROPS[x]["family"] == CROPS[before]["family"]:
                repeats += 1
        why = []
        if perennial:
            why.append({"ar": "القطعة مزروعة بأشجار معمّرة، لذلك لا تنطبق الدورة الزراعية السنوية؛ تبقى الأشجار في كل الاستراتيجيات.", "en": "The plot carries perennial trees, so an annual rotation does not apply; the trees stay in every strategy."})
        elif key == "current":
            why.append({"ar": f"استمرار النمط الحالي: {seq_text(seq, 'ar')}، ويُقيَّم كما هو دون تغيير.", "en": f"Continuing the current pattern: {seq_text(seq, 'en')}, scored as-is."})
            if repeats:
                why.append({"ar": f"يتكرر المحصول أو عائلته في {repeats} موسم متتالٍ.", "en": f"The crop or its family repeats in {repeats} consecutive season(s)."})
        elif key == "option_a":
            why.append({"ar": f"تركّز على صحة التربة: {legumes} موسم بقوليات لتثبيت النيتروجين، مع تجنب تكرار العائلة النباتية وتبديل أعماق الجذور.", "en": f"Soil-health focus: {legumes} legume season(s) for nitrogen fixation, avoiding repeated plant families and alternating rooting depths."})
            why.append({"ar": "اختيرت فقط المحاصيل التي تتجاوز ملاءمتها 40 من 100 لهذه القطعة.", "en": "Only crops scoring above 40/100 for this plot were considered."})
        elif b_objective == "income":
            why.append({"ar": "تتبع أولويتك «زيادة الدخل»: تفضّل المحاصيل ذات مؤشر الدخل الأعلى والملاءمة الجيدة، مع احترام قاعدة عدم تكرار العائلة.", "en": 'Follows your "increase income" priority: prefers crops with a higher income indicator and good suitability, still avoiding repeated families.'})
        else:
            why.append({"ar": "تتبع أولوية «توفير المياه»: تفضّل المحاصيل الأقل احتياجاً للماء (ETc) والملائمة للقطعة، مع احترام قاعدة عدم تكرار العائلة.", "en": 'Follows the "save water" priority: prefers crops with lower water demand (ETc) that fit the plot, still avoiding repeated families.'})

        evidence = []
        seen = []
        for x in seq:
            if x and x not in seen:
                seen.append(x)
                e = best.get(x)
                evidence.append({"metric": f"suitability_{x}", "label": {"ar": f"ملاءمة {name(x, 'ar')}", "en": f"{name(x, 'en')} suitability"}, "value": r0(e.score) if e else None, "unit": "/100", "period": period, "source": "NASA POWER + FAO ECOCROP"})
        evidence.append({"metric": "mean_seasonal_etc_mm", "label": {"ar": "متوسط الاحتياج المائي الموسمي", "en": "Mean seasonal water demand (ETc)"}, "value": r0(sc["mean_etc"]), "unit": "mm", "period": period, "source": "NASA POWER + FAO-56"})
        evidence.append({"metric": "winter_season_rainfall_mm", "label": {"ar": "أمطار الموسم الشتوي", "en": "Winter-season rainfall"}, "value": r0(winter_rain), "unit": "mm", "period": period, "source": "NASA POWER"})

        benefits = []
        if key == "current":
            benefits.append({"ar": "لا تغيير في الممارسات أو المعدات أو التسويق.", "en": "No change in practices, equipment or marketing."})
        else:
            d = lambda a, b: f"+{a - b}" if a - b >= 0 else f"{a - b}"  # noqa: E731
            benefits.append({
                "ar": f"مقارنة بالدورة الحالية: صحة التربة {d(sc['soil_health'], cur_score['soil_health'])}، كفاءة المياه {d(sc['water_use'], cur_score['water_use'])}، إمكانية الدخل {d(sc['income_potential'], cur_score['income_potential'])} نقطة.",
                "en": f"Versus the current rotation: soil health {d(sc['soil_health'], cur_score['soil_health'])}, water efficiency {d(sc['water_use'], cur_score['water_use'])}, income potential {d(sc['income_potential'], cur_score['income_potential'])} points.",
            })
            if legumes:
                benefits.append({"ar": "البقوليات تثبّت النيتروجين الجوي وتترك جزءاً منه للمحصول التالي.", "en": "Legumes fix atmospheric nitrogen and leave part of it for the following crop."})
            if not repeats:
                benefits.append({"ar": "تبديل العائلات النباتية يكسر دورات الآفات وأمراض التربة.", "en": "Changing plant families breaks pest and soil-borne disease cycles."})
        return {
            "key": key,
            "title": title,
            "focus": focus,
            "sequence": [{"season": seasons[i], "crop": x, "suitability_score": None if suit(x) is None else r0(suit(x))} for i, x in enumerate(seq)],
            "scores": {"water_use": sc["water_use"], "soil_health": sc["soil_health"], "income_potential": sc["income_potential"]},
            "why": why,
            "evidence": evidence,
            "benefits": benefits,
            "information_gaps": gaps(),
            "risks_for_review": review_risks(seq),
        }

    b_title = {"ar": "الخيار ب: زيادة الدخل", "en": "Option B: higher income"} if b_objective == "income" else {"ar": "الخيار ب: توفير المياه", "en": "Option B: water saving"}
    return {
        "seasons": seasons,
        "strategies": [
            build("current", "current", {"ar": "الدورة الحالية", "en": "Current rotation"}),
            build("option_a", "soil_health", {"ar": "الخيار أ: صحة التربة", "en": "Option A: soil health"}),
            build("option_b", b_objective, b_title),
        ],
    }
