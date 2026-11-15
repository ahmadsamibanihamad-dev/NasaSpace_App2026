# Recommendation engine, rule version mvp-2

Multi-factor, crop-specific replacement of the temperature-dominated mvp-1 rules.
It answers: *based on the predicted conditions, the soil of my farm and what I planted before, what should I plant next, and why?*

Scores are rule-based suitability indicators. They are not probabilities of crop success.

## Files

| File | Role |
|---|---|
| `AI/crop_requirements.json` | Crop table (version `mvp-2`): requirements of the six crops with a reference for each, previous-crop list with botanical families, weights, scoring constants |
| `AI/recommendation_system.py` | The engine: `recommend()`, `evaluate_crop()`, `rotation_compatibility()` |
| `AI/environment_service.py` | Soil by depth, terrain and historical observations for a `GRID_ID`; `site_context()` |
| `AI/crop_rotation.py` | 90-day sequential planner, built on the engine |
| `AI/recommendation_api.py` | The package's own FastAPI router (`/api/recommendations/demo`, `/evaluate`, `/crops`) |
| `backend/app/api/outlook.py`, `crop_rotation.py` | The site's endpoints (`/api/v1/outlook`, `/api/v1/crop-rotation/plan`) |
| `backend/tests/test_recommendation_engine.py` | Tests of the rules |

No model was retrained. The four forecasts still come from `Model_Registry.json` and `mvp_inference.py`.

## What is a forecast and what is not

| Kind | Variables | Label in the API |
|---|---|---|
| Forecast (30 / 90 days) | T2M mean, RH2M mean, SFMC mean, IMERG_PRECTOT total | `forecast[].kind = "forecast"` |
| Static property | SoilGrids soil at five depths; elevation, slope, aspect | `soil.kind`, `terrain.kind = "static_property"` |
| Historical observation | T2M_MIN, T2M_MAX, RZMC, PRMC, GWETTOP/ROOT/PROF, ALLSKY_SFC_SW_DWN, WS2M, T2MDEW, PS | `historical_indicators.kind = "historical_observation"` |

Historical observations are the mean of the same calendar window in earlier years of the master dataset, using only windows that ended before the planting date. They need the master dataset; without it they are absent and the rules that use them fall back to "unknown".

Column names were taken from the dataset schema and `Feature_Manifest.json`; none was invented.

## Factors and weights

| Factor | Weight | Data | Crop-specific part |
|---|---|---|---|
| temperature | 20 | forecast | the crop's range (unchanged from mvp-1) |
| water | 15 | forecast surface moisture; observed root-zone moisture | deep-rooted crops (carrot, beet) also use the root zone; irrigation offsets half |
| rotation | 20 | user's crop history | same crop, same family, nutrient demand, previous legume |
| texture_drainage | 10 | sand / silt / clay, coarse fragments | preferred texture group per crop; stones only for root crops |
| soil_ph | 10 | pH | the crop's range, over the crop's rooting depth |
| fertility | 10 | organic carbon, total nitrogen, CEC | weighted by the crop's nutrient demand |
| humidity | 5 | forecast | same band for all crops (no crop-specific evidence) |
| rainfall | 5 | forecast total | same rule for all crops; irrigation satisfies it |
| terrain | 5 | slope | same for all crops; elevation and aspect are shown, never scored |

Weights are MVP heuristics in `crop_requirements.json -> weights`. They are not calibrated.

The site shows five groups: climate (temperature, humidity), water (water, rainfall), soil (texture and drainage, pH, terrain), fertility, rotation, plus the overall score.

### Missing data

A factor with no data is **unknown**. It is left out, its weight is spread proportionally over the known factors, and `coverage_pct` reports the share of the total weight that was evaluated. An unknown factor is never counted as suitable, and no value is filled in. `missing_factors` lists what was left out.

### Critical rules (independent of the weighted score)

A crop that fails one is `not_recommended` and its score is capped below 50, whatever its rotation compatibility:

- forecast temperature far outside the crop's range (temperature component below 40);
- no irrigation, dry surface soil and little expected rain;
- a frost-sensitive crop where frost occurred in at least half of the earlier years in that window.

If no crop passes, the answer is `status: "no_suitable_recommendation"` with `best_candidate: null`.

## Soil depth

SoilGrids gives 0-5, 5-15, 15-30, 30-60 and 60-100 cm. Each crop uses the layers of its rooting depth, weighted by layer thickness; missing layers are skipped, not filled.

| Crop | Layers used | Basis |
|---|---|---|
| arugula, spinach | 0-30 cm | leafy greens have shallow roots, most in the top foot (USU leafy greens) |
| carrot, beet | 0-60 cm | need deep soils; long roots absorb deeper (USU, UMN) |
| radish, bush bean | 0-30 cm | the references give no rooting depth; topsoil used and marked `evidence: insufficient` |

Texture is the USDA texture class of that depth, grouped into light / medium / heavy. Drainage is inferred from texture; the dataset has no drainage measurement. Bulk density is shown but not scored.

Fertility is the position of the location among Jordan's 835 grid points (percentile of organic carbon and total nitrogen, combined because they move together, and of CEC). It is a relative index, not a sufficiency level. SoilGrids nitrogen is total nitrogen, not plant-available nitrogen, and no fertilizer amount is derived from it.

Optional laboratory results (`soil_lab`) replace the estimate for the request and keep their source (`"laboratory result (user)"`).

## Rotation

`previous_crop`, `previous_crop_year` and `crop_history` describe what was grown before. The previous crop can be any of 27 entries (wheat, barley, tomato, potato, cucumber, onion, cabbage, ..., `other`), not only the six candidates. Families follow the plant-family list of the UMN reference.

- same crop last season: minus 70; same family: minus 45; two seasons ago half of that; three seasons ago a quarter;
- a high nitrogen-demand crop after another one: minus 10;
- a previous legume: plus 10 as a qualitative benefit, with the text "no increase in soil nitrogen is guaranteed";
- unknown previous crop, or `other`: the rotation factor is unknown and the answer says so.

These numbers are design heuristics. No nutrient depletion is estimated.

In the 90-day planner the first crop becomes the most recent crop for the second one. To avoid counting rotation twice, a sequence is scored from each crop's environment score (all factors except rotation) plus the engine's rotation scores.

## Cultivation type

`open_field` (default) uses the outdoor forecast as described above.

`greenhouse`: the forecast describes outdoor air, and nothing is known about the greenhouse's heating or cooling. So:

- temperature, humidity and rainfall are **unknown** factors (left out, their weight spread over the known ones, `coverage_pct` drops);
- surface soil moisture is not used; water is satisfied by irrigation (100 when available, unknown when not stated);
- **no irrigation is a critical failure**, because rain does not reach the crop;
- the outdoor temperature and frost rules are not applied;
- a crop is at most `conditional`, never `suitable_candidate`, and the answer carries a warning;
- soil, fertility, terrain and rotation are scored as usual.

No greenhouse-specific crop requirement is assumed; none is in the references. At a location with no soil data the score rests on few factors, which `coverage_pct` shows.

## References and their applicability to Jordan

| Key | Reference |
|---|---|
| USU_ROOT | https://extension.usu.edu/vegetableguide/root-crops/soil-fertility |
| USU_LEAFY | https://extension.usu.edu/vegetableguide/leafy-greens/soil-fertility |
| USU_SOIL | https://extension.usu.edu/vegetableguide/management/soil |
| USU_CARROT | https://extension.usu.edu/yardandgarden/research/carrots-in-the-garden |
| USU_BEET, USU_RADISH, USU_SPINACH, USU_BEAN | same series, `/beets-`, `/radishes-`, `/spinach-`, `/beans-in-the-garden` |
| UMN_SOIL | https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/living-soil-healthy-garden |

All are US university extension publications. Utah is semi-arid with alkaline, often calcareous soils and irrigated vegetable production, which is closer to Jordan than humid regions; Minnesota is not, and was used only for the general plant-family and rotation principles. Cultivars, seasons, pests and soils differ from Jordan.

How they were used:

- qualitatively: preferred soil texture, drainage, relative water demand, frost tolerance, plant families;
- nitrogen rates only to rank crops into low / medium / high demand, never to prescribe fertilizer;
- "grows best when temperatures do not exceed X" as a caution against the observed mean daily maximum, not as a scoring threshold;
- planting-date advice was not used.

What they do not give, and how it is handled:

- no arugula-specific page: arugula uses the leafy-greens group rules; frost and heat limits are `insufficient`;
- no crop-specific humidity or moisture thresholds: humidity and the moisture band stay the generic mvp-1 screening values;
- no rooting depth for radish and bush bean: marked `insufficient`.

Standard classifications used as stated: USDA texture classes and rock-fragment classes (15-35 % gravelly, 35 % and above very gravelly), FAO slope classes. The scores attached to those classes are heuristic.

Nothing here was validated on Jordanian field data. Soil pH in the dataset is 7.5-8.2 everywhere, above the range of five of the six crops, so the pH factor lowers almost every score.

## API

`POST /api/v1/outlook`

```json
{
  "lat": 32.55,
  "lon": 35.75,
  "horizon_days": 90,
  "planting_date": "2025-11-15",
  "previous_crop": "radish",
  "previous_crop_year": 2025,
  "irrigation_available": true,
  "cultivation_type": "open_field",
  "crop_history": [{"year": 2024, "crop_id": "wheat"}],
  "soil_lab": {"ph": 7.1}
}
```

Only `lat` and `lon` are required. The answer carries: `forecast_origin` and `data_mode`, the matched `grid`, the four forecasts with method and validation error, `soil` and `terrain`, `previous_crops` with families, and for each period three ranked crops with `score`, `component_scores`, `group_scores`, `rotation`, `explanations` (each with the factor it belongs to and its effect), `critical_failures`, `days_to_harvest`, `missing_factors`, `coverage_pct`; plus `weights`, `weight_policy` and `rule_version`.

`cultivation_type` is `open_field` (default) or `greenhouse`; see "Cultivation type" below. `POST /api/v1/crop-rotation/plan` takes the same history fields with `latitude`, `longitude` and `planning_horizon_days`.

Data mode is `historical_demo` (default date) or `historical_data` (another date inside the dataset). A date outside the dataset is refused with `DATE_OUT_OF_RANGE`; historical data is never served as a live forecast.

## Tests

`backend/tests/test_recommendation_engine.py` and `test_outlook.py`:

1. same temperature, different soil texture: different recommendation;
2. same conditions, different previous crop: different ranking;
3. repeating a botanical family lowers rotation compatibility;
4. changing soil moisture changes suitability;
5. missing soil information produces unknown factors, never values;
6. a perfect rotation score cannot rescue an environmentally unsuitable crop;
7. both the 30-day and the 90-day forecasting integrations work;
8. historical data is labelled and a date outside the dataset is refused.

Run from `backend/`: `.venv\Scripts\python.exe -m pytest -q`.
