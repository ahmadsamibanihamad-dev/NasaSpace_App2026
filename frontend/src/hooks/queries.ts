import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as repo from '../lib/data/repo'
import type { AnalysisType, CropHistoryItem, Farm, PlotDraft } from '../lib/types'

export type { NewAnalysisInput } from '../lib/data/repo'

export const useFarms = (enabled = true) => useQuery({ queryKey: ['farms'], queryFn: repo.listFarms, enabled })
export const usePlots = (farmId?: string) => useQuery({ queryKey: ['plots', farmId], queryFn: () => repo.listPlots(farmId!), enabled: !!farmId })
export const useHistory = (plotId?: string) => useQuery({ queryKey: ['history', plotId], queryFn: () => repo.getHistory(plotId!), enabled: !!plotId })

export const useLocate = () => useMutation({ mutationFn: ({ lat, lon }: { lat: number; lon: number }) => repo.locate(lat, lon) })

export const useEnvSummary = (farm?: Farm | null) =>
  useQuery({
    queryKey: ['env-summary', farm?.centroid.lat.toFixed(2), farm?.centroid.lon.toFixed(2)],
    queryFn: () => repo.getEnvSummary(farm!.centroid.lat, farm!.centroid.lon),
    enabled: !!farm,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  })

export const useTimeSeries = (farm: Farm | null | undefined, variable: string, resolution: string) =>
  useQuery({
    queryKey: ['ts', farm?.centroid.lat.toFixed(2), farm?.centroid.lon.toFixed(2), variable, resolution],
    queryFn: () => repo.getTimeSeries(farm!.centroid.lat, farm!.centroid.lon, variable, resolution),
    enabled: !!farm,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  })

export const useAnalyses = (farmId?: string, type?: AnalysisType) =>
  useQuery({ queryKey: ['analyses', farmId, type], queryFn: () => repo.listAnalyses(farmId!, type), enabled: !!farmId })

export const useAnalysis = (id?: string | null, poll = false) =>
  useQuery({
    queryKey: ['analysis', id],
    queryFn: () => repo.getAnalysis(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return poll && (s === 'queued' || s === 'running' || !s) ? 800 : false
    },
  })

export function useCreateAnalysis() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: repo.createAnalysis, onSuccess: () => qc.invalidateQueries({ queryKey: ['analyses'] }) })
}

export function useDeleteAnalysis() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: repo.deleteAnalysis, onSuccess: () => qc.invalidateQueries({ queryKey: ['analyses'] }) })
}

export function useCreateFarm() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: repo.createFarm, onSuccess: () => qc.invalidateQueries({ queryKey: ['farms'] }) })
}

export function useUpdateFarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; owner_name?: string; owner_phone?: string }) => repo.updateFarm(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['farms'] }),
  })
}

export function useDeleteFarm() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: repo.deleteFarm, onSuccess: () => qc.invalidateQueries() })
}

function usePlotInvalidate() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['plots'] })
    qc.invalidateQueries({ queryKey: ['farms'] })
  }
}

export function useCreatePlot() {
  const done = usePlotInvalidate()
  return useMutation({ mutationFn: ({ farmId, draft }: { farmId: string; draft: PlotDraft }) => repo.createPlot(farmId, draft), onSuccess: done })
}

export function useUpdatePlot() {
  const done = usePlotInvalidate()
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<PlotDraft> }) => repo.updatePlot(id, patch), onSuccess: done })
}

export function useDeletePlot() {
  const done = usePlotInvalidate()
  return useMutation({ mutationFn: repo.deletePlot, onSuccess: done })
}

export function useSaveHistory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ plotId, items }: { plotId: string; items: CropHistoryItem[] }) => repo.saveHistory(plotId, items),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['history', v.plotId] }),
  })
}
