import { describe, expect, it } from 'vitest'
import { areaM2, governorateFor, insideJordan, overlappingParcel, parseCoordinates, parseLatLonQuery, perimeterM, toPolygon, validateRing } from './geometry'

describe('parcel geometry', () => {
  const sq = [[32.5568, 35.8469], [32.5568, 35.8479], [32.5578, 35.8479], [32.5578, 35.8469]] as [number, number][]
  it('computes area and perimeter', () => {
    const poly = toPolygon(sq)!
    // 0.001° lat ≈ 111.2 m, 0.001° lon ≈ 93.8 m at this latitude
    expect(areaM2(poly)).toBeGreaterThan(10000)
    expect(areaM2(poly)).toBeLessThan(10900)
    expect(perimeterM(poly)).toBeGreaterThan(400)
    expect(perimeterM(poly)).toBeLessThan(420)
  })
  it('validates rings', () => {
    expect(validateRing(sq)).toEqual([])
    expect(validateRing(sq.slice(0, 2))).toEqual(['too_few_points'])
    expect(validateRing([sq[0], sq[2], sq[1], sq[3]])).toContain('self_intersecting')
    expect(validateRing([[33.51, 36.29], [33.52, 36.29], [33.52, 36.3]])).toContain('outside_jordan')
    expect(validateRing([[95, 36], [32, 36], [32, 37]])).toEqual(['out_of_range'])
  })
  it('parses typed coordinates, including Arabic digits', () => {
    const r = parseCoordinates('32.5568, 35.8469\n٣٢٫٥٥٧ ، ٣٥٫٨٤٨\nabc\n95, 10')
    expect(r.points).toHaveLength(2)
    expect(r.points[1][0]).toBeCloseTo(32.557)
    expect(r.errors).toEqual([{ line: 3, reason: 'format' }, { line: 4, reason: 'range' }])
    expect(parseLatLonQuery('32.55, 35.84')).toEqual({ lat: 32.55, lon: 35.84 })
    expect(parseLatLonQuery('إربد')).toBeNull()
  })
  it('resolves governorates locally and rejects points outside Jordan', () => {
    expect(governorateFor(32.5568, 35.8469)?.id).toBe('ir')
    expect(governorateFor(31.95, 35.93)?.id).toBe('am')
    expect(insideJordan(33.51, 36.29)).toBe(false)
    expect(governorateFor(24.71, 46.67)).toBeNull()
  })
})

describe('parcel overlap', () => {
  const sq = (lon: number, d = 0.0005) => toPolygon([[32.5563, lon - d], [32.5563, lon + d], [32.5573, lon + d], [32.5573, lon - d]])!
  const others = [{ id: 'a', label: '7', polygon: sq(35.85) }]

  it('names the parcel a boundary overlaps and tolerates borders and slivers', () => {
    expect(overlappingParcel(sq(35.8505), others)).toBe('7') // half of it
    expect(overlappingParcel(sq(35.851), others)).toBeNull() // shared border
    expect(overlappingParcel(sq(35.85099), others)).toBeNull() // 1 % sliver, under the tolerance
    expect(overlappingParcel(sq(35.86), others)).toBeNull() // apart
    expect(overlappingParcel(sq(35.85, 0.0001), others)).toBe('7') // a small parcel inside a larger one
  })

  it('does not compare a parcel with itself', () => {
    expect(overlappingParcel(sq(35.85), others, 'a')).toBeNull()
  })
})
