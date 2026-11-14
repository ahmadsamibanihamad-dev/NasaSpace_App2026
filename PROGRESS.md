# Ardna (أرضنا) — Progress / Handoff

Paused on 2026-11-14 at the user's request, partway through **Phase 3**.
The full original spec is the user's first message: 8 phases, design system, API contract, NASA data rules, and ML hook.
To resume, read this file and then continue from "Next steps".

## Environment
- Windows 11, Python 3.11.8, Node 24.18, npm 11.16, git 2.55.
- Backend venv: `backend/.venv`. Dependencies are in `backend/requirements.txt` and already installed.
- `.claude/launch.json` has two configs:
  - `frontend`: Vite on :5173, proxies `/api` to :8000.
  - `backend`: uvicorn `app.main:app` with `--reload` on :8000.
- Tests:
  - Backend: `backend/.venv/Scripts/python.exe -m pytest -q -p no:warnings`, run from `backend/`. 10 passing.
  - Frontend: `npm test`, run from `frontend/`. Vitest, 6 passing.
- Commit after every phase, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Done
### Phase 1 (committed)
- Vite + React + TS + Tailwind v4.
  - Design tokens are in `frontend/src/index.css` under `@theme`. All hues not in the palette were removed.
  - The font is IBM Plex Sans Arabic in weights 300, 400 and 600.
- i18n: `frontend/src/i18n/{ar,en}.json` already contain strings for ALL screens. Arabic RTL is the default.
  - `loc()` picks the right language from a backend `{ar,en}` object.
- UI kit:
  - `components/ui/primitives.tsx`: Button, IconButton, Card, Pill, Chip, Tabs, Field, Input, Select, Stepper, Toggle, Skeleton, PageHeader.
  - `components/ui/viz.tsx`: Gauge, TickStrip, FactorBar, Metric, Drops, WindowBar.
  - `components/ui/states.tsx`: Empty, Error (maps UNSUPPORTED_LOCATION/CROP, VALIDATION, offline), Banner, Offline, DemoBadge, DataFooter, LowQualityBanner.
  - `Icon.tsx`: line icons.
  - `crops/CropIcon.tsx`: an SVG for each of the 13 crops.
- Data and state:
  - `lib/api.ts`: fetch wrapper; errors arrive as `{error:{code,message,details}}`.
  - `lib/types.ts`: the full API contract, including result shapes for all 6 analysis types.
  - `lib/format.ts`
  - `hooks/queries.ts`: every TanStack hook, including those for later phases.
  - `auth/AuthContext.tsx`
  - `layout/FarmContext.tsx`
- Shell, pages and routing:
  - `layout/AppShell.tsx`: sidebar (240px, collapses to 72px) and top bar (farm switcher, search, language, notifications, avatar).
  - `pages/Landing.tsx`
  - `pages/auth/AuthPages.tsx`: sign in, register, forgot password.
  - `App.tsx`: routes, RequireAuth, and RequireFarm (redirects to `/setup` when the user has no farm).
- Hero image is at `frontend/public/images/hero-farm.webp`.
- Jordan GeoJSON comes from geoBoundaries gbOpen:
  - ADM0 is CC BY 4.0; ADM1 (12 governorates, with Arabic names added) is CC BY 2.5.
  - Copies are in `backend/app/data/geo/*.geojson` and `frontend/src/data/geo/*.json`.
  - The source metadata is in `backend/app/data/geo/source_adm*.json`.
  - TODO: credit the source and license in the README.

### Phase 2 (committed)
- Core: `backend/app/core/{config,db,errors,security}.py`.
  - JWT uses argon2 password hashing.
  - The JWT secret is random per process when `JWT_SECRET` is unset.
- Models are in `backend/app/models/__init__.py`: User, Farm (with `plot_layout` JSON), Plot, CropHistory, Analysis, EnvCache.
- API (`backend/app/api/`):
  - `auth.py`: register, login, me, PATCH me, forgot-password stub.
  - `geo.py`: `/geo/locate`.
  - `farms.py`: farms CRUD; `PUT /farms/{id}/plots` bulk replace that keeps plot ids by label and saves `layout`; `PATCH /farms/{id}/plots/details`; plot GET/PATCH; history GET/PUT/POST/DELETE; `latest_plot_scores()`.
- `services/geo.py`:
  - Point-in-polygon checks for Jordan and governorates.
  - Turf-identical geodesic area.
  - Raises `UNSUPPORTED_LOCATION`.
- `services/crops.py`: CROP_IDS and a loader for `app/data/crops.json`, which does not exist yet.
- `main.py`: routers for crops, environment and analyses are imported automatically once their files exist. On startup it calls `app.engine.registry.init_engine` if that module exists.
- `backend/.env.example` is written. It uses the earthaccess variable names `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD` and optionally `EARTHDATA_TOKEN`.

### Phase 3 (IN PROGRESS, partly uncommitted)
Written:
- `frontend/src/lib/plotGrid.ts` and its tests. This is the plot editor model:
  - Divider fractions over the bounding box, splits, merges with an adjacency check, exclude, labels A1/B1, clipping to the boundary, and a check for plots under 0.25 dunum.
- `frontend/src/lib/places.ts`: governorate and approximate town search, plus the CROP_IDS list.
- `components/map/JordanMap.tsx`:
  - Satellite tiles configured in env, maxBounds locked to Jordan, and the area outside Jordan masked.
  - Helpers: FlyTo, FitGeometry, pin and vertex icons.
- `components/map/PlaceSearch.tsx` and `components/map/HatchDefs.tsx` (hatched fill for excluded plots).
- `pages/setup/StepLocate.tsx`: geolocation states asking, detecting, detected, denied, outside, and manual ("ليست هذه أرضي").
- `pages/setup/StepBoundary.tsx`: draw a polygon, drag vertices, undo, clear, live area, farm name, confirm.
- `pages/setup/StepPlots.tsx`: the full plot division editor (toolbar, draggable dividers, plot list, totals, validation).

Not written yet:
- `pages/setup/StepDetails.tsx`: per-plot table for crops, irrigation, soil and pH, with "apply to all". It exports `PlotDetailsTable` and `toDetails` for reuse in My Farm.
- `pages/setup/SetupWizard.tsx`: currently a placeholder. It needs:
  - A full-screen layout with a 4-step indicator.
  - URL state `?farm=ID&step=locate|boundary|plots|details`; `?new=1` adds a farm.
  - Persistence: boundary → POST/PATCH `/farms`; plots → PUT plots with `layout`; details → PATCH details; then navigate to `/app`.
- Then run `npx tsc -b`, check in the browser, and commit Phase 3.

## Verified reference data (saved in repo)
- `backend/app/data/sources/ecocrop_extract.csv`:
  - FAO ECOCROP values for all 13 crops: TMIN/TOPMN/TOPMX/TMAX, KTMP, RMIN/ROPMN/ROPMX/RMAX, GMIN/GMAX, pH.
  - Source: Recocrop R package, `inst/parameters/ecocrop.rds` (github cropmodels/Recocrop).
  - Caveat: KTMP=0 for several crops may be a placeholder, so mark it needs_review.
- `backend/app/data/sources/fao56_ch6_table_rows.txt` and `fao56_ch8_table_rows.txt`: rows parsed from FAO-56 Tables 11, 12 and 22, from fao.org/3/x0490e/x0490e0b.htm and x0490e0e.htm.
  - Kc values (Table 12):
    - wheat (winter, non-frozen soils): 0.7 / 1.15 / 0.25-0.4
    - barley: 0.3 / 1.15 / 0.25
    - lentil: 0.4 / 1.10 / 0.30
    - chickpea: 0.4 / 1.00 / 0.35
    - tomato: 0.6 / 1.15 / 0.70-0.90
    - cucumber: 0.6 / 1.00 / 0.75
    - potato: 0.5 / 1.15 / 0.75
    - onion (dry): 0.7 / 1.05 / 0.75
    - eggplant: 0.6 / 1.05 / 0.90
    - olive: 0.65 / 0.70 / 0.70
    - date palm: 0.90 / 0.95 / 0.95
    - citrus (70% canopy, no ground cover): 0.70 / 0.65 / 0.70
  - Vetch is NOT in FAO-56, so its values are needs_review.
  - Stage lengths (Table 11):
    - Mediterranean rows: winter wheat 30/140/40/30 (Nov), tomato 30/40/45/30 (Apr/May), onion 15/25/70/40 (Apr), eggplant 30/45/40/25 (May/Jun), olive 30/90/60/90 (Mar), citrus 60/90/120/95 (Jan).
    - Arid rows: lentil 25/35/70/40 (Oct/Nov), cucumber 25/35/50/20 (Nov or Feb), potato 25/30/30-45/30 (Jan/Nov).
    - No row exists for chickpea or date palm, so those are needs_review.
  - Root depth and p (Table 22) are in the rows file.
- NASA POWER daily point API, checked live (v2.10.3):
  - Parameters `T2M, T2M_MIN, T2M_MAX, RH2M, WS2M, ALLSKY_SFC_SW_DWN (MJ/m²/day), PRECTOTCORR (mm/day), GWETTOP, GWETROOT (0-1 wetness fraction, not volumetric)` with `community=AG`.
  - fill_value is -999. The elevation is returned in geometry.coordinates[2], which is useful for FAO-56 Penman-Monteith.
- The SMAP granule `SMAP_L3_SM_P_E_20261112_R19240_001.h5` was NOT found in Downloads, OneDrive, or anywhere in the user profile. The local-file option of the ingestion script still needs to be supported; ask the user for the path.

## Next steps (remaining phases per spec)
1. Finish Phase 3 (see above) and commit.
2. Phase 4:
   - `services/power.py`: httpx client; cache in EnvCache keyed by 0.5° cell; at least 10 years of history; drop fill values; no network calls when OFFLINE_MODE is set.
   - `engine/features.py`: GDD, frost days and probability per dekad, heat days, seasonal rain plus CV plus fraction of years meeting the minimum, CDD with the 1 mm threshold, R95p extreme days, ET0 by FAO-56 Penman-Monteith with Hargreaves fallback, ETc, irrigation requirement, soil-moisture anomaly and trend.
   - `api/environment.py`: summary and timeseries endpoints.
   - Dashboard and Analytics pages.
   - Demo/fallback data must be flagged `is_demo`.
3. Phase 5:
   - `data/crops.json`: every value carries a source; uncertain values get `needs_review`.
   - `engine/base.py`: the RecommendationEngine interface.
   - `engine/suitability.py`: trapezoid scores; weights read from a config file; statuses at 80/60/40; planting window in 10-day steps; risks; bilingual template explanations citing the evidence.
   - `engine/rotation.py`: produces 3 strategies.
   - `engine/ml_engine.py` (empty, with TODOs) and `ml/loader.py`.
   - `engine/registry.py`: selects rules/ml/hybrid from ENGINE and sets `engine_fallback`.
   - `ml/FEATURES.md`.
   - Tests that use a fake engine.
4. Phase 6:
   - `api/analyses.py`: background task with the 4 stages; result format per the spec; PDF via reportlab with arabic-reshaper and python-bidi.
   - Screens: New Analysis wizard, Processing, Results views per type, Recommended Crops and Crop Details, Calendar, Rotation planner, Risk Center, Reports (compare and PDF).
5. Phase 7:
   - `scripts/ingest_smap.py`: earthaccess, SPL3SMP_E; Jordan subset; keep retrieval_qual_flag bit0 == 0; average AM and PM; accept a local file.
   - `scripts/ingest_imerg.py`: confirm short names with earthaccess search, likely GPM_3IMERGM and GPM_3IMERGDF V07.
   - Fallback policy and map layers.
6. Phase 8:
   - Seed script: demo user; farm مزرعة الحصن near 32.5568 N 35.8469 E, about 25 dunum; plots A1 wheat, A2 wheat, A3 barley, B1 lentil, B2 fallow, B3 tomato; crop history.
   - README with Windows instructions.
   - Implement every UI state, check the English version, do an accessibility pass.
   - Write the final summary.

## Decisions to keep
- Semantic colors (water, warning, critical) are used only on icons and dots. Text stays text-primary so it meets AA contrast.
- Chart and time axes run left to right in both languages.
- The frontend contains no recommendation logic. Crop ids and names for dropdowns are display data only.
