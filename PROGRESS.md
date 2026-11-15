# Ardna (أرضنا) — Progress / Handoff

Last updated 2026-11-15.

## Whole site rebuilt on the AI team's material (2026-11-15, user decision)

The user: the 13 crops are cancelled; everything must work from what the team sent; for crop rotation follow the team's prompt ("AI-Powered Crop Rotation Planner").

- **Removed**: the 13-crop rule engine (`app/engine/suitability, rotation, run, decision, config`), its data (`crops.json`, `engine_config.json`, ECOCROP/FAO extracts), the six analyses and their API, guest 13-crop recommendations, the unused `app/ml` layer and `/forecasts`, the parity tests; in the frontend the New Analysis wizard, result pages, Risks page and the old Rotation page.
- **Crop Rotation Planner**: `backend/nasa_final/AI/crop_rotation.py` (pure logic) + `app/api/crop_rotation.py` + `frontend/src/features/rotation/RotationPlanner.tsx`. Phase 1 = days 1-30 (short crop), phase 2 = days 31-90 (longer crop). Phase 2 conditions are derived from the 30- and 90-day forecasts and never clipped; inconsistency gives a partial plan. Scores come from the team's `recommend()`. Weights 0.40/0.40/0.15/0.05.
- `crop_requirements.json` gained a `family` per crop (the team's prompt asked for it).
- Saved plans: table `rotationplan`; Reports page lists, opens, compares, prints and deletes them.
- Six crops everywhere a crop is picked; demo farm uses them.
- Dashboard: farm card, observed NASA POWER cards, parcels table, quick links, saved plans.
- Guest page: forecast tab and planner tab.
- **Finding**: the team's 30-day rain forecast (moving average) and 90-day one (climatology) often contradict each other, so many dates give only a partial plan. Sample of ten locations: all ten on 2026-05-02 (the default date) and 2025-12-20, eight on 2026-02-01, three on 2026-03-15, two on 2025-09-01, none on 2025-11-15.
- **Still not from the team's files**: dashboard cards and the Analytics page read live NASA POWER through `app/engine/features.py` and `environment.py`.
- Legacy tables `analysis` and `forecast` are still defined (old rows are cleaned on farm delete) but unused.
- Tests: backend 41, frontend 8. Browser pass after the rebuild: all pages in Arabic, three in English, five at phone width, save / open / compare / delete a plan.

## Full test pass (2026-11-15)

Run with a fresh account against the live backend and real NASA POWER data.
- Automated: backend 66 tests, frontend 8, type-check and production build clean.
- 67 API-level checks through the site's own data layer (auth, farms, parcels, history, 20 time-series combinations, 11 analysis runs, forecast, soil, guest, error cases): all behave as intended.
- 20 pages opened in Arabic, 19 in English, 15 at phone width: no missing strings, no console errors, no horizontal overflow.
- 26 UI interactions driven by script (wizard, coordinates entry, reports compare, rotation, settings, sign-in/out, validation, delete farm).
- Bugs found and fixed: deleting a farm that had parcels or analyses failed with a 500 (rows were deleted in the wrong order; tests missed it because the test database did not enforce foreign keys, now it does); parcel numbers were joined with an Arabic comma in the English UI.
- Not testable here (browser pane was hidden, so no real mouse input or screenshots): drawing a parcel by dragging on the map, the reshape/rotate handles, print-to-PDF output, real device geolocation, `start.bat` by double-click, visual appearance.
- Findings left for the user: forgot-password page says an email will be sent but none is; in dry cells every rainfed annual crop scores below 40, so rotation options A and B are all fallow; landing page still names SMAP as a source.
- Test accounts left in the local database: e2e-1115@example.com and two full-<timestamp>@example.com.

## Planting date, soil from the API, parcel form (2026-11-15, user request)

- Forecast page has a planting start date. Default 2026-05-02 uses the team's demo snapshot. Other dates (2021-01-02 to 2026-09-01) build features from the team's master dataset with their own notebook code, copied into `backend/app/services/outlook_features.py`; a test proves the output equals their demo snapshot (516 columns, zero difference).
- The master dataset (47 MB) is git-ignored: `backend/nasa_final/data/processed/master_2019_2026/`. Without it only the default date works.
- Soil is never typed by the user. `GET /api/v1/outlook/soil` reads the team's SoilGrids table; pH from it feeds the team's rules. Five grid points (central Irbid and Amman among them) have no soil values and stay empty.
- Parcel form: removed crop type, soil type and soil pH fields; added a read-only soil block. `current_crop_id`, `soil_type`, `soil_ph` columns still exist on Plot.
- The user's rule for this area: do not go beyond the team's recommendation system or add logic of our own to it.

## AI team package integrated (2026-11-15)

The team delivered `NASA_FINAL.zip` (forecast models, baselines, rule-based ranking, FastAPI router).

- Vendored unmodified in `backend/nasa_final/` (models, registry, demo features, crop table, soil table). The 47 MB master dataset and the notebooks were not copied.
- `backend/app/api/outlook.py` wraps the team's functions: `GET /api/v1/outlook/status`, `POST /api/v1/outlook` (public, rate-limited, Jordan-only, nothing stored). It adds soil pH from the team's SoilGrids table and English text for the Arabic reasons.
- Frontend: `features/outlook/OutlookView.tsx` (shared), page `/app/outlook` (nav item "التوقعات", parcel picker), and a second tab on the guest page. Six new crop icons.
- MVP data mode is `historical_demo` (feature snapshot with origin 2026-05-01). The UI says so in a banner. Live forecasting needs a feature builder per location and date: not built.
- Only one of the eight targets used is a trained model (T2M 90-day, XGBoost); the other seven are baseline formulas the team selected on validation.
- xgboost: trained with 3.4.1 (needs Python 3.12). The backend venv is Python 3.11 with xgboost 3.2.0; the models load and predict without warnings, parity with 3.4.1 not verified.
- `JWT_SECRET` unset now falls back to a generated secret kept in `backend/.jwt_secret` (git-ignored), so restarts no longer sign everyone out.
- Tests: backend 61 passing (6 new in `tests/test_outlook.py`), frontend 8.
- The older `app/ml/` layer and `/forecasts` endpoints are still there but unused by the UI.

## Site connected to the backend (done 2026-11-15)

- `frontend/src/lib/data/repo.ts` calls the API (`/api/v1`; Vite proxies `/api` to `127.0.0.1:8765`). It is the only data module. The in-browser engine, climate client and localStorage layer are deleted; the frontend holds no recommendation logic.
- Backend port is **8765**, not 8000: on the user's machine Docker holds 8000 and answered the proxy with its own 404s.
- Guest page `src/pages/Guest.tsx` at `/guest`, linked from the landing page. Nothing is stored for guests.
- `start.bat` opens the backend in a second window (`start-backend.bat`), waits for `/api/v1/health`, then starts the site.
- Verified in the browser against the live backend with real NASA POWER data: guest flow (outside-Jordan rejection, search, results), register, demo farm, dashboard, all six analysis types and their result pages, parcel create / update / history / delete, duplicate-label and outside-Jordan errors.
- Not verified: drawing a parcel by hand in the map UI after the switch (the same `createPlot` call was exercised directly), phone-width layout of the guest page, English guest page, `start.bat` end to end by double-click.
- `backend/tests/fixtures/parity.json` is now frozen reference data; the exporter that produced it was deleted with the frontend engine.
- `backend/ardna.db-shm` and `-wal` had been committed by mistake; they are untracked and ignored now.

Open questions the user has not answered: the landing page still lists SMAP and GPM IMERG as sources although only NASA POWER is used; whether to add radish, arugula and spinach from the AI team's spec.

## Backend built (2026-11-15)
The user asked for the full backend with FastAPI + SQLite, ready for an ML model that the team will deliver, plus a guest mode.

- **Guest**: `POST /api/v1/guest/recommendations` takes a location (and optional irrigation) and returns ranked crops. Nothing is stored.
- **Signed-in users**: farms, parcels, crop history, analyses and forecasts are saved and isolated per user.
- **Engine**: `backend/app/engine/` is a Python port of the frontend engine. `tests/test_engine_parity.py` (34 tests) checks it against reference results exported by `frontend/src/lib/engine/export-fixtures.test.ts`. A live check on real POWER data gave the same ranking as the browser.
- **ML layer**: `backend/app/ml/` has one interface with `off`, `mock` and `production` services chosen by `AI_MODE`; a model registry read from manifests; no silent fallback to mock. `app/engine/decision.py` holds the base rules that turn a forecast into a crop decision (one temperature rule so far).
- **Tests**: 55 passing (`backend/.venv/Scripts/python.exe -m pytest -q`).
- **Docs**: `backend/README.md` (run, API, model integration, what is needed from the AI team). Launcher: `start-backend.bat`.

Not done yet:
- The frontend still uses browser storage. Next step: re-implement `frontend/src/lib/data/repo.ts` against the API, add the guest page, then remove the in-browser engine.
- The AI team's dataset (SMAP, IMERG, SoilGrids, Copernicus DEM, 835-grid mapping), schema and models have not been delivered. `build_features` and inference in `app/ml/production.py` are marked `TODO(model delivery)`.
- The new spec lists radish, arugula and spinach; the crop base still has the original 13. Open decision.
- Open decisions from the spec merge: keep or drop water needs, planting calendar and risk centre; how much data-freshness information the UI should show.
- Web only: the Flutter app was dropped by the user.

## Direction change (user request, 2026-11-14)
- Work is **frontend-only** for now. The backend in `backend/` (Phases 1–2: auth, farms, geo, tests) is kept but not used by the UI.
- The plot mechanism changed: the old grid "plot division editor" was removed. Parcels are now drawn one by one on the map or entered as coordinates, managed from a side panel ("إدارة القطع الزراعية").
- The original spec is still the reference for screens, design system, honesty rules and Jordan-only rules.

## State: all screens work end to end in the browser
Run with `npm run dev` in `frontend/`. Checks: `npx tsc -b`, `npm test` (19 passing), `npm run build`.

- **Data layer**: `lib/data/repo.ts` is the only data access. It uses localStorage (users, session, farms, plots, history, analyses). Swap it for `lib/api.ts` calls to reconnect a backend.
- **Parcels**: `features/parcels/` — `ParcelManager` (flow and panel), `DraftLayer` (draw, drag, midpoints, right-click delete), `ParcelsLayer` (memoized polygons), `ParcelForm`, `io.ts` (CSV/GeoJSON export, GeoJSON import).
- **Geometry**: `lib/geometry.ts` — area, perimeter, validation, coordinate parsing, Jordan and governorate point-in-polygon.
- **Climate**: `lib/climate/power.ts` fetches NASA POWER from the browser (CORS allowed) and caches per 0.5° cell in IndexedDB. `features.ts` holds the feature engineering. `environment.ts` builds the dashboard summary and time series.
- **Engine (provisional, `rules-web-v0`)**: `lib/engine/` — `crops.ts` (sourced knowledge base), `config.ts` (weights, all needs_review), `suitability.ts`, `rotation.ts`, `run.ts` (six analysis types, four real stages).
- **Pages**: Landing, auth, setup (locate + farm name, or demo farm), Dashboard, My Farm, New Analysis, Processing, results for all six types, Rotation, Analytics, Risks, Reports (compare, print to PDF), Settings.
- **Settings**: dunum size in m², area unit, basemap source, language. Stored by `lib/settings.ts`.
- **Demo farm**: `lib/data/demo.ts` (مزرعة الحصن, six parcels, crop history, `is_demo`).

## Verified in the browser
- Register → locate (search by coordinates) → name farm → draw a parcel → data → review → save → reload: parcel persisted.
- Coordinate entry shows per-line errors; boundary editing by dragging a vertex updates area and perimeter live.
- All six analyses complete on the demo farm with real POWER data; rotation shows three strategies with five sections.
- Mobile width: map on top, panel below, drawer navigation.

## Not verified / known gaps
- Parcel delete, GeoJSON import/export, English UI, print-to-PDF output and the offline state were not clicked through in the browser.
- No visual pass at 1280 and 1920 widths; no screen-reader pass.
- Engine scores are uncalibrated. Rainfed wheat in Irbid scores "marginal" (about 48) because POWER rainfall for the cell is low (~330 mm per season).
- SMAP and GPM IMERG are not used (need Earthdata login and a server); data quality is reported as "limited".
- ML integration point (`MLModelEngine`, `ENGINE` switch, `FEATURES.md`) is not built: it belongs to the backend.
- PDF export is the browser print dialog, not a generated file.
- The SMAP granule `SMAP_L3_SM_P_E_20261112_R19240_001.h5` was not found on this machine.

## If the backend work resumes
1. Port `lib/climate/features.ts` and `lib/engine/*` to Python (`backend/app/engine/`), keeping the same result shapes as `frontend/src/lib/types.ts`.
2. Add Plot fields the UI now uses: number (`label`), region, color, status, notes, owner name and phone, perimeter.
3. Build `RecommendationEngine` interface, `RuleBasedEngine`, empty `MLModelEngine`, loader, `ENGINE` env switch, `FEATURES.md`.
4. Write SMAP and IMERG ingestion scripts and apply the fallback policy.
5. Re-implement `repo.ts` against the API and delete the in-browser engine.

## Reference data (in repo)
- `backend/app/data/sources/ecocrop_extract.csv`: FAO ECOCROP rows for the 13 crops.
- `backend/app/data/sources/fao56_ch6_table_rows.txt`, `fao56_ch8_table_rows.txt`: FAO-56 Tables 11, 12, 22.
- `backend/app/data/geo/`: Jordan and governorate GeoJSON with source metadata.

## Conventions
- Semantic colors (water, warning, critical) only on icons and dots; text stays text-primary for AA contrast.
- Chart and time axes run left to right in both languages.
- Commit messages end with the Co-Authored-By line for the current model.
