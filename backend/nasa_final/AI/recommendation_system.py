from pathlib import Path
import json
import math

CATALOG = json.loads(Path(__file__).with_name('crop_requirements.json').read_text(encoding='utf-8'))

def band(value, bounds, margin):
    lo, hi = bounds
    return max(0.0, 1 - max(lo-value, value-hi, 0)/margin)

def recommend(horizon_days, temperature_c, humidity_pct, soil_moisture_m3_m3, rainfall_mm, irrigation_available=None, soil_ph=None):
    if horizon_days not in (30,90): raise ValueError('horizon must be 30 or 90')
    values = [temperature_c, humidity_pct, soil_moisture_m3_m3, rainfall_mm]
    if not all(math.isfinite(v) for v in values): raise ValueError('Non-finite forecast')
    if not (-60 <= temperature_c <= 65 and 0 <= humidity_pct <= 100 and 0 <= soil_moisture_m3_m3 <= 1 and rainfall_mm >= 0): raise ValueError('Invalid forecast units/range')
    if soil_ph is not None and not (math.isfinite(soil_ph) and 0 <= soil_ph <= 14): raise ValueError('Invalid soil pH')
    # Generic screening proxies only: SFMC is surface moisture, not plant-available water.
    moisture = band(soil_moisture_m3_m3, (0.15,0.35),0.15)
    humidity = band(humidity_pct,(40,80),40)
    rain_rate = rainfall_mm/horizon_days
    # Rain contributes only a weak dry-condition flag, not an irrigation prescription.
    rain = 1.0 if irrigation_available is True else min(1.0, rain_rate/1.0)
    results=[]
    for crop in CATALOG['crops']:
        if crop['horizon'] != horizon_days: continue
        temp = band(temperature_c,crop['temp'],10)
        factors={'temperature':(temp,60),'surface_moisture_proxy':(moisture,20),'humidity_proxy':(humidity,10),'rainfall_proxy':(rain,5)}
        if soil_ph is not None: factors['soil_ph']=(band(soil_ph,crop['ph'],2),5)
        score=100*sum(s*w for s,w in factors.values())/sum(w for s,w in factors.values())
        reasons=[]; risks=[]
        if temp==1: reasons.append('متوسط الحرارة ضمن النطاق المقترح للمحصول')
        else: risks.append('متوسط الحرارة خارج النطاق المقترح للمحصول')
        if moisture<0.8: risks.append('مؤشر رطوبة سطح التربة بعيد عن نطاق الفحص الأولي')
        if humidity<0.8: risks.append('الرطوبة الجوية خارج نطاق الفحص الأولي')
        if rain<0.5: risks.append('الأمطار المتوقعة قليلة نسبيًا؛ تحقق من توفر الماء')
        if irrigation_available is None: risks.append('توفر الري غير معروف')
        if soil_ph is None: risks.append('حموضة التربة غير متاحة')
        elif factors['soil_ph'][0]<1: risks.append('حموضة التربة خارج النطاق التقريبي')
        if crop['days'][1]>horizon_days: risks.append('قد يتأخر الحصاد عن الفترة المحددة حسب الصنف والظروف')
        if crop['id']=='bush_bean': risks.append('تحقق من خطر الصقيع قبل الزراعة')
        blocked=temp<0.4 or (irrigation_available is False and moisture<0.3 and rain<0.5)
        status='not_recommended' if blocked or score<50 else 'conditional' if score<75 or temp<1 or irrigation_available is not True or moisture<0.8 or (soil_ph is not None and factors['soil_ph'][0]<1) else 'suitable_candidate'
        if blocked: score=min(score,49)
        results.append(dict(crop_id=crop['id'],name_ar=crop['name_ar'],name_en=crop['name_en'],score=round(score,2),status=status,days_to_harvest=crop['days'],note_ar=crop['note_ar'],reasons=reasons,risks=risks,factor_scores={k:round(s*100,1) for k,(s,w) in factors.items()}))
    results.sort(key=lambda x: (x['status']!='not_recommended',x['score']),reverse=True)
    best=next((r['crop_id'] for r in results if r['status']!='not_recommended'),None)
    return {'horizon_days':horizon_days,'rule_version':CATALOG['version'],'best_candidate':best,'recommendations':results,'warnings':['درجة الملاءمة مؤشر قواعد وليست احتمال نجاح أو ضمان حصاد','توقع الأمطار ضعيف الدقة؛ لا تستخدمه لتحديد كمية الري','متوسط الفترة لا يكشف الصقيع أو موجات الحر؛ تحقق من الطقس الفعلي','قواعد تجريبية غير معايرة محليًا؛ رطوبة السطح ليست رطوبة منطقة الجذور']}
