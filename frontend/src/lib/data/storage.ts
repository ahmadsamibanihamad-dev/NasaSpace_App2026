// Low-level browser storage with explicit failures (never lose data silently).
import { ApiError } from '../api'

const PREFIX = 'ardna.v1.'

export function readTable<T>(name: string): T[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(PREFIX + name)
  } catch {
    throw new ApiError(0, 'STORAGE_UNAVAILABLE', 'Browser storage is not available')
  }
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    throw new ApiError(0, 'STORAGE_CORRUPT', `Stored data for "${name}" could not be read`)
  }
}

export function writeTable<T>(name: string, rows: T[]): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(rows))
  } catch {
    throw new ApiError(0, 'STORAGE_FAILED', 'Saving failed: browser storage is full or blocked')
  }
}

export function readValue<T>(name: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeValue(name: string, value: unknown): boolean {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + name)
    else localStorage.setItem(PREFIX + name, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const nowIso = () => new Date().toISOString()
