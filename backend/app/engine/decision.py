"""Base rules that turn a model forecast into a crop decision.

This is the place to grow the "what to plant" rules once the AI team's model outputs are available.
The forecast predicts conditions (temperature, humidity, soil moisture, rain); these rules judge
whether those conditions suit each crop. The two stay separate on purpose: a suitability figure is
not a probability of a successful harvest and is not the model's confidence.

Current rule set (v0, deliberately small):
  - temperature fit: the crop's ECOCROP temperature trapezoid applied to the forecast average.
More rules (soil moisture, rainfall against water demand, humidity) should be added here when the
team agrees thresholds; each needs a documented source like every value in crops.json.
"""

from __future__ import annotations

from app.engine.config import crop_list, status_of, trapezoid
from app.engine.features import r0, r1

RULES_VERSION = "forecast-rules-v0"


def crop_outlook(forecast: dict) -> dict:
    """Rank crops for the forecast period from the forecast summary."""
    s = forecast.get("summary") or {}
    t = s.get("average_temperature_c")
    period = forecast.get("forecast", {})
    out = []
    if t is not None:
        for c in crop_list():
            T = c["temp"]
            fit = trapezoid(t, T["abs_min"]["value"], T["opt_min"]["value"], T["opt_max"]["value"], T["abs_max"]["value"])
            lo, hi = T["opt_min"]["value"], T["opt_max"]["value"]
            inside = lo <= t <= hi
            out.append({
                "crop": c["id"],
                "temperature_fit": r0(fit),
                "category": status_of(fit),
                "reason": {
                    "ar": f"متوسط الحرارة المتوقع {r1(t)}°م {'ضمن' if inside else 'خارج'} النطاق المثالي لـ{c['name']['ar']} ({lo:g}–{hi:g}°م).",
                    "en": f"The forecast average temperature of {r1(t)} °C is {'inside' if inside else 'outside'} the optimal range for {c['name']['en']} ({lo:g}–{hi:g} °C).",
                },
            })
        out.sort(key=lambda x: -x["temperature_fit"])
    return {
        "rules_version": RULES_VERSION,
        "data_mode": forecast.get("data_mode"),  # a mock forecast gives a mock outlook
        "period": {"start_date": period.get("start_date"), "end_date": period.get("end_date")},
        "crops": out,
        "note": {
            "ar": "تقييم أولي يعتمد على الحرارة المتوقعة فقط. ليس احتمالاً لنجاح المحصول.",
            "en": "A first assessment based on forecast temperature only. Not a probability of a successful harvest.",
        },
    }
