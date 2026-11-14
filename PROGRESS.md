# Ardna (أرضنا) — Progress / Handoff

Last updated 2026-11-14.

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
