from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional
import json
import math
from fastapi import FastAPI, APIRouter, HTTPException
from pydantic import BaseModel, Field
from .recommendation_system import recommend, CATALOG

ROOT=Path(__file__).resolve().parents[1]
F=ROOT/'AI'/'forecasting'
DEMO=ROOT/'data'/'demo'/'Historical_Demo_Features.parquet'
router=APIRouter(prefix='/api/recommendations',tags=['recommendations'])
app=FastAPI(title='NASA Agriculture MVP')

class ForecastRequest(BaseModel):
    horizon_days: Literal[30,90]
    temperature_c: float=Field(ge=-60,le=65)
    humidity_pct: float=Field(ge=0,le=100)
    soil_moisture_m3_m3: float=Field(ge=0,le=1)
    rainfall_mm: float=Field(ge=0,allow_inf_nan=False)
    irrigation_available: Optional[bool]=None
    soil_ph: Optional[float]=Field(default=None,ge=0,le=14)

class DemoRequest(BaseModel):
    latitude: float=Field(ge=-90,le=90)
    longitude: float=Field(ge=-180,le=180)
    irrigation_available: Optional[bool]=None
    soil_ph: Optional[float]=Field(default=None,ge=0,le=14)

@router.get('/crops')
def crops(): return CATALOG

@router.post('/evaluate')
def evaluate(req: ForecastRequest):
    args=req.model_dump() if hasattr(req,'model_dump') else req.dict()
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
        d,registry=load_demo()
        row,dist=nearest(d,req.latitude,req.longitude)
        if dist>15: raise HTTPException(422,'Location too far from supported demo grids')
        origin=row['DATE'].iloc[0].date()
        output={}
        for days in (30,90):
            values={}; methods={}
            for v,key,agg in [('T2M','temperature_c','mean'),('RH2M','humidity_pct','mean'),('SFMC','soil_moisture_m3_m3','mean'),('IMERG_PRECTOT','rainfall_mm','sum')]:
                target=f'{v}_target_{agg}_{days}d'; entry=registry[target]
                values[key]=float(predict_entry(row,target,entry,F)[0]); methods[key]=entry['method']
            result=recommend(days,**values,irrigation_available=req.irrigation_available,soil_ph=req.soil_ph)
            output[str(days)]={'forecast':values,'methods':methods,'period_start':str(origin+timedelta(days=1)),'period_end':str(origin+timedelta(days=days)),**result}
        return {'data_mode':'historical_demo','forecast_origin':str(origin),'grid_id':str(row.GRID_ID.iloc[0]),'matched_latitude':float(row.LATITUDE.iloc[0]),'matched_longitude':float(row.LONGITUDE.iloc[0]),'distance_km':round(dist,2),'periods':output,'warning':'Historical snapshot; not a live forecast. Nearest-grid distance check is not a national boundary check.'}
    except HTTPException: raise
    except (FileNotFoundError,ImportError,KeyError,ValueError) as e: raise HTTPException(503,'Forecast package unavailable or incompatible') from e

app.include_router(router)
