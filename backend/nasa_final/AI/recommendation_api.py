from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional
import json
from fastapi import FastAPI, APIRouter, HTTPException
from pydantic import BaseModel, Field
from .recommendation_system import recommend, CATALOG, PREVIOUS

ROOT=Path(__file__).resolve().parents[1]
F=ROOT/'AI'/'forecasting'
DEMO=ROOT/'data'/'demo'/'Historical_Demo_Features.parquet'
router=APIRouter(prefix='/api/recommendations',tags=['recommendations'])
app=FastAPI(title='NASA Agriculture MVP')

class HistoryItem(BaseModel):
    year: int=Field(ge=1990,le=2100)
    crop_id: str

class SoilLab(BaseModel):
    """Optional laboratory results. A given value replaces the estimated one; its source is kept."""
    ph: Optional[float]=Field(default=None,ge=0,le=14)
    sand: Optional[float]=Field(default=None,ge=0,le=100)
    silt: Optional[float]=Field(default=None,ge=0,le=100)
    clay: Optional[float]=Field(default=None,ge=0,le=100)
    organic_carbon: Optional[float]=Field(default=None,ge=0)
    nitrogen: Optional[float]=Field(default=None,ge=0)
    cec: Optional[float]=Field(default=None,ge=0)
    coarse_fragments: Optional[float]=Field(default=None,ge=0,le=100)

class ForecastRequest(BaseModel):
    horizon_days: Literal[30,90]
    temperature_c: float=Field(ge=-60,le=65)
    humidity_pct: float=Field(ge=0,le=100)
    soil_moisture_m3_m3: float=Field(ge=0,le=1)
    rainfall_mm: float=Field(ge=0,allow_inf_nan=False)
    irrigation_available: Optional[bool]=None
    soil_ph: Optional[float]=Field(default=None,ge=0,le=14)
    previous_crop: Optional[str]=None
    cultivation_type: Optional[Literal['open_field','greenhouse']]=None

class DemoRequest(BaseModel):
    latitude: float=Field(ge=-90,le=90)
    longitude: float=Field(ge=-180,le=180)
    horizon_days: Optional[Literal[30,90]]=None
    irrigation_available: Optional[bool]=None
    cultivation_type: Optional[Literal['open_field','greenhouse']]=None
    previous_crop: Optional[str]=None
    previous_crop_year: Optional[int]=Field(default=None,ge=1990,le=2100)
    crop_history: list[HistoryItem]=Field(default_factory=list,max_length=10)
    soil_lab: Optional[SoilLab]=None
    # kept from mvp-1; a laboratory pH belongs in soil_lab
    soil_ph: Optional[float]=Field(default=None,ge=0,le=14)

def history_items(planting_year, previous_crop, previous_crop_year, crop_history):
    """Calendar years to {"crop_id","years_ago"} (1 = the most recent season), one crop per season.

    A crop grown earlier in the planting year itself is the most recent season, so older years move
    one step back. The explicitly named previous crop wins when two crops fall in the same season.
    """
    rows=[(h.year if hasattr(h,'year') else h['year'],h.crop_id if hasattr(h,'crop_id') else h['crop_id'],False) for h in crop_history or []]
    if previous_crop: rows.append((previous_crop_year if previous_crop_year else None,previous_crop,True))
    years=[y for y,_,_ in rows if y is not None]
    offset=1 if years and max(years)>=planting_year else 0
    seasons={}
    for year,crop_id,named in rows:
        ago=1 if year is None else max(1,planting_year-year+offset)
        if named or ago not in seasons: seasons[ago]=crop_id
    return [{'crop_id':c,'years_ago':a} for a,c in sorted(seasons.items())]

def check_crops(ids):
    bad=[c for c in ids if c is not None and c not in PREVIOUS]
    if bad: raise HTTPException(422,f'Unknown previous crop: {bad[0]}')

@router.get('/crops')
def crops(): return CATALOG

@router.post('/evaluate')
def evaluate(req: ForecastRequest):
    args=req.model_dump() if hasattr(req,'model_dump') else req.dict()
    check_crops([args.get('previous_crop')])
    return {'data_mode':'provided_forecast','forecast':args,**recommend(**args)}

@lru_cache(maxsize=1)
def load_demo():
    import pandas as pd
    return pd.read_parquet(DEMO),json.loads((F/'Model_Registry.json').read_text(encoding='utf-8'))

def nearest(d,lat,lon):
    import numpy as np
    a=np.radians(d['LATITUDE'].to_numpy(dtype=float)); b=np.radians(d['LONGITUDE'].to_numpy(dtype=float))
    x,y=np.radians([lat,lon]); h=np.sin((a-x)/2)**2+np.cos(a)*np.cos(x)*np.sin((b-y)/2)**2
    dist=6371*2*np.arcsin(np.sqrt(np.clip(h,0,1)))
    i=int(np.argmin(dist)); return d.iloc[[i]],float(dist[i])

@router.post('/demo')
def demo(req: DemoRequest):
    # Historical snapshot only; never claim current weather or forecast availability.
    try:
        from .forecasting.mvp_inference import predict_entry
        from . import environment_service as env
        d,registry=load_demo()
        row,dist=nearest(d,req.latitude,req.longitude)
        if dist>15: raise HTTPException(422,'Location too far from supported demo grids')
        check_crops([req.previous_crop]+[h.crop_id for h in req.crop_history])
        origin=row['DATE'].iloc[0].date()
        start=origin+timedelta(days=1)
        grid_id=str(row.GRID_ID.iloc[0])
        lab=(req.soil_lab.model_dump(exclude_none=True) if req.soil_lab else {})
        if req.soil_ph is not None: lab.setdefault('ph',req.soil_ph)
        history=history_items(start.year,req.previous_crop,req.previous_crop_year,req.crop_history)
        output={}
        for days in ((req.horizon_days,) if req.horizon_days else (30,90)):
            values={}; methods={}
            for v,key,agg in [('T2M','temperature_c','mean'),('RH2M','humidity_pct','mean'),('SFMC','soil_moisture_m3_m3','mean'),('IMERG_PRECTOT','rainfall_mm','sum')]:
                target=f'{v}_target_{agg}_{days}d'; entry=registry[target]
                values[key]=float(predict_entry(row,target,entry,F)[0]); methods[key]=entry['method']
            site=env.site_context(grid_id,start,days,lab)
            result=recommend(days,**values,irrigation_available=req.irrigation_available,site=site,crop_history=history,cultivation_type=req.cultivation_type)
            output[str(days)]={'forecast':values,'methods':methods,'period_start':str(start),'period_end':str(origin+timedelta(days=days)),'site':site,**result}
        return {'data_mode':'historical_demo','forecast_origin':str(origin),'grid_id':grid_id,'matched_latitude':float(row.LATITUDE.iloc[0]),'matched_longitude':float(row.LONGITUDE.iloc[0]),'distance_km':round(dist,2),'cultivation_type':req.cultivation_type or 'open_field','periods':output,'warning':'Historical snapshot; not a live forecast. Nearest-grid distance check is not a national boundary check.'}
    except HTTPException: raise
    except (FileNotFoundError,ImportError,KeyError,ValueError) as e: raise HTTPException(503,'Forecast package unavailable or incompatible') from e

app.include_router(router)
