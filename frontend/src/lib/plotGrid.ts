/**
 * Plot Division Editor model (pure functions, unit-tested).
 *
 * Divider positions are stored as fractions over the boundary's bounding box.
 * Base cells (r, c) come from the dividers; a cell can be split in two ("atoms");
 * a plot is a group of atoms (merged plots are unions). Every plot polygon is the
 * union of its atom rectangles intersected with the farm boundary.
 */
import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { DUNUM_M2, MIN_PLOT_DUNUM } from '../config'

export type SplitDir = 'h' | 'v'
export interface Group {
  atoms: string[]
  excluded: boolean
  reason?: string | null
  name?: string
}
export interface Layout {
  version: 1
  xs: number[] // interior column dividers in (0,1), west→east
  ys: number[] // interior row dividers in (0,1), north→south
  splits: Record<string, SplitDir> // "r-c" → split direction
  groups: Group[]
}
export type BBox = [number, number, number, number] // [west, south, east, north]

export interface ComputedPlot {
  groupIndex: number
  label: string
  name: string
  excluded: boolean
  reason: string | null
  geometry: Polygon | MultiPolygon
  area_m2: number
  center: [number, number] // [lat, lon] for labels
}

export const MIN_GAP = 0.02

export function even(n: number): number[] {
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i + 1) / n)
}

export function atomKeysForCell(r: number, c: number, splits: Record<string, SplitDir>): string[] {
  const k = `${r}-${c}`
  return splits[k] ? [`${k}-0`, `${k}-1`] : [k]
}

export function allAtoms(l: Layout): string[] {
  const out: string[] = []
  for (let r = 0; r <= l.ys.length; r++) for (let c = 0; c <= l.xs.length; c++) out.push(...atomKeysForCell(r, c, l.splits))
  return out
}

export function createLayout(rows: number, cols: number): Layout {
  const l: Layout = { version: 1, xs: even(cols), ys: even(rows), splits: {}, groups: [] }
  l.groups = allAtoms(l).map((a) => ({ atoms: [a], excluded: false }))
  return l
}

/** Make sure every atom belongs to exactly one group. */
export function normalize(l: Layout): Layout {
  const atoms = new Set(allAtoms(l))
  const seen = new Set<string>()
  const groups: Group[] = []
  for (const g of l.groups) {
    const a = g.atoms.filter((x) => atoms.has(x) && !seen.has(x))
    a.forEach((x) => seen.add(x))
    if (a.length) groups.push({ ...g, atoms: a })
  }
  for (const a of atoms) if (!seen.has(a)) groups.push({ atoms: [a], excluded: false })
  return { ...l, groups }
}

/** Atom rectangle in fraction space: [x0, y0, x1, y1]. */
export function atomRect(l: Layout, key: string): [number, number, number, number] {
  const [rs, cs, part] = key.split('-')
  const r = +rs
  const c = +cs
  const X = [0, ...l.xs, 1]
  const Y = [0, ...l.ys, 1]
  let [x0, y0, x1, y1] = [X[c], Y[r], X[c + 1], Y[r + 1]]
  const dir = l.splits[`${r}-${c}`]
  if (part !== undefined && dir) {
    if (dir === 'h') {
      const ym = (y0 + y1) / 2
      ;[y0, y1] = part === '0' ? [y0, ym] : [ym, y1]
    } else {
      const xm = (x0 + x1) / 2
      ;[x0, x1] = part === '0' ? [x0, xm] : [xm, x1]
    }
  }
  return [x0, y0, x1, y1]
}

export function toLonLat(bbox: BBox, x: number, y: number): [number, number] {
  const [w, s, e, n] = bbox
  return [w + x * (e - w), n - y * (n - s)]
}

function rectPolygon(bbox: BBox, r: [number, number, number, number]): Feature<Polygon> {
  const [x0, y0, x1, y1] = r
  const ring = [toLonLat(bbox, x0, y0), toLonLat(bbox, x1, y0), toLonLat(bbox, x1, y1), toLonLat(bbox, x0, y1), toLonLat(bbox, x0, y0)]
  return turf.polygon([ring])
}

function unionAll(fs: Feature<Polygon | MultiPolygon>[]): Feature<Polygon | MultiPolygon> | null {
  if (fs.length === 0) return null
  if (fs.length === 1) return fs[0]
  return turf.union(turf.featureCollection(fs)) as Feature<Polygon | MultiPolygon> | null
}

export function groupShape(l: Layout, bbox: BBox, g: Group): Feature<Polygon | MultiPolygon> | null {
  return unionAll(g.atoms.map((a) => rectPolygon(bbox, atomRect(l, a))))
}

function rowLetter(i: number) {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** Build plot polygons clipped to the boundary, with A1, A2, B1… labels. */
export function computePlots(l: Layout, boundary: Feature<Polygon>): ComputedPlot[] {
  const bbox = turf.bbox(boundary) as BBox
  type Tmp = { gi: number; g: Group; geom: Feature<Polygon | MultiPolygon>; row: number; x: number }
  const tmp: Tmp[] = []
  l.groups.forEach((g, gi) => {
    const shape = groupShape(l, bbox, g)
    if (!shape) return
    const clipped = turf.intersect(turf.featureCollection([shape, boundary])) as Feature<Polygon | MultiPolygon> | null
    if (!clipped || turf.area(clipped) < 1) return
    const row = Math.min(...g.atoms.map((a) => +a.split('-')[0]))
    const x = Math.min(...g.atoms.map((a) => atomRect(l, a)[0]))
    tmp.push({ gi, g, geom: clipped, row, x })
  })
  // Label rows by the order of occupied rows (top → bottom), numbers west → east.
  const rows = [...new Set(tmp.map((t) => t.row))].sort((a, b) => a - b)
  const out: ComputedPlot[] = []
  rows.forEach((row, ri) => {
    tmp
      .filter((t) => t.row === row)
      .sort((a, b) => a.x - b.x)
      .forEach((t, i) => {
        const label = `${rowLetter(ri)}${i + 1}`
        const c = turf.pointOnFeature(t.geom).geometry.coordinates
        out.push({
          groupIndex: t.gi,
          label,
          name: t.g.name || label,
          excluded: t.g.excluded,
          reason: t.g.excluded ? t.g.reason ?? null : null,
          geometry: t.geom.geometry,
          area_m2: turf.area(t.geom),
          center: [c[1], c[0]],
        })
      })
  })
  return out
}

// ---------------- Operations (return new layouts) ----------------

export function setGrid(rows: number, cols: number): Layout {
  return createLayout(Math.max(1, rows), Math.max(1, cols))
}

/** Rows/cols so that each cell is close to `cellDunum`, respecting the bbox aspect ratio. */
export function gridForCellSize(boundary: Feature<Polygon>, cellDunum: number): { rows: number; cols: number } {
  const [w, s, e, n] = turf.bbox(boundary)
  const widthM = turf.distance([w, (s + n) / 2], [e, (s + n) / 2], { units: meters })
  const heightM = turf.distance([w, s], [w, n], { units: meters })
  const cells = Math.max(1, turf.area(boundary) / (cellDunum * DUNUM_M2))
  // cells cover the bbox, so scale by bbox fill ratio
  const fill = turf.area(boundary) / Math.max(1, widthM * heightM)
  const total = cells / Math.max(fill, 0.2)
  const cols = Math.max(1, Math.round(Math.sqrt((total * widthM) / Math.max(heightM, 1))))
  const rows = Math.max(1, Math.round(total / cols))
  return { rows: Math.min(rows, 20), cols: Math.min(cols, 20) }
}
const meters = 'meters' as const

export function moveDivider(l: Layout, axis: 'x' | 'y', index: number, value: number): Layout {
  const arr = [...(axis === 'x' ? l.xs : l.ys)]
  const lo = (index === 0 ? 0 : arr[index - 1]) + MIN_GAP
  const hi = (index === arr.length - 1 ? 1 : arr[index + 1]) - MIN_GAP
  arr[index] = Math.min(hi, Math.max(lo, value))
  return axis === 'x' ? { ...l, xs: arr } : { ...l, ys: arr }
}

export function canSplit(l: Layout, gi: number): boolean {
  const g = l.groups[gi]
  return !!g && g.atoms.length === 1 && g.atoms[0].split('-').length === 2
}

export function splitGroup(l: Layout, gi: number, dir: SplitDir): Layout {
  if (!canSplit(l, gi)) return l
  const key = l.groups[gi].atoms[0]
  const groups = [...l.groups]
  const base = groups[gi]
  groups.splice(gi, 1, { ...base, atoms: [`${key}-0`], name: undefined }, { ...base, atoms: [`${key}-1`], name: undefined })
  return { ...l, splits: { ...l.splits, [key]: dir }, groups }
}

/** True when the union of the selected groups forms one connected polygon. */
export function areAdjacent(l: Layout, indices: number[]): boolean {
  if (indices.length < 2) return false
  const bbox: BBox = [0, 0, 1, 1]
  const shapes = indices.map((i) => groupShape(l, bbox, l.groups[i])).filter(Boolean) as Feature<Polygon | MultiPolygon>[]
  const u = unionAll(shapes)
  return !!u && u.geometry.type === 'Polygon'
}

export function mergeGroups(l: Layout, indices: number[]): Layout {
  if (!areAdjacent(l, indices)) return l
  const sorted = [...indices].sort((a, b) => a - b)
  const merged: Group = { atoms: sorted.flatMap((i) => l.groups[i].atoms), excluded: sorted.every((i) => l.groups[i].excluded) }
  const groups = l.groups.filter((_, i) => !sorted.includes(i))
  groups.splice(sorted[0], 0, merged)
  return { ...l, groups }
}

export function toggleExclude(l: Layout, gi: number, reason: string | null = null): Layout {
  const groups = l.groups.map((g, i) => (i === gi ? { ...g, excluded: !g.excluded, reason: !g.excluded ? reason ?? 'other' : null } : g))
  return { ...l, groups }
}

export function setGroupProps(l: Layout, gi: number, props: Partial<Pick<Group, 'name' | 'reason'>>): Layout {
  return { ...l, groups: l.groups.map((g, i) => (i === gi ? { ...g, ...props } : g)) }
}

export function tooSmall(plots: ComputedPlot[]): string[] {
  return plots.filter((p) => !p.excluded && p.area_m2 < MIN_PLOT_DUNUM * DUNUM_M2).map((p) => p.label)
}

export function isLayout(x: unknown): x is Layout {
  const l = x as Layout
  return !!l && l.version === 1 && Array.isArray(l.xs) && Array.isArray(l.ys) && Array.isArray(l.groups) && typeof l.splits === 'object'
}
