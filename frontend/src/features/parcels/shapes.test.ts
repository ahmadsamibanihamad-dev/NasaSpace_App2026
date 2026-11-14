import { describe, expect, it } from 'vitest'
import * as turf from '@turf/turf'
import { areaM2, perimeterM, toPolygon, validateRing } from '../../lib/geometry'
import { centerOf, rectangleFrom, rotatePoints } from './shapeMath'

const a = { lat: 32.5568, lng: 35.8469 }
const side = (p: [number, number], q: [number, number]) => turf.distance([p[1], p[0]], [q[1], q[0]], { units: 'meters' })

describe('drag-to-draw shapes', () => {
  it('builds a rectangle between the press and release points', () => {
    const pts = rectangleFrom(a, { lat: 32.5578, lng: 35.8489 }, false)
    expect(pts).toHaveLength(4)
    expect(validateRing(pts)).toEqual([])
    expect(side(pts[0], pts[1])).toBeCloseTo(187.5, -1) // 0.002° of longitude at this latitude
    expect(side(pts[1], pts[2])).toBeCloseTo(111.2, -1) // 0.001° of latitude
  })
  it('builds a true square in metres, in the direction of the drag', () => {
    const pts = rectangleFrom(a, { lat: 32.5560, lng: 35.8489 }, true) // dragged down and to the right
    const w = side(pts[0], pts[1])
    const h = side(pts[1], pts[2])
    expect(Math.abs(w - h)).toBeLessThan(0.5)
    expect(pts[2][0]).toBeLessThan(a.lat)
    expect(pts[2][1]).toBeGreaterThan(a.lng)
    expect(validateRing(pts)).toEqual([])
  })
})

describe('rotate / move', () => {
  const rect = rectangleFrom(a, { lat: 32.5578, lng: 35.8489 }, false)
  it('rotation keeps area and perimeter', () => {
    const r = rotatePoints(rect, centerOf(rect), Math.PI / 5)
    expect(areaM2(toPolygon(r))).toBeCloseTo(areaM2(toPolygon(rect)), -1)
    expect(perimeterM(toPolygon(r))).toBeCloseTo(perimeterM(toPolygon(rect)), 0)
    expect(centerOf(r)[0]).toBeCloseTo(centerOf(rect)[0], 6)
  })
  it('a quarter turn swaps width and height, clockwise', () => {
    const c = centerOf(rect)
    const r = rotatePoints(rect, c, Math.PI / 2)
    expect(side(r[0], r[1])).toBeCloseTo(side(rect[0], rect[1]), 0)
    // the edge that ran east–west now runs north–south
    expect(Math.abs(r[0][1] - r[1][1])).toBeLessThan(1e-6)
    // a point due north of the centre ends up due east
    const [n] = rotatePoints([[c[0] + 0.001, c[1]]], c, Math.PI / 2)
    expect(n[1]).toBeGreaterThan(c[1])
    expect(n[0]).toBeCloseTo(c[0], 6)
  })
})
