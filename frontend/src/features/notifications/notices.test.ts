import { describe, expect, it } from 'vitest'
import type { Analysis, Plot } from '../../lib/types'
import { buildNotices } from './notices'

const a = (id: string, analysis_type: Analysis['analysis_type'], status: Analysis['status'], completed_at: string | null): Analysis =>
  ({ id, farm_id: 'f', analysis_type, scope: 'farm', inputs: {}, status, stage: null, stages: [], result: null, error: null, created_at: '2026-11-01T00:00:00Z', completed_at }) as Analysis
const p = (id: string, label: string, risk: Plot['latest_top_risk']): Plot => ({ id, label, latest_top_risk: risk }) as Plot

describe('notifications', () => {
  const analyses = [a('1', 'water', 'completed', '2026-11-10T10:00:00Z'), a('2', 'risk', 'completed', '2026-11-12T10:00:00Z'), a('3', 'rotation', 'failed', '2026-11-11T10:00:00Z'), a('4', 'water', 'running', null)]
  const plots = [p('p1', '1', { type: 'frost', severity: 'high' }), p('p2', '2', { type: 'drought', severity: 'low' }), p('p3', '3', null)]

  it('lists finished analyses and non-low parcel risks, newest first', () => {
    const n = buildNotices(analyses, plots, { risks: true, analyses: true })
    expect(n.map((x) => x.id)).toEqual(['r:p1:frost:high', 'a:2', 'a:3', 'a:1'])
    expect(n[0]).toMatchObject({ kind: 'risk', at: '2026-11-12T10:00:00Z', to: '/app/risks' })
    expect(n[2].kind).toBe('failed')
  })

  it('follows the two switches in Settings', () => {
    expect(buildNotices(analyses, plots, { risks: false, analyses: true }).every((x) => x.kind !== 'risk')).toBe(true)
    expect(buildNotices(analyses, plots, { risks: true, analyses: false }).map((x) => x.id)).toEqual(['r:p1:frost:high'])
    expect(buildNotices(analyses, plots, { risks: false, analyses: false })).toEqual([])
  })

  it('shows at most ten and no risk alert without an analysis behind it', () => {
    const many = Array.from({ length: 15 }, (_, i) => a(`m${i}`, 'water', 'completed', `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`))
    expect(buildNotices(many, plots, { risks: true, analyses: true })).toHaveLength(10)
    expect(buildNotices([], plots, { risks: true, analyses: true })).toEqual([])
  })
})
