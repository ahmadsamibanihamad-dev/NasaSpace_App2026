NASA_FINAL — MVP presentation package
Final raw/cleaned dataset: data/processed/master_2019_2026/Jordan_Master_Dataset_2019_2026_Cleaned.parquet
Inference: AI/forecasting/ (selected XGBoost models + baseline formulas + registry).
Historical demo: python run_demo.py (origin 2026-05-01; not live weather).
Install original model requirements plus pyarrow in your environment if needed.
Notebooks retain original paths and outputs for presentation; do not Run All without adapting paths and supplying missing intermediate data. Full engineered splits omitted unless --include-splits was used.
The recommendation engine and live GPS-to-feature pipeline are separate; this package does not create either.
Original NASA directory was not modified.
