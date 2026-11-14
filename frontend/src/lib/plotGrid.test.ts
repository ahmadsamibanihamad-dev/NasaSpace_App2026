import { describe, expect, it } from 'vitest'
import * as turf from '@turf/turf'
import { areAdjacent, computePlots, createLayout, mergeGroups, moveDivider, normalize, splitGroup, toggleExclude, tooSmall } from './plotGrid'

const lat = 32.5568
const lon = 35.8469
const d = 0.00075
const boundary = turf.polygon([[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]])
const total = turf.area(boundary)

describe('plot grid', () => {
  it('creates labelled cells whose areas sum to the farm area', () => {
    const plots = computePlots(createLayout(2, 3), boundary)
    expect(plots.map((p) => p.label)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
    const sum = plots.reduce((s, p) => s + p.area_m2, 0)
    expect(Math.abs(sum - total) / total).toBeLessThan(0.001)
  })

  it('moves dividers within bounds', () => {
    const l = moveDivider(createLayout(1, 2), 'x', 0, 0.99)
    expect(l.xs[0]).toBeCloseTo(0.98)
    const plots = computePlots(l, boundary)
    expect(plots[0].area_m2).toBeGreaterThan(plots[1].area_m2 * 10)
  })

  it('splits and merges', () => {
    let l = createLayout(2, 2)
    l = splitGroup(l, 0, 'v')
    expect(computePlots(l, boundary)).toHaveLength(5)
    // groups: [0-0-0, 0-0-1, 0-1, 1-0, 1-1]; 0-0-0 and 1-1 are not adjacent
    expect(areAdjacent(l, [0, 4])).toBe(false)
    expect(areAdjacent(l, [1, 2])).toBe(true)
    l = mergeGroups(l, [1, 2])
    const plots = computePlots(l, boundary)
    expect(plots).toHaveLength(4)
    expect(Math.abs(plots.reduce((s, p) => s + p.area_m2, 0) - total) / total).toBeLessThan(0.001)
  })

  it('excludes plots and flags too-small plots', () => {
    let l = toggleExclude(createLayout(1, 2), 1, 'house')
    const plots = computePlots(l, boundary)
    expect(plots[1].excluded).toBe(true)
    expect(plots[1].reason).toBe('house')
    l = moveDivider(createLayout(1, 2), 'x', 0, 0.001)
    expect(tooSmall(computePlots(l, boundary)).length).toBe(0) // clamped to MIN_GAP (2%) ≈ 0.47 dunum
    const many = computePlots(createLayout(10, 10), boundary)
    expect(tooSmall(many)).toContain('A1')
  })

  it('normalizes broken layouts', () => {
    const l = normalize({ ...createLayout(1, 2), groups: [] })
    expect(l.groups).toHaveLength(2)
  })

  it('clips cells to a triangular boundary', () => {
    const tri = turf.polygon([[[lon - d, lat - d], [lon + d, lat - d], [lon - d, lat + d], [lon - d, lat - d]]])
    const plots = computePlots(createLayout(2, 2), tri)
    expect(plots.length).toBe(3) // the north-east cell lies outside the triangle (only touches it)
    const sum = plots.reduce((s, p) => s + p.area_m2, 0)
    expect(Math.abs(sum - turf.area(tri)) / turf.area(tri)).toBeLessThan(0.001)
  })
})
