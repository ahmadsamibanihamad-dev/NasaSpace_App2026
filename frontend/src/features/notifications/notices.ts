// The notices of a farm, built from finished analyses and each parcel's top risk. Pure: no React, no storage.
import type { Analysis, Plot } from '../../lib/types'

const MAX_ITEMS = 10

export interface Notice {
  id: string
  kind: 'analysis' | 'failed' | 'risk'
  at: string
  to: string
  analysisType?: Analysis['analysis_type']
  plot?: Plot
}

/** Pure: the notices of a farm, newest first. Exported for tests. */
export function buildNotices(analyses: Analysis[], plots: Plot[], show: { risks: boolean; analyses: boolean }): Notice[] {
  const out: Notice[] = []
  const done = analyses.filter((a) => a.status === 'completed' || a.status === 'failed')
  if (show.analyses)
    for (const a of done)
      out.push({ id: `a:${a.id}`, kind: a.status === 'failed' ? 'failed' : 'analysis', at: a.completed_at ?? a.created_at, to: `/app/analysis/${a.id}`, analysisType: a.analysis_type })
  if (show.risks) {
    // A parcel's top risk comes from its latest suitability or risk analysis; that analysis dates the alert.
    const source = done.filter((a) => a.status === 'completed' && (a.analysis_type === 'risk' || a.analysis_type === 'crop_suitability')).map((a) => a.completed_at ?? a.created_at).sort().pop()
    if (source)
      for (const p of plots)
        if (p.latest_top_risk && p.latest_top_risk.severity !== 'low')
          out.push({ id: `r:${p.id}:${p.latest_top_risk.type}:${p.latest_top_risk.severity}`, kind: 'risk', at: source, to: '/app/risks', plot: p })
  }
  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.kind === 'risk' ? -1 : 1)).slice(0, MAX_ITEMS)
}
