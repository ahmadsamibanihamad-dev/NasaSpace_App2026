import numpy as np
import pandas as pd

def target_dates(d,s):
    origin=pd.to_datetime(d['DATE'])
    if s['kind']=='season': return pd.to_datetime(d['SEASON_START']),pd.to_datetime(d['SEASON_END'])
    end=origin+pd.to_timedelta(s['days'],unit='D')
    return (end if s['kind']=='daily' else origin+pd.Timedelta(days=1)),end

def clip(p,v):
    p=np.asarray(p,dtype='float64')
    if v=='RH2M': return np.clip(p,0,100)
    if v=='SFMC': return np.clip(p,0,1)
    if v=='IMERG_PRECTOT': return np.maximum(p,0)
    return p

def baseline(d,t,s,name):
    v=s['variable']; rain=v=='IMERG_PRECTOT'
    start,end=target_dates(d,s)
    lead=(start-pd.to_datetime(d['DATE'])).dt.days.to_numpy()
    length=(end-start).dt.days.to_numpy()+1
    decay=np.exp(-lead/7.)*(-np.expm1(-length/7.))/(length*(-np.expm1(-1/7.)))
    climate=d[t.replace('_target_','_clim_')].to_numpy(dtype='float64')
    if name=='Climatology': p=climate
    elif name=='Climatology_Anomaly': p=climate+d[v+'_anomaly'].to_numpy()*decay*(length if rain else 1)
    elif name=='Persistence': p=d[v+'_lag_0'].to_numpy()*(length if rain else 1)
    elif name=='Moving_Average':
        w=90 if s['kind']=='season' else 7 if s['kind']=='daily' else s['days']
        p=d[f'{v}_rolling_{w}_'+('sum' if rain else 'mean')].to_numpy()
        if rain: p=p/w*length
    else: raise ValueError(name)
    return clip(p,v)

def baseline_cols(t,s):
    v=s['variable']; w=90 if s['kind']=='season' else 7 if s['kind']=='daily' else s['days']
    return ['DATE','SEASON_START','SEASON_END',t.replace('_target_','_clim_'),v+'_anomaly',v+'_lag_0',f'{v}_rolling_{w}_'+('sum' if v=='IMERG_PRECTOT' else 'mean')]

def predict_entry(d,t,entry,root):
    s=entry['spec']; name=entry['method']
    if name=='baseline': return baseline(d,t,s,entry['baseline'])
    from xgboost import XGBRegressor
    model=XGBRegressor(); model.load_model(str(root/entry['artifact']))
    p=model.predict(d[entry['features']].astype('float32'))
    if name=='residual_xgb': p=p+baseline(d,t,s,entry['baseline'])
    return clip(p,s['variable'])
