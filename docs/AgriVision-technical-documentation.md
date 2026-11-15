# AgriVision — Technical Documentation

## AI-Powered Agricultural Intelligence and Farm Management Platform for Jordan

Document status: describes the system as implemented on 15 November 2026. Every figure marked **(verified)** was checked against the shipped code, the model registry, the feature manifest, the test-metrics file or the dataset itself. Figures marked **(team record)** come from the research team's notebooks and are not derivable from the shipped files.

---

## 1. Executive Summary

AgriVision is a web platform that helps farmers in Jordan decide what to plant, where and when. It combines four things in one application:

1. **A multi-source environmental dataset** for Jordan (NASA POWER, NASA SMAP, NASA GPM IMERG, ISRIC SoilGrids, Copernicus DEM) on a common grid of 835 locations, 2,059,110 daily records.
2. **A hybrid forecasting system** (XGBoost plus statistical predictors) covering 136 forecasting targets for air temperature, relative humidity, surface soil moisture and precipitation.
3. **Two agricultural decision engines**, both rule-based and explainable:
   - an **AI recommendation engine and crop rotation planner** that turn the 30-day and 90-day forecasts, soil, terrain and the land's crop history into ranked crops and planting sequences (six short-cycle crops);
   - a **historical analytics engine** that runs six analyses on thirteen crops from twelve years of NASA POWER observations, using FAO ECOCROP crop requirements and FAO-56 water calculations.
4. **A farm management application**: accounts, multiple farms, parcels drawn on satellite imagery, area and perimeter measurement, laboratory soil results, saved plans, reports, PDF export and data exchange.

The application is a responsive, bilingual (Arabic right-to-left and English) web application built with React and TypeScript, served by a FastAPI backend with a SQLite database. All recommendation logic runs in the backend; the frontend contains none.

Forecasts are computed from prepared historical data (default forecast origin 1 May 2026). They are not live weather forecasts, and the application says so on every forecast screen.

---

## 2. Problem Statement

Agricultural decisions depend on climate, soil, water, terrain, planting requirements and what was grown before. Farmers face:

- scattered environmental information that is published as scientific measurements, not as advice;
- difficulty reading historical climate and uncertainty about the coming weeks;
- difficulty choosing a crop, a planting period and a rotation;
- little information about crop water needs and climatic risks;
- no simple tool to measure, document and manage their land digitally;
- no single place that combines planning, records and reports.

AgriVision addresses these by turning environmental data into explained, location-specific recommendations inside a farm management tool.

---

## 3. Project Objectives

1. Collect environmental information from reliable scientific sources.
2. Build an integrated spatial and temporal environmental dataset for Jordan.
3. Develop a multi-horizon environmental forecasting architecture.
4. Generate location-based crop recommendations from forecasts, soil and terrain.
5. Take the land's crop history into account (rotation compatibility).
6. Support preliminary crop rotation planning.
7. Analyse historical climate for crop suitability, planting periods, water needs and risks.
8. Provide digital farm and parcel management.
9. Explain every result: each score comes with its reasons, its data sources and what is unknown.
10. Deliver all of this through an accessible bilingual web application with reports and data export.

---

## 4. System Architecture

### 4.1 Layers

| Layer | Responsibility | Implementation |
|---|---|---|
| Data collection | Meteorology, solar radiation, soil moisture, precipitation, soil, terrain, boundaries | Research notebooks (team) |
| Data processing | Cleaning, spatial and temporal alignment, feature engineering, storage | Python, Pandas, Xarray, GeoPandas, Parquet |
| AI forecasting | 136 targets, XGBoost and statistical predictors chosen on validation | `nasa_final/AI/forecasting` |
| Agricultural intelligence (forecast-based) | Multi-factor crop ranking, rotation compatibility, 90-day planner | `nasa_final/AI/recommendation_system.py`, `crop_rotation.py`, `environment_service.py` |
| Agricultural intelligence (historical) | Six analyses on thirteen crops | `backend/app/engine` |
| Backend | API, authentication, validation, orchestration, persistence | FastAPI, SQLModel, Pydantic |
| Database | Users, farms, parcels, analyses, plans, climate cache | SQLite (WAL, foreign keys on) |
| Frontend | Bilingual responsive user interface, maps, charts | React, TypeScript, Vite, Tailwind CSS, Leaflet |

### 4.2 Repository layout

```
frontend/                     React application
backend/app/                  FastAPI application
  api/                        auth, geo, farms, analyses, forecasts, outlook, crop_rotation, public
  core/                       settings, security, errors, rate limit, database
  engine/                     historical analytics engine (13 crops)
  services/                   geo, NASA POWER climate, crops, demo farm, feature builder
  data/                       crops.json, engine_config.json, Jordan boundaries, source extracts
  ml/                         optional prediction-service adapter (disabled by default)
backend/nasa_final/           AI team package: models, registry, rules, demo features, dataset
backend/tests/                automated tests
docs/                         this document and the illustrated site guide
```

### 4.3 Design principles enforced in code

- **No recommendation logic in the frontend.** Every score, status, risk and explanation is produced by the backend. The frontend only computes geometry (area, perimeter, shape validation), unit conversion and file import/export.
- **Nothing is invented.** A factor with no data is reported as unknown and left out of the score; it is never filled with a default.
- **Forecast, static property and historical observation are labelled apart** in the API and on screen.
- **Agricultural knowledge is separate from forecasting.** Crop tables and rule weights are JSON files; changing them needs no model retraining.

---

## 5. Environmental Data Sources

### 5.1 NASA POWER

Meteorological and solar variables: `T2M`, `T2M_MAX`, `T2M_MIN`, `RH2M`, `ALLSKY_SFC_SW_DWN`, `WS2M`, `PRECTOTCORR`, `T2MDEW`, `PS`.

NASA POWER is used twice:

- in the **research dataset** that trains and feeds the forecasting models;
- **live, at request time**, by the historical analytics engine, which calls the POWER daily point API for the farm's location (Section 15.2).

https://power.larc.nasa.gov/ · API: https://power.larc.nasa.gov/docs/services/api/temporal/daily/

### 5.2 NASA SMAP

Six hydrological variables: `SFMC` (surface soil moisture), `RZMC` (root zone), `PRMC` (profile), `GWETTOP`, `GWETROOT`, `GWETPROF` (relative wetness). Accessed through the NASA POWER Zarr datastore `s3://nasa-power-smap/smap/temporal/power_smap_daily_temporal_utc.zarr` **(team record)**.

https://science.nasa.gov/mission/smap/

### 5.3 NASA GPM IMERG

`IMERG_PRECTOT` (precipitation) and `IMERG_PRECLIQUID_PROB`. The IMERG 0.1° grid is the common spatial reference of the dataset.

https://gpm.nasa.gov/data/imerg

### 5.4 ISRIC SoilGrids

Nine soil properties at five depths (0–5, 5–15, 15–30, 30–60, 60–100 cm): pH, total nitrogen, organic carbon, sand, silt, clay, bulk density, cation exchange capacity, coarse fragments. 9 × 5 = 45 static features. These are modelled estimates, not field measurements.

https://isric.org/explore/soilgrids

### 5.5 Copernicus DEM GLO-30

Elevation, and slope and aspect derived from it. In the dataset elevation ranges from −427 m to 1,625 m **(verified)**.

https://registry.opendata.aws/copernicus-dem/

### 5.6 Boundaries

geoBoundaries gbOpen, simplified: Jordan national boundary (ADM0, CC BY 4.0) and the twelve governorates (ADM1, CC BY 2.5). Used to reject locations outside Jordan and to name the governorate of a farm.

https://www.geoboundaries.org/

### 5.7 Agricultural knowledge sources

| Source | Used for |
|---|---|
| FAO ECOCROP | Temperature, rainfall and pH limits, cycle length and killing temperature of the thirteen analytics crops |
| FAO Irrigation and Drainage Paper 56 | Reference evapotranspiration (Penman-Monteith), crop coefficients (Table 12), growth stages (Table 11), root depth (Table 22) |
| Utah State University Extension vegetable guides | Soil texture, drainage, water and frost notes of the six AI crops |
| University of Minnesota Extension | Plant families and rotation principles |

---

## 6. Environmental Data Integration

- **Problem.** The sources differ in resolution, coordinates, time coverage, units, formats and missing-value codes.
- **Common grid.** The IMERG 0.1° grid clipped to Jordan: **835 grid locations (verified)**, each with a `GRID_ID`.
- **Spatial alignment.** Nearest-neighbour matching with BallTree indexing and haversine distance, with a distance limit per source **(team record)**. A common grid gives a consistent structure; it does not increase the native accuracy of any source.
- **Temporal alignment.** Dynamic variables are keyed by `GRID_ID + DATE`; static soil and terrain by `GRID_ID`.
- **Cleaning.** Duplicates, invalid matches, unit differences and missing values were handled. One missing SMAP date (20 September 2025 **(verified in the feature manifest)**) was filled from the previous day and is masked when climatology is computed. Soil gaps were kept as gaps: **5 of the 835 grid points have no SoilGrids values (verified)**, mostly urban cells, and the application reports soil as unavailable there.
- **Storage.** Apache Parquet, for column-wise loading.

---

## 7. Final Environmental Dataset

All values in this table are **verified** against the shipped Parquet file, the feature manifest and the model registry.

| Characteristic | Value |
|---|---:|
| Records | 2,059,110 (835 locations × 2,466 days) |
| Period | 1 December 2019 – 31 August 2026 |
| Columns in the dataset | 69 (4 identifiers and coordinates, 17 dynamic, 48 static) |
| Dynamic variables | 17 |
| Static features | 48 (45 soil, 3 terrain) |
| Engineered candidate model features | 512 |
| Columns in the engineered feature file | 516 |
| Forecasting targets | 136 |

---

## 8. Feature Engineering

The 512 candidate features **(verified)** are built from:

- **Lags** of 0, 1, 2, 3, 7, 14, 29, 60, 90 and 365 days.
- **Rolling statistics** over 3, 7, 14, 30, 60 and 90 days.
- **Changes** over short windows (for example 3-day and 7-day change).
- **Historical climatology**: the mean of the same calendar period in prior complete calendar years, ±7 days, with a cut-off at the origin year so that no future observation is used.
- **Anomalies**: the current value minus its climatology.
- **Calendar terms**: sine and cosine of the day of year.
- **Static features**: the 48 soil and terrain values plus latitude and longitude.

**Targets (136).** For each of the four variables: 30 daily horizons (120 targets) and four aggregates: 7 days, 30 days, 90 days and the next full meteorological season (16 targets). Temperature, humidity and soil moisture aggregates are means; precipitation aggregates are sums.

The application rebuilds these features for any origin date with the team's own notebook code, copied into `backend/app/services/outlook_features.py`. The rebuilt row was checked equal to the team's prepared snapshot for the demo date.

---

## 9. Machine Learning Model Development

### 9.1 Hybrid architecture

Each target is served by whichever predictor had the lowest validation error: an XGBoost model or a statistical formula. Complex models do not win for every variable and horizon, so the system does not force them.

### 9.2 XGBoost

Two forms were used:

- **Direct**: the model predicts the target.
- **Residual**: the model predicts the difference between a statistical baseline and the truth; final prediction = baseline + predicted residual.

### 9.3 Statistical predictors

Implemented in `mvp_inference.py` **(verified)**:

| Predictor | Formula |
|---|---|
| Climatology | the historical mean of the target period |
| Climatology + anomaly | climatology + current anomaly × an exponential decay with a 7-day scale over the lead and length of the period |
| Persistence | the latest observation |
| Moving average | the rolling mean (or, for rain, the rolling sum rescaled to the period length) over a window matched to the horizon |

Predictions are clipped to physical ranges: humidity 0–100 %, soil moisture 0–1, precipitation ≥ 0.

### 9.4 Final registry (verified)

| Predictor | Targets |
|---|---:|
| XGBoost, direct | 3 |
| XGBoost, residual | 4 |
| Moving average | 58 |
| Climatology + anomaly | 57 |
| Climatology | 10 |
| Persistence | 4 |
| **Total** | **136** |

The seven XGBoost targets are: temperature next day, temperature 90-day mean, temperature next season, humidity next day, humidity 7-day mean, humidity next season, and precipitation next season. The 90-day temperature model uses 22 physically selected features; the next-day and seasonal temperature models use all 512.

### 9.5 Predictors behind the eight values the application shows

| Variable | 30 days | 90 days |
|---|---|---|
| Temperature | Climatology + anomaly | **XGBoost (direct, 22 features)** |
| Relative humidity | Climatology + anomaly | Climatology |
| Surface soil moisture | Climatology + anomaly | Climatology + anomaly |
| Precipitation | Moving average | Climatology |

So one of the eight displayed forecasts comes from a trained model and seven from statistical predictors. Each forecast tile in the application names its method.

### 9.6 Experiments (team record)

About 50 XGBoost training runs: 35 for temperature, 5 each for humidity, soil moisture and precipitation. Feature sets compared: top 10, top 25, top 50, a physically selected set, and all 512.

### 9.7 Runtime note

The models were trained with XGBoost 3.4.1 (Python 3.12). The deployed backend runs Python 3.11 with XGBoost 3.2, which loads the saved models without warnings; numerical parity between the two versions was not separately measured.

---

## 10. Training, Validation and Testing

Chronological split, no shuffling **(verified in the feature manifest)**:

| Split | Period | Samples |
|---|---|---:|
| Training | 1 January 2021 – 31 December 2023 | 914,325 |
| Validation | 1 January 2024 – 28 February 2025 | 354,875 |
| Testing | 1 March 2025 – 31 August 2026 | 458,415 |
| Total | | 1,727,615 |

Observations before 2021 serve as warm-up for lags and climatology. Targets that would run past the end of a split are dropped from it. Validation chose features and predictors; the test split measured the final choice once.

---

## 11. Forecasting Inputs, Outputs and Data Mode

### 11.1 What the user provides

Location (latitude and longitude, or a parcel), planting start date, planning horizon, previous crops, irrigation availability, cultivation type and, optionally, laboratory soil results. Only the location and date reach the forecasting models; the rest goes to the recommendation rules.

### 11.2 From location to forecast

1. The point must be inside Jordan (Section 18.4).
2. The nearest grid location is found; if it is more than 15 km away the request is refused.
3. The feature row of that grid for the forecast origin is loaded or rebuilt.
4. The registry entry of each target is applied.

### 11.3 Outputs

| Variable | Parameter | Unit | Aggregate |
|---|---|---|---|
| Air temperature | T2M | °C | mean of the period |
| Relative humidity | RH2M | % | mean of the period |
| Surface soil moisture | SFMC | m³/m³ | mean of the period |
| Precipitation | IMERG_PRECTOT | mm | total of the period |

Horizons shown: 30 days and 90 days from the planting date.

### 11.4 Historical data mode

- The planting date is the day after the forecast origin. The default planting date is **2 May 2026** (origin 1 May 2026), served from the team's prepared snapshot (`data_mode = historical_demo`).
- When the full dataset is installed, any planting date from **2 January 2021 to 1 September 2026** can be chosen; the features are rebuilt for that date (`data_mode = historical_data`).
- A date outside the dataset is refused with `DATE_OUT_OF_RANGE`. Historical data is never presented as a live forecast, and a banner states the actual date on screen.
- Live forecasting needs an automated daily ingestion of current observations and feature building; this is future work.

---

## 12. Model Performance

### 12.1 Test results (verified against `Final_Test_Metrics.csv`, March 2025 – August 2026)

| Variable | 30-day MAE | 30-day R² | 90-day MAE | 90-day R² |
|---|---:|---:|---:|---:|
| Temperature | 1.075 °C | 0.9645 | 0.868 °C | 0.9652 |
| Relative humidity | 4.156 points | 0.8325 | 3.175 points | 0.8997 |
| Surface soil moisture | 0.0145 m³/m³ | 0.8011 | 0.0131 m³/m³ | 0.8342 |
| Precipitation | 15.904 mm | −0.1484 | 27.531 mm | 0.2996 |

Temperature is forecast well; humidity and soil moisture reasonably; precipitation poorly. A negative R² means the 30-day rainfall predictor does worse than predicting the mean. The test-metrics file also reports every target by season (winter, spring, summer, autumn).

### 12.2 The error shown in the application

Each forecast tile shows "typical error ±", which is the **validation** MAE stored in the model registry, not the test MAE above:

| Variable | 30 days (validation) | 90 days (validation) |
|---|---:|---:|
| Temperature | 1.05 °C | 0.75 °C |
| Relative humidity | 4.68 points | 3.31 points |
| Surface soil moisture | 0.0109 m³/m³ | 0.0100 m³/m³ |
| Precipitation | 4.9 mm | 12.0 mm |

The rainfall validation error is much lower than the test error because the two periods differ in how much rain fell. The test figures are the honest measure of expected error.

### 12.3 Gain over the baseline

For the 90-day temperature target the XGBoost model reached a validation MAE of 0.7456 °C **(verified)** against 0.9742 °C for the statistical baseline **(team record)**, an improvement of 23.47 %. For most other targets the statistical predictor was better, which is why the registry is mostly statistical.

### 12.4 Consequences in the rules

Because rainfall forecasts are weak, rainfall carries only 5 % of the recommendation score, never decides irrigation, and every result carries a warning about it.

---

## 13. AI Recommendation Engine (rule version `mvp-2`)

### 13.1 Concept

Forecasts do not say what to plant. The engine scores each candidate crop against the forecast of its period, the soil of the location over the crop's rooting depth, the terrain, and what was grown on the land before. It is rule-based, needs no training, and returns the reason behind every point of the score in Arabic and English.

### 13.2 Crops

| Crop | Period | Days to harvest | Temperature range | pH range | Family |
|---|---|---|---|---|---|
| Early radish | 30 days | 20–30 | 10–18 °C | 6.0–7.5 | Brassicaceae |
| Baby arugula | 30 days | 25–45 | 10–22 °C | 6.0–7.5 | Brassicaceae |
| Baby spinach | 30 days | 30–40 | 10–20 °C | 6.5–7.5 | Amaranthaceae |
| Carrot | 90 days | 55–88 | 15–24 °C | 6.0–7.5 | Apiaceae |
| Beetroot | 90 days | 50–60 | 15–22 °C | 6.5–8.0 | Amaranthaceae |
| Bush green bean | 90 days | 45–65 | 18–27 °C | 6.0–7.5 | Fabaceae |

Each crop entry in `crop_requirements.json` also holds its rooting depth, preferred soil texture, drainage need, sensitivity to stones, water demand, nutrient demand, frost sensitivity and heat note, each with a reference or the flag `evidence: insufficient`.

### 13.3 Inputs by kind

| Kind | Values | Label in the API |
|---|---|---|
| Forecast | temperature, humidity, surface soil moisture, precipitation | `forecast` |
| Static property | nine soil properties at five depths; elevation, slope, aspect | `static_property` |
| Historical observation | minimum and maximum temperature, frost frequency, root-zone and profile moisture, wetness, solar radiation, wind, dew point, pressure | `historical_observation` |
| User | previous crop and year, earlier crops, irrigation, cultivation type, laboratory soil values | — |

Historical observations are the mean of the same calendar window in earlier years, using only windows that ended before the planting date.

### 13.4 Factors and weights

| Factor | Weight | How it is scored (0–100) |
|---|---:|---|
| Temperature | 20 | 100 inside the crop's range, falling linearly to 0 at 10 °C outside it |
| Water | 15 | Surface soil moisture against the band 0.15–0.35 m³/m³; for deep-rooted crops (carrot, beetroot) half comes from the observed root-zone moisture; available irrigation covers half of any shortfall |
| Rotation | 20 | Starts at 100; penalties and bonus from the crop history (Section 13.7) |
| Texture and drainage | 10 | USDA texture class of the crop's rooting depth: preferred 100, acceptable 75, needs amendment 45; for root crops, minus 15 when gravelly (15–35 % coarse fragments) or 35 when very gravelly |
| Soil pH | 10 | 100 inside the crop's range, falling linearly to 0 at 2 pH units outside |
| Fertility | 10 | Percentile of the location among Jordan's 835 grid points for organic carbon and total nitrogen (combined) and for CEC, scaled by the crop's nutrient demand |
| Humidity | 5 | Against the band 40–80 % |
| Rainfall | 5 | Daily rate against 1 mm/day; satisfied when irrigation is available |
| Terrain | 5 | FAO slope class: up to 5 % = 100, 10 % = 80, 15 % = 60, 30 % = 30, steeper = 0 |

The overall score is the weighted mean of the known factors. The weights and constants are engineering heuristics stored in the crop table, not calibrated agronomic thresholds; the score is a relative suitability index, not a probability of success.

On screen the nine factors are grouped into five bars: climate (temperature, humidity), water (water, rainfall), soil (texture and drainage, pH, terrain), fertility, and rotation.

### 13.5 Missing data

A factor with no data is **unknown**. It is left out, its weight is spread proportionally over the known factors, and `coverage_pct` reports the share of the total weight that was actually evaluated. Unknown factors are listed under "missing information". Nothing is assumed in their place.

### 13.6 Critical rules

Applied apart from the weighted score. A crop that fails one is `not_recommended` and its score is capped at 49, however good its rotation or soil score:

- forecast temperature far outside the crop's range (temperature factor below 40);
- no irrigation, dry surface soil and little expected rain;
- a frost-sensitive crop where frost occurred in at least half of the earlier years in that window.

### 13.7 Rotation compatibility

The previous crop can be any of 27 crops (wheat, barley, tomato, potato, cucumber, onion, cabbage, lettuce and others), not only the six candidates. The user can add the year it was grown and up to four earlier crops.

- same crop last season: −70; same botanical family: −45;
- two seasons ago the penalty is halved, three seasons ago quartered;
- a high nitrogen-demand crop after another high-demand crop: −10;
- after a legume: +10, stated as a possible benefit with no guaranteed gain in soil nitrogen;
- unknown previous crop: the rotation factor is unknown and the result says so.

Example: after radish (Brassicaceae), arugula loses 45 rotation points; spinach and carrot do not.

### 13.8 Soil depth, texture and fertility

- Each crop uses the SoilGrids layers of its rooting depth, weighted by layer thickness: 0–30 cm for the leafy crops, radish and bean; 0–60 cm for carrot and beetroot.
- Texture is the USDA class computed from sand, silt and clay, grouped into light, medium and heavy. Drainage is inferred from texture; the dataset has no drainage measurement.
- Fertility is a relative position among Jordan's grid points, not a nutrient sufficiency level. SoilGrids nitrogen is total nitrogen, not plant-available nitrogen, and no fertilizer amount is derived.

### 13.9 Cultivation type

- **Open field** (default): as described above.
- **Greenhouse**: the forecast describes outdoor air and nothing is known about heating or cooling, so temperature, humidity and rainfall become unknown factors; water is judged from irrigation alone; **no irrigation is a critical failure** because rain does not reach the crop; outdoor temperature and frost rules are not applied; and a crop is at most "suitable with conditions". Soil, fertility, terrain and rotation are scored as usual.

### 13.10 Laboratory soil results

The user may enter pH, sand, silt, clay, organic carbon, total nitrogen, CEC and coarse fragments. An entered value replaces the SoilGrids estimate and keeps its source ("laboratory result"). Sand, silt and clay must be entered together.

A laboratory test can be **saved with a parcel** in the parcel form. It is then applied automatically whenever that parcel is chosen in the forecast page or the rotation planner, and can still be changed there for a single request. The historical analyses read the parcel's test too (Section 15.5).

### 13.11 Results

For each period the application shows the **three candidate crops of that period**, ranked. Each carries one of three statuses:

| Status | Meaning |
|---|---|
| Suitable candidate | score ≥ 75 and no open condition |
| Suitable with conditions | a factor is short, unknown, or the rotation score is below 60 |
| Not recommended | a critical rule failed, or score below 50 |

Unsuitable crops stay visible with the status "not recommended" and the reason. Each card shows the overall score, days to harvest, the five group bars, coverage, and the explanations sorted into "why it fits", "what lowers its suitability", "why it is not recommended" and "missing information".

### 13.12 What this engine does not do

It has no season eligibility filter separate from the temperature rules, no regional planting calendars, and it does not estimate harvest dates in the standard recommendation (the rotation planner does).

---

## 14. Crop Rotation Planner

### 14.1 Phases

- Phase 1: days 1–30, planted with one of the three 30-day crops.
- Phase 2: days 31–90, planted with one of the three 90-day crops.

### 14.2 Phase-2 conditions

Derived from the two forecasts of the same location and origin:

- temperature, humidity, soil moisture: `(90 × mean₉₀ − 30 × mean₃₀) / 60`
- precipitation: `total₉₀ − total₃₀`

These are derived estimates, not an independent 60-day forecast. They are checked against physical ranges and never clipped.

### 14.3 Inconsistent forecasts

Because the 30-day and 90-day rainfall predictors are different methods, the derived phase-2 rainfall is sometimes negative. The planner then marks phase 2 as unreliable and returns a **partial plan** with a first crop only; it does not force a second crop. The result states the reason.

### 14.4 Scoring a sequence

Each crop is evaluated by the recommendation engine under its own phase. The first crop becomes the most recent crop in the history of the second. To avoid counting rotation twice, a sequence is scored from each crop's environment score plus the rotation scores:

`sequence score = 0.40 × first crop + 0.40 × second crop + 0.15 × rotation compatibility + 0.05 × duration fit`

**Duration fit**: a crop fits a phase if its shortest growth duration fits; if only its longest does not, the plan is conditional on an early-maturing cultivar.

### 14.5 Output

- Status: `success`, `partial_plan` or `no_plan_available`, with an explanation.
- The best sequence and up to two alternatives, each with its score and component bars.
- For each step: planting date, earliest and latest harvest dates, growth days, botanical family, the five group scores, reasons, and conditions and risks.
- The conditions expected in each phase, the soil and terrain of the location, and data-quality warnings.

Signed-in users can save a plan for a farm or parcel, reopen it exactly as it was computed, compare two saved plans, print it, and delete it. The planner gives preliminary decision support for one 90-day window; it is not a validated multi-year rotation system.

---

## 15. Historical Agricultural Analytics (rule engine `rules-v1`)

A second, independent engine. It works from the observed climate of the farm's location, not from the forecasts, and covers thirteen crops.

### 15.1 Crops and knowledge base

| Crop | Scientific name | Family | Type |
|---|---|---|---|
| Wheat | Triticum aestivum | Poaceae | cereal |
| Barley | Hordeum vulgare | Poaceae | cereal |
| Lentil | Lens culinaris | Fabaceae | legume (nitrogen-fixing) |
| Chickpea | Cicer arietinum | Fabaceae | legume (nitrogen-fixing) |
| Vetch | Vicia sativa | Fabaceae | legume (nitrogen-fixing) |
| Tomato | Solanum lycopersicum | Solanaceae | vegetable |
| Cucumber | Cucumis sativus | Cucurbitaceae | vegetable |
| Potato | Solanum tuberosum | Solanaceae | vegetable |
| Onion | Allium cepa | Amaryllidaceae | vegetable |
| Eggplant | Solanum melongena | Solanaceae | vegetable |
| Olive | Olea europaea | Oleaceae | perennial tree |
| Date palm | Phoenix dactylifera | Arecaceae | perennial tree |
| Citrus | Citrus sinensis | Rutaceae | perennial tree |

Each crop record holds temperature limits (absolute minimum, optimum range, absolute maximum), killing temperature, rainfall limits, pH limits, cycle length, four growth-stage lengths, three crop coefficients (Kc), root depth, frost and drought tolerance and an income class. **Every value carries its source** (FAO ECOCROP, FAO-56 Table 11, 12 or 22) and a `needs_review` flag where the value is a proxy. Planting months and income classes are marked "not verified".

### 15.2 Climate data

- **Request.** NASA POWER daily point API, community AG, parameters `T2M`, `T2M_MIN`, `T2M_MAX`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`, `PRECTOTCORR`, `GWETTOP`, `GWETROOT`, from 1 January twelve years back to yesterday.
- **Resilience.** Three attempts with increasing delay; 90-second timeout.
- **Cache.** By 0.5° cell, in memory and in the database, for 24 hours. If NASA cannot be reached, the last stored copy is used and marked stale; an offline mode serves only stored data.
- **Quality labels.** Completeness, record length, confidence (medium when at least ten years and 95 % complete, otherwise low) and staleness (older than 14 days) are returned with every result.
- At least three years of record are required; otherwise the analysis stops with `MISSING_DATA`.

### 15.3 Shared calculations

- **Reference evapotranspiration (ET0)**: FAO-56 Penman-Monteith, daily. Falls back to Hargreaves when humidity, wind or radiation is missing; the method used is reported.
- **Crop evapotranspiration**: `ETc = Kc × ET0`, with the four-stage FAO-56 Kc curve.
- **Effective rainfall**: USDA-SCS monthly formula as used in FAO CROPWAT.
- **Net irrigation need**: `max(0, ETc − effective rain)` by month.
- **Day counts per season**: frost days (minimum below 0 °C), heat days (mean above the crop's heat threshold), longest dry spell (days under 1 mm), extreme rain days (above the local 95th percentile of wet days), growing degree days.
- **Dekads**: the year is divided into 36 ten-day periods; every crop is scored for a season starting in each of them.

### 15.4 Suitability score

Four factors, each 0–100, from trapezoid functions (0 outside the absolute limits, 100 inside the optimum range, linear between):

| Factor | Weight | Basis |
|---|---:|---|
| Temperature | 0.35 | mean daily temperature of the season against the crop's limits |
| Precipitation | 0.30 | share of the crop's water need met by rain, adjusted for the reliability of rain across years and for establishment rain; irrigation raises the floor (drip 95, sprinkler 90, surface 85) |
| Soil moisture | 0.20 | seasonal mean root-zone wetness |
| Solar radiation | 0.15 | mean daily radiation |

Then:

- **Limiting-factor rule**: the score cannot exceed the weaker of temperature and precipitation by more than 10 points.
- **Penalties** (total capped at 35): frost days weighted by frost tolerance (up to 20), heat days (up to 15), and for rainfed annual crops a long dry spell weighted by drought tolerance (up to 10).
- **Status**: highly suitable ≥ 80, suitable ≥ 60, marginal ≥ 40, otherwise unsuitable.

Perennial trees are evaluated over the full year, using the annual mean and the coldest-month mean. All configuration values are in `engine_config.json` and are marked as engineering defaults needing review.

### 15.5 The six analyses

| Analysis | Input | Result |
|---|---|---|
| **Crop recommendation** | farm or parcels | All thirteen crops ranked per parcel: score, status, best planting window, water-demand level, main reason, factor scores, requirements table |
| **Specific crop analysis** | a crop, optional planting date | Score gauge and status; the four factor bars; recommended planting window on a 12-month bar and 36-period strip; risks with an action for each; numbered recommended actions; an evidence list of 15 metrics with source and years; requirements table (required, your land, match, source); top three alternative crops |
| **Best planting period** | optional crop | A calendar of 36 ten-day periods per crop with the best window outlined; frost and heat probability strips; monthly rainfall bars; monthly soil-moisture cells. Crops with no suitable window say so; perennials are marked |
| **Rotation recommendation** | priority: improve soil, save water, or increase income | Three strategies for the next three seasons: the current pattern, option A (soil health), option B (water saving or income). Each with the crop of each season, three scores (water efficiency, soil health, income potential), why it was proposed, supporting evidence with sources, expected benefits against the current pattern, missing information, and risks to review with an agronomist |
| **Water requirements** | a crop, optional planting date | Crop need (ETc), effective rain, net irrigation in mm, and seasonal irrigation in m³ for the parcel's area; a monthly bar chart of the three; an explanation. Figures are net of irrigation-system losses |
| **Risk assessment** | farm or parcels | Risk cards sorted by severity, each with period, affected parcels, a numeric explanation and an action; a table of risks per parcel |

**Laboratory soil test in the analyses**: when the parcel has a stored test, its pH is compared with the crop's FAO ECOCROP pH limits in the requirements table and marked "laboratory test"; the advice to run a soil test and the "no soil test" information gap in the rotation analysis disappear. Without a test the pH row stays unknown. The suitability score has no soil-chemistry factor, so the test changes the requirements match, not the score.

**Best planting window**: the run of consecutive ten-day periods around the best one whose score is within 5 points of it and at least 40.

**Rotation logic**: a transition score penalises repeating a family (−40 after the same family, −15 two seasons back) and rewards a legume after a non-legume (+30) and a change of rooting depth (+12). Each strategy picks, season by season, the annual crop that maximises its objective among crops scoring at least 40.

### 15.6 Risks

| Risk | Raised when |
|---|---|
| Frost | frost days in the season, weighted by the crop's tolerance |
| Heat stress | days above the crop's heat threshold |
| Drought | rainfed, and rain is unreliable across years or meets less than 60 % of the need |
| Dry spell | rainfed annual crop with 20 or more consecutive dry days |
| Excessive rainfall | three or more extreme rain days, or seasonal rain above the crop's optimum |
| Low soil moisture | root-zone wetness of the last 30 days well below the normal of the month |

Each risk is low, moderate or high.

### 15.7 Execution

- An analysis is created with `POST /analyses` and runs as a background task. The client polls every 0.8 seconds and shows four stages: retrieving environmental data, processing satellite information, evaluating crop requirements, generating recommendations.
- Climate is fetched once for the farm's centre and shared by its parcels; results differ by each parcel's irrigation.
- Results are stored. The newest 60 analyses per farm are kept.
- Analyses left running when the server stops are marked interrupted at the next start.

### 15.8 The two engines side by side

| | Historical analytics | AI recommendation and planner |
|---|---|---|
| Data | NASA POWER, last 12 years, fetched live | Team dataset and saved forecasting models |
| Time frame | A typical year at this location | 30 and 90 days from a planting date |
| Crops | 13 (field crops, vegetables, trees) | 6 (short-cycle vegetables) |
| Knowledge base | FAO ECOCROP, FAO-56 | Extension guides, plant families |
| Soil | Root-zone wetness from POWER | SoilGrids by rooting depth, laboratory values |
| Crop history | Used in the rotation analysis | Used in every ranking |
| Version | `rules-v1` | `mvp-2` |

---

## 16. Farm and Parcel Management

### 16.1 Farms

- A user can own several farms and switch between them from the header.
- A farm has a name, an owner name and phone (optional), a location and an automatically assigned governorate.
- A farm can be renamed and deleted; deleting it removes its parcels, crop history, analyses and saved plans.
- A **demo farm** can be created in one click: six parcels in Al Husn, Irbid, with three seasons of crop history, marked with a "demo data" badge.

### 16.2 Adding a parcel (four steps)

1. Choose the method: draw on the map, or enter coordinates.
2. Define the boundary.
3. Fill in the details.
4. Review and save.

**Drawing tools**

| Tool | Behaviour |
|---|---|
| Rectangle | press, drag, release |
| Square | press, drag, release; equal sides in metres |
| Free shape | click to add corners; close by clicking the first point, double-clicking, or the "close shape" button |
| Move the map | pan without drawing |

**Editing a shape**: drag a corner; right-click a corner to remove it (at least three remain); click or drag the middle of an edge to add a corner; drag the centre handle to move the whole shape; drag the rotate handle to rotate it. Undo (up to 80 steps) and clear.

**Coordinate entry**: one point per line as `latitude, longitude`. Commas, semicolons, spaces and the Arabic comma are accepted, as are Arabic-Indic digits. The shape previews live and errors are reported per line.

### 16.3 Validation (frontend and backend)

A boundary is rejected if it has fewer than three distinct points, repeated points, crosses itself, covers less than 10 m², has any corner outside Jordan, or **overlaps another parcel of the same farm**. Parcels may share a border, and a sliver of up to 2 % of the smaller parcel is tolerated; beyond that the message names the overlapped parcel and saving is blocked. The backend repeats every check and is the authority. Parcel numbers must be unique within a farm.

### 16.4 Measurements

- **Area**: geodesic (spherical) area of the polygon; the frontend (Turf.js) and backend use the same formula so the figures agree.
- **Perimeter**: sum of haversine distances along the boundary.
- **Centre**: the polygon centroid.
- **Units**: dunum, hectare or square metre. The size of a dunum is configurable from 100 to 10,000 m² (default 1,000).

### 16.5 Parcel details

Name, number, area or locality, status (planted, fallow, being prepared, unused), previous crop, irrigation method (rainfed, drip, sprinkler, surface), colour (eight-colour palette), notes (up to 500 characters), owner or manager name and phone. **Soil information** for the parcel's centre is fetched automatically and shown read-only; the user never types estimated soil values. An optional **laboratory soil test** (eight values) can be entered and is saved with the parcel.

### 16.6 Working with the list and the map

- Search by name, number or locality; filter by crop and by status; total area at the foot of the list.
- Each parcel is drawn in its own colour. Labels appear when zoomed in or when there are few parcels, and grow to "number · name · area" at high zoom.
- For a selected parcel: edit details, edit boundary, run an analysis, delete (with a confirmation showing its name, number, area and perimeter).
- The farm name can be edited in place.

### 16.7 Data exchange

- **Export CSV** (UTF-8 with byte-order mark, opens correctly in Excel): farm, number, name, region, crop, status, area in m², dunum and hectare, perimeter, centre coordinates, owner, notes, and the boundary coordinates.
- **Export GeoJSON**: a FeatureCollection with the boundaries and the same attributes.
- **Import GeoJSON**: FeatureCollection, Feature, Polygon or MultiPolygon. Invalid shapes and shapes outside Jordan are skipped, and a message reports how many were imported and skipped. CSV import is not supported.

---

## 17. Location Detection

1. **Device GPS**: the browser's position is watched for up to 15 seconds and the best fix is kept; a fix accurate to **30 m or better** is accepted at once as exact.
2. **Network position** if GPS fails.
3. **Approximate IP-based estimate** as a last resort, through a public IP-location service, clearly marked as approximate. This step can be switched off in the configuration.

A less accurate fix is shown with an accuracy circle and the user is asked to confirm or correct it by dragging the pin. Manual options: search among the twelve governorates and sixteen towns (Arabic spelling variants are normalised), type coordinates directly, or click the map. A location outside Jordan is refused with a clear message. A precise coordinate does not make the environmental data field-scale: the data keeps its own resolution.

---

## 18. Accounts, Security and Persistence

### 18.1 Accounts

Register (name, email, password of at least 8 characters), sign in, edit the profile name, sign out. A guest can use the recommendation tools without an account; nothing a guest does is stored.

### 18.2 Security

- Passwords are hashed with **Argon2**.
- Sessions use **JSON Web Tokens** (HS256) valid for seven days. The signing secret is read from the environment; if absent it is generated once and kept in a file excluded from version control.
- An expired or invalid session signs the user out automatically.
- Every farm, parcel, analysis and plan is checked to belong to the requesting user.
- **Rate limits** per IP address: 10 requests per minute on registration, sign-in and password-reset; 12 per minute shared by the three public computation endpoints (guest recommendations, forecast outlook, rotation plan).
- No secret or API key is stored in the repository; `.env.example` files document the settings. The map providers used need no key.

### 18.3 Database (SQLite)

| Table | Holds |
|---|---|
| `user` | email, name, password hash, language, area unit |
| `farm` | owner, name, centre, governorate, demo flag |
| `plot` | farm, number, name, polygon (GeoJSON), area, perimeter, colour, status, crops, irrigation, notes, laboratory soil test |
| `crophistory` | parcel, season, crop |
| `analysis` | farm, type, scope, inputs, status, stage, result, error, summary |
| `rotationplan` | farm, parcel, request, full plan, summary |
| `envcache` | NASA POWER payload per 0.5° cell, with fetch time |
| `forecast` | reserved for the optional prediction-service endpoint |

Foreign keys are enforced and write-ahead logging is on. Columns added after the first release are added in place at start-up, so an existing database keeps its data. The research dataset and the models are files, not database rows.

### 18.4 Jordan boundary check

A point is accepted when it lies inside the national polygon (Shapely, prepared geometry). The governorate is the polygon containing the point, or the nearest one for points on a simplified border.

### 18.5 Error contract

Every error has the same shape: `{"error": {"code", "message", "details"}}`. Codes include `UNSUPPORTED_LOCATION`, `UNSUPPORTED_CROP`, `INVALID_GEOMETRY`, `DUPLICATE_LABEL`, `DATE_OUT_OF_RANGE`, `MISSING_DATA`, `UPSTREAM_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `RATE_LIMITED`, `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `UNAUTHORIZED`, `NOT_FOUND`. The frontend maps each code to a translated message.

---

## 19. Web Application

### 19.1 Pages

| Page | What it does |
|---|---|
| **Landing** | Introduces the project; buttons to register or try without an account; how it works; data sources; the thirteen crops |
| **Sign in, Register, Forgot password** | Account access with field validation and translated errors |
| **Guest** | Locate the land, choose the irrigation method, then three tabs: crops ranked from historical climate, the 30- and 90-day forecast with ranked crops, and the rotation planner. Nothing is saved |
| **Farm setup** | Two steps: location, then farm details; or create the demo farm |
| **Dashboard** | Greeting; farm card with total area, parcel count and a map of all parcels in their colours; three observed indicators (root-zone soil moisture, temperature, seasonal rainfall) each compared with its historical average and a trend strip; parcels table with crop, area, latest suitability score and top risk; four quick actions; risk alerts; recent analyses |
| **My Farm** | Parcel management on satellite imagery (Section 16) |
| **New Analysis** | Wizard: scope (whole farm or chosen parcels, picked from a list or the map), objective (six analyses), crop or priority and date where needed, review |
| **Analysis result** | One of six result views (Section 15.5), a parcel switcher, an "about this data" card with sources and a disclaimer, PDF export |
| **Rotation Planner** | Section 14, for a chosen parcel, with save |
| **Forecast** | Section 13, for a chosen parcel: the land's history, cultivation type, laboratory soil form, planting date, 30/90-day switch, four forecast tiles with error and method, three ranked crops, soil and terrain, historical indicators, warnings |
| **Environmental Analytics** | Charts of observed NASA POWER data at the farm: temperature, rainfall, soil moisture, relative humidity, solar radiation; daily, monthly, seasonal or annual; the current values against a dashed historical mean |
| **Risks** | The latest risk assessment of the farm with a button to refresh it |
| **Saved Plans** | Saved rotation plans: open, compare two, print, delete |
| **Reports** | Every saved analysis: type, date, parcels, crop, score or status; view, export PDF, delete, compare two |
| **Settings** | Farms (add, rename, switch, delete); account name; language; area unit and dunum size; map imagery source (Esri World Imagery, OpenStreetMap, or a custom tile URL); notification preferences |

### 19.2 Application shell

- Collapsible sidebar; on phones it becomes a drawer.
- Header with the farm switcher, a search box over the current farm's parcels (name, number, crop), the language toggle, notifications and the account menu.
- **Notifications**: the bell lists the farm's latest events, newest first: analyses that finished or failed, and parcels whose top risk is moderate or high. A badge counts what is new since the list was last opened; an item opens the analysis or the risk page. The two switches in Settings (risk alerts, analysis completed) decide which kinds appear.
- A banner appears when the device is offline; the last loaded data stays visible.

### 19.3 Maps

Leaflet with satellite imagery by default. The view is limited to Jordan and the area outside is dimmed. Controls: zoom, "my location", "back to farm". A coordinate readout and a scale bar are shown where the user draws. Imagery credit stays reachable behind a compact button, as the providers' terms require.

### 19.4 Languages and formatting

- Arabic (default, right-to-left) and English, switchable anywhere and remembered. About 780 translated strings per language.
- Layout uses logical properties, so it mirrors correctly; charts, timelines and maps stay left-to-right.
- Results from the backend carry both languages, so explanations switch with the interface.
- Western digits in both languages; dates in the Jordanian Arabic or British English format.
- The Almarai typeface is used throughout.

### 19.5 Responsive design and accessibility

- Works on desktop, tablet and phone browsers: tables become cards, side panels stack under the map, dialogs become bottom sheets.
- Keyboard-visible focus; correct roles for menus, tabs, dialogs, switches, radio groups, progress bars and comboboxes; errors and notifications announced to screen readers; Escape closes menus and dialogs; focus moves into a dialog when it opens and returns when it closes.

### 19.6 PDF export

Reports and saved plans are exported through the browser's print-to-PDF with a dedicated print layout: navigation and map controls are hidden, a title block is added and sections are kept from splitting across pages.

### 19.7 Frontend performance

Pages are loaded on demand; server data is cached with TanStack Query and the previous result stays on screen while a new one loads.

---

## 20. Backend Implementation

### 20.1 API (all under `/api/v1`)

| Area | Endpoints | Access |
|---|---|---|
| Authentication | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `PATCH /auth/me`, `POST /auth/forgot-password` | public / signed in |
| Location | `GET /geo/locate` | public |
| Farms | `GET /farms`, `POST /farms`, `POST /farms/demo`, `GET/PATCH/DELETE /farms/{id}` | signed in |
| Parcels | `GET/POST /farms/{id}/plots`, `GET /farms/{id}/plots/next-label`, `GET/PATCH/DELETE /plots/{id}`, `GET/PUT /plots/{id}/history` | signed in |
| Analyses | `POST /analyses`, `GET /analyses`, `GET/DELETE /analyses/{id}` | signed in |
| Environment | `GET /environment/summary`, `GET /environment/timeseries` | signed in |
| Crops | `GET /crops`, `GET /crops/{id}` | public |
| Guest | `POST /guest/recommendations` | public, rate-limited |
| Forecast outlook | `GET /outlook/status`, `GET /outlook/soil`, `POST /outlook` | public, rate-limited |
| Rotation planner | `POST /crop-rotation/plan` | public, rate-limited |
| Saved plans | `POST /crop-rotation/plans`, `GET /crop-rotation/plans`, `GET/DELETE /crop-rotation/plans/{id}` | signed in |
| Status | `GET /health`, `GET /models/status`, `GET /data/status` (cached NASA POWER cells and the forecast dataset's sources and date range) | public |

Interactive API documentation is generated at `/api/v1/docs`.

### 20.2 Forecast and recommendation components

- `mvp_inference.py` — applies a registry entry: an XGBoost model or a statistical formula.
- `Model_Registry.json` — the chosen predictor, its features and its validation error for each of the 136 targets.
- `Feature_Manifest.json` — feature names, lags, windows, splits and climatology rules.
- `Final_Test_Metrics.csv` — test error of every target, overall and by season.
- `models/` — seven saved XGBoost models.
- `recommendation_system.py` — the multi-factor engine.
- `environment_service.py` — soil by depth, texture class, fertility percentile, terrain, historical observations.
- `crop_requirements.json` — crop table, previous-crop list, weights and scoring constants.
- `crop_rotation.py` — the 90-day planner.
- `recommendation_api.py` — the package's own router.
- `backend/app/services/outlook_features.py` — rebuilds model features for any date.

Saved models are loaded from disk and applied; nothing is trained at request time.

### 20.3 Configuration

Environment variables (documented in `backend/.env.example`): `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGINS`, `POWER_HISTORY_YEARS` (12), `POWER_CACHE_HOURS` (24), `OFFLINE_MODE`, `RATE_LIMIT_AUTH` (10), `RATE_LIMIT_GUEST` (12), `AI_MODE` (off).

### 20.4 Running the system

- `start.bat` starts everything on Windows: it opens the backend in a second window (creating the Python environment and installing requirements if needed), waits until the health endpoint answers, then starts the frontend and opens the browser.
- Backend: `http://localhost:8765`. Frontend: `http://localhost:5173`, which proxies `/api` to the backend.
- Python 3.11, Node.js.

### 20.5 Testing

| Suite | Size | Covers |
|---|---|---|
| Backend (pytest) | 103 test cases in 7 files | authentication, farms and parcels, the six analyses and guest flow, numerical parity of the analytics engine against fixtures, Jordan geometry, the forecast outlook with the real models, the rotation planner, and the recommendation rules |
| Frontend (Vitest) | 13 test cases | area and perimeter, boundary validation, parcel overlap, coordinate parsing including Arabic digits, shape drawing and rotation, notifications |

Rules verified by tests include: the same temperature with different soil texture gives a different ranking; a different previous crop gives a different ranking; repeating a botanical family lowers rotation compatibility; missing soil data produces unknown factors, never values; a perfect rotation score cannot rescue an environmentally unsuitable crop; a greenhouse leaves outdoor weather out and requires irrigation; historical data is labelled and a date outside the dataset is refused; inconsistent forecasts produce a partial plan; overlapping parcels are refused while neighbours and slivers are accepted; a parcel's laboratory test reaches the analyses.

---

## 21. End-to-End Workflows

**Forecast recommendation**

1. The user picks a parcel (or, as a guest, a location) and optionally a planting date.
2. The backend checks the point is in Jordan and finds the nearest grid location.
3. The feature row for the forecast origin is loaded or rebuilt.
4. Eight forecasts are computed (four variables, two horizons).
5. Soil by rooting depth, terrain and historical observations are read; laboratory values replace estimates where given.
6. The crop history is turned into seasons relative to the planting year.
7. Each candidate crop is scored on nine factors; critical rules are applied.
8. Three crops per period are returned with statuses, group scores, coverage and bilingual explanations.

**Rotation plan**

Steps 1–6 as above, then phase-2 conditions are derived and checked, each phase is evaluated, sequences are scored, and the best plan with alternatives, or a partial plan, is returned and can be saved.

**Historical analysis**

1. The user chooses scope and objective in the wizard.
2. The analysis is queued and the result page shows live stages.
3. Twelve years of NASA POWER data are fetched or read from cache.
4. Seasonal statistics are computed for every ten-day start period.
5. The chosen analysis is produced per parcel and stored.
6. The result is shown, and appears in Reports for export or comparison.

**Farm setup**

Register → locate the farm → name it → draw or enter parcels → measurements are computed → analyses and plans become available.

---

## 22. Technical Challenges and Engineering Solutions

| Challenge | Solution |
|---|---|
| Sources with different resolutions, formats and units | One integration pipeline onto a common 0.1° grid with spatial and temporal keys |
| Missing observations | Documented imputation for one SMAP date; soil gaps kept and reported, not filled |
| Two million records, 512 features | Parquet storage, loading only required columns |
| Temporal leakage | Chronological splits; climatology from prior complete years only; target boundary checks |
| A model for every target is costly and often no better | Hybrid registry chosen on validation: 7 models, 129 formulas |
| Weak rainfall forecasts | Low weight, irrigation never derived from them, warnings, partial plans when forecasts disagree |
| Recommendations that looked the same everywhere when only temperature drove them | Nine crop-specific factors, soil by rooting depth, and rotation from the user's own crop history |
| Missing soil or history data | Unknown factors excluded with a visible coverage figure |
| A good rotation score hiding a bad environment | Critical rules outside the weighted score |
| Outdoor forecasts used for greenhouses | Weather factors treated as unknown; irrigation required; result capped at conditional |
| Demo data mistaken for a live forecast | Explicit data mode, the real date on screen, refusal of dates outside the dataset |
| Irregular parcel shapes | Drawing, editing, rotation, coordinate entry and import, with identical area formulas on both sides |
| Modelled soil differs from the field | Optional laboratory values that keep their source |
| NASA service unavailable | Retries, a 24-hour cache, stale-copy fallback with a staleness flag |
| Arabic and English in one interface | Logical layout, bilingual backend texts, normalised Arabic search |
| Long analyses blocking the interface | Background execution with polled stages |

---

## 23. Technologies

| Technology | Purpose |
|---|---|
| Python 3.11 | Data processing, forecasting, backend |
| XGBoost | Forecasting models |
| Pandas, NumPy, PyArrow | Data handling and Parquet access |
| Scikit-learn | Spatial indexing and evaluation |
| GeoPandas, Rasterio, Xarray, Zarr | Research-stage geospatial and gridded data processing |
| Jupyter Notebook | Research and experiments |
| FastAPI, Uvicorn | Backend API |
| Pydantic | Request and response validation |
| SQLModel, SQLite | Persistence |
| Shapely | Boundary checks and geometry validation |
| PyJWT, Argon2 | Sessions and password hashing |
| HTTPX | NASA POWER requests |
| pytest | Backend tests |
| React 19, TypeScript | Frontend |
| Vite | Build and development server |
| Tailwind CSS 4 | Styling and design tokens |
| React Router 7 | Navigation |
| TanStack Query 5 | Server-state caching |
| i18next | Arabic and English |
| Leaflet, React-Leaflet | Maps |
| Turf.js | Area, perimeter and geometry checks in the browser |
| Recharts | Charts |
| Vitest, oxlint | Frontend tests and linting |
| JSON, GeoJSON, CSV, Parquet | Rules, boundaries, export, datasets |

---

## 24. Technical Innovation

1. **Multi-source environmental intelligence** for Jordan on one grid.
2. **Validation-selected hybrid forecasting** that uses a trained model only where it beats a formula.
3. **Two complementary decision engines** in one application: forecast-based for the coming weeks, climate-based for the typical year.
4. **Explainability by construction**: every score comes with its factors, reasons, sources, coverage and unknowns, in two languages.
5. **Honest handling of uncertainty**: unknown factors, labelled data kinds, partial plans, visible forecast error.
6. **Crop history as a first-class input**, with botanical families and any of 27 previous crops.
7. **Knowledge separated from models**, so crops and rules change without retraining.
8. **Farm management integrated with analysis**: parcels drawn on imagery feed directly into every recommendation.
9. **Field data over estimates**: laboratory soil values replace modelled ones.
10. **Accessible delivery**: bilingual, responsive, usable without an account, no installation.

---

## 25. System Limitations

**Data and forecasting**

1. Forecasts come from prepared historical data (default origin 1 May 2026), not from live observations.
2. The environmental data is coarse compared with a field. NASA POWER meteorology in particular is far coarser than the 0.1° grid; for example, temperatures of a Jordan Valley grid point in the dataset are close to those of Amman, so regional contrasts are understated.
3. Rainfall forecasts are weak (30-day R² is negative on the test period), and the 30-day and 90-day rainfall predictors often disagree, which produces partial rotation plans.
4. Period means and totals do not reveal individual frost nights or heat waves.
5. Five grid points have no soil data.
6. SoilGrids pH is 7.5–8.2 across Jordan, above the range of five of the six AI crops, so the pH factor lowers almost every score.

**Recommendation rules**

7. The AI engine covers six crops, all short-cycle vegetables suited to mild conditions; the analytics engine covers thirteen. The two catalogs do not overlap.
8. Unsuitable crops are shown as "not recommended", not removed.
9. No season eligibility filter beyond the temperature rules, and no regional planting calendars.
10. Harvest dates are estimated only in the rotation planner.
11. Scores and weights are engineering heuristics, not calibrated on Jordanian field data, and are not probabilities.
12. Greenhouse handling assumes nothing about the inside climate, so greenhouse results rest on few factors.
13. The crop references are extension guides from other countries, used qualitatively; several crop values are flagged for review.
14. Rotation plans cover one 90-day window and are not validated multi-year strategies.
15. Water figures are net requirements and do not replace field measurement or irrigation design.

**Application**

16. Password reset does not send an email yet.
17. Notifications are in-app only (no email or push), and what counts as new is remembered per browser.
18. Parcels can be imported from GeoJSON only.
19. In the six analyses a laboratory test supplies the pH comparison only; it does not change the score, and its texture and nutrient values are used only by the forecast engine and planner.
20. SQLite and in-memory rate limiting suit a single-server deployment.
21. It is a responsive web application, not a native mobile app.
22. Results are guidance and do not replace a local agricultural engineer.

---

## 26. Current Implementation Status

Implemented and tested:

- Integrated dataset: 835 locations, 2,059,110 records, December 2019 – August 2026.
- 512 engineered features; 136 forecasting targets; 7 XGBoost models and 129 statistical predictors.
- 30-day and 90-day forecasts for any date in the dataset, with method and error shown.
- Multi-factor recommendation engine (`mvp-2`): nine factors, critical rules, unknown-factor handling, soil by rooting depth, 27 previous crops, open field and greenhouse, laboratory soil values, bilingual explanations.
- 90-day crop rotation planner with partial-plan handling, alternatives and saved plans.
- Historical analytics engine (`rules-v1`): six analyses on thirteen crops from twelve years of NASA POWER data.
- Environmental analytics charts and a risk page.
- Farm and parcel management: drawing, editing, coordinate entry, validation including overlap between parcels, measurement in three units, colours, search and filters, a laboratory soil test per parcel, CSV and GeoJSON export, GeoJSON import.
- In-app notifications for finished analyses and parcel risks.
- Precise location detection with accuracy handling.
- Accounts, multiple farms, demo farm, guest mode.
- Reports with comparison and PDF export.
- Arabic and English, responsive layout, accessibility support.
- 116 automated test cases (103 backend, 13 frontend).

---

## 27. Future Development

- Automated ingestion of current observations and live feature building.
- Better precipitation forecasting, including operational weather products.
- More crops in the AI catalog, including warm-season crops.
- Regional planting calendars for the Jordan Valley, highlands and arid regions.
- A mandatory season eligibility filter and exclusion of unsuitable crops.
- Greenhouse-specific crop requirements.
- Review of crop requirements and weights by Jordanian agronomists; field validation.
- Irrigation scheduling, yield estimation, multi-year rotation.
- Email delivery (password reset, alerts) and push notifications.
- Soil chemistry and texture as scored factors in the six analyses; CSV import.
- A production database and distributed rate limiting.
- A dedicated mobile application if needed.

These are proposals, not existing features.

---

## 28. Environmental and Agricultural Impact

The platform aims to make environmental information usable for planning: clearer crop and timing choices, awareness of water needs and climatic risks, attention to rotation and soil, organised farm records, and less manual data work. It is aligned with SDG 2 (Zero Hunger), SDG 6 (Clean Water and Sanitation), SDG 12 (Responsible Consumption and Production) and SDG 13 (Climate Action). These are intended contributions; no improvement in yield or water use has been measured.

---

## 29. Conclusion

AgriVision joins a verified multi-source dataset of 2,059,110 records over 835 locations, a hybrid forecasting system of 136 targets, two explainable decision engines and a complete farm management application. It turns forecasts, soil, terrain and the land's own history into ranked crops and planting sequences, and turns twelve years of observed climate into suitability, planting-period, water, rotation and risk analyses for thirteen crops. It states what it does not know, labels historical data as historical, and keeps its agricultural knowledge editable without retraining. That makes it a sound and extensible base for agricultural decision support in Jordan.

---

## 30. References

**NASA data**

1. NASA POWER — https://power.larc.nasa.gov/
2. NASA SMAP — https://science.nasa.gov/mission/smap/
3. NASA GPM IMERG — https://gpm.nasa.gov/data/imerg

**Other data**

4. ISRIC SoilGrids — https://isric.org/explore/soilgrids
5. Copernicus DEM GLO-30 — https://registry.opendata.aws/copernicus-dem/
6. geoBoundaries — https://www.geoboundaries.org/

**Agricultural knowledge used in the rules**

7. FAO ECOCROP database — crop environmental requirements.
8. Allen, Pereira, Raes, Smith. *Crop evapotranspiration*. FAO Irrigation and Drainage Paper 56.
9. Utah State University Extension — Vegetable Guide: root crops and leafy greens soil and fertility, soil management; fact sheets for carrots, beets, radishes, spinach and beans. https://extension.usu.edu/vegetableguide/
10. University of Minnesota Extension — Living soil, healthy garden (plant families and rotation). https://extension.umn.edu/
11. USDA soil texture classes and rock-fragment classes; FAO slope classes.

**References for future validation and extension (not yet used in the rules)**

12. National Agricultural Research Center (NARC), Jordan — https://www.narc.gov.jo/
13. Colorado State University Extension — Vegetable Planting Guide.
14. University of Maryland Extension — When to Plant Vegetables.

**Software**

15. XGBoost, Scikit-learn, Pandas, Apache Parquet, Xarray, FastAPI, SQLModel, SQLite, React, Leaflet, Turf.js, Recharts — official documentation.
16. GeoJSON specification (RFC 7946).

The agricultural references support the rule tables; they are not machine-learning training data.
