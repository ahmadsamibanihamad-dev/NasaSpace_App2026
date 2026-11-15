import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import governorates from '../data/geo/governorates.json'

export const CROP_IDS = ['wheat', 'barley', 'lentil', 'chickpea', 'vetch', 'tomato', 'cucumber', 'potato', 'onion', 'eggplant', 'olive', 'date_palm', 'citrus'] as const
/** The six crops of the AI team's recommendation system (forecast and rotation planner). */
export const TEAM_CROP_IDS = ['radish', 'arugula', 'spinach', 'carrot', 'beet', 'bush_bean'] as const

export interface Place {
  id: string
  name_ar: string
  name_en: string
  lat: number
  lon: number
  kind: 'governorate' | 'town' | 'coords'
  zoom: number
}

type GovProps = { id: string; name_ar: string; name_en: string }
const govFeatures = (governorates as unknown as { features: Feature<Polygon, GovProps>[] }).features

// Governorate search points: point-on-surface of each governorate polygon.
const govPlaces: Place[] = govFeatures.map((f) => {
  const c = turf.pointOnFeature(f).geometry.coordinates
  return { id: f.properties.id, name_ar: f.properties.name_ar, name_en: f.properties.name_en, lat: c[1], lon: c[0], kind: 'governorate', zoom: 10 }
})

// Approximate town-centre coordinates, only used to pan the map for manual search.
// The user always confirms the exact location by clicking/dragging on the map.
const towns: Place[] = [
  { id: 'amman', name_ar: 'عمّان', name_en: 'Amman', lat: 31.954, lon: 35.911, kind: 'town', zoom: 12 },
  { id: 'irbid', name_ar: 'إربد', name_en: 'Irbid', lat: 32.556, lon: 35.85, kind: 'town', zoom: 12 },
  { id: 'husn', name_ar: 'الحصن', name_en: 'Al Husn', lat: 32.487, lon: 35.88, kind: 'town', zoom: 13 },
  { id: 'ramtha', name_ar: 'الرمثا', name_en: 'Ar Ramtha', lat: 32.559, lon: 36.007, kind: 'town', zoom: 13 },
  { id: 'zarqa', name_ar: 'الزرقاء', name_en: 'Zarqa', lat: 32.073, lon: 36.088, kind: 'town', zoom: 12 },
  { id: 'mafraq', name_ar: 'المفرق', name_en: 'Mafraq', lat: 32.343, lon: 36.208, kind: 'town', zoom: 12 },
  { id: 'jerash', name_ar: 'جرش', name_en: 'Jerash', lat: 32.275, lon: 35.896, kind: 'town', zoom: 13 },
  { id: 'ajloun', name_ar: 'عجلون', name_en: 'Ajloun', lat: 32.333, lon: 35.752, kind: 'town', zoom: 13 },
  { id: 'salt', name_ar: 'السلط', name_en: 'As Salt', lat: 32.039, lon: 35.727, kind: 'town', zoom: 13 },
  { id: 'deiralla', name_ar: 'دير علا', name_en: 'Deir Alla', lat: 32.198, lon: 35.623, kind: 'town', zoom: 13 },
  { id: 'madaba', name_ar: 'مادبا', name_en: 'Madaba', lat: 31.717, lon: 35.8, kind: 'town', zoom: 13 },
  { id: 'karak', name_ar: 'الكرك', name_en: 'Al Karak', lat: 31.185, lon: 35.705, kind: 'town', zoom: 13 },
  { id: 'tafilah', name_ar: 'الطفيلة', name_en: 'At Tafilah', lat: 30.838, lon: 35.604, kind: 'town', zoom: 13 },
  { id: 'maan', name_ar: 'معان', name_en: "Ma'an", lat: 30.196, lon: 35.736, kind: 'town', zoom: 13 },
  { id: 'aqaba', name_ar: 'العقبة', name_en: 'Aqaba', lat: 29.532, lon: 35.006, kind: 'town', zoom: 13 },
  { id: 'azraq', name_ar: 'الأزرق', name_en: 'Azraq', lat: 31.835, lon: 36.814, kind: 'town', zoom: 13 },
]

export const PLACES: Place[] = [...govPlaces, ...towns]

export function searchPlaces(q: string): Place[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const norm = (x: string) => x.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ّ/g, '')
  const ns = norm(s)
  return PLACES.filter((p) => norm(p.name_ar).includes(ns) || p.name_en.toLowerCase().includes(s)).slice(0, 8)
}
