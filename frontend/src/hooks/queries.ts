import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Analysis,
  AnalysisType,
  Crop,
  CropHistoryItem,
  EnvSummary,
  Farm,
  LocateResponse,
  Plot,
  PlotDetailsInput,
  PlotInput,
  TimeSeries,
} from '../lib/types'
import type { Polygon } from 'geojson'

export const useFarms = (enabled = true) => useQuery({ queryKey: ['farms'], queryFn: () => api<Farm[]>('/farms'), enabled })
export const useFarm = (id?: string) => useQuery({ queryKey: ['farm', id], queryFn: () => api<Farm>(`/farms/${id}`), enabled: !!id })
export const usePlots = (farmId?: string) => useQuery({ queryKey: ['plots', farmId], queryFn: () => api<Plot[]>(`/farms/${farmId}/plots`), enabled: !!farmId })
export const useCrops = () => useQuery({ queryKey: ['crops'], queryFn: () => api<Crop[]>('/crops'), staleTime: Infinity })
export const useCrop = (id?: string | null) => useQuery({ queryKey: ['crop', id], queryFn: () => api<Crop>(`/crops/${id}`), enabled: !!id, staleTime: Infinity })
export const useHistory = (plotId?: string) =>
  useQuery({ queryKey: ['history', plotId], queryFn: () => api<CropHistoryItem[]>(`/plots/${plotId}/history`), enabled: !!plotId })

export const useLocate = () => useMutation({ mutationFn: ({ lat, lon }: { lat: number; lon: number }) => api<LocateResponse>(`/geo/locate?lat=${lat}&lon=${lon}`) })

export const useEnvSummary = (farm?: Farm | null) =>
  useQuery({
    queryKey: ['env-summary', farm?.id],
    queryFn: () => api<EnvSummary>(`/environment/summary?lat=${farm!.centroid.lat}&lon=${farm!.centroid.lon}`),
    enabled: !!farm,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })

export const useTimeSeries = (farm: Farm | null | undefined, variable: string, resolution: string) =>
  useQuery({
    queryKey: ['ts', farm?.id, variable, resolution],
    queryFn: () => api<TimeSeries>(`/environment/timeseries?lat=${farm!.centroid.lat}&lon=${farm!.centroid.lon}&variable=${variable}&resolution=${resolution}`),
    enabled: !!farm,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })

export const useAnalyses = (farmId?: string, type?: AnalysisType) =>
  useQuery({
    queryKey: ['analyses', farmId, type],
    queryFn: () => api<Analysis[]>(`/analyses?${new URLSearchParams({ ...(farmId ? { farm_id: farmId } : {}), ...(type ? { analysis_type: type } : {}) })}`),
    enabled: !!farmId,
  })

export const useAnalysis = (id?: string, poll = false) =>
  useQuery({
    queryKey: ['analysis', id],
    queryFn: () => api<Analysis>(`/analyses/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return poll && (s === 'queued' || s === 'running' || !s) ? 1000 : false
    },
  })

export interface NewAnalysisInput {
  analysis_type: AnalysisType
  farm_id: string
  plot_ids: string[] | null
  crop_id?: string | null
  planting_date?: string | null
  priority?: string | null
}

export function useCreateAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NewAnalysisInput) => api<{ analysis_id: string; status: string }>('/analyses', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analyses'] }),
  })
}

export function useCreateFarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; boundary: Polygon }) => api<Farm>('/farms', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['farms'] }),
  })
}

export function useUpdateFarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; boundary?: Polygon }) => api<Farm>(`/farms/${id}`, { method: 'PATCH', body }),
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: ['farms'] })
      qc.invalidateQueries({ queryKey: ['farm', f.id] })
    },
  })
}

export function useDeleteFarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/farms/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['farms'] }),
  })
}

export function useReplacePlots() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ farmId, plots }: { farmId: string; plots: PlotInput[] }) => api<Plot[]>(`/farms/${farmId}/plots`, { method: 'PUT', body: { plots } }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['plots', v.farmId] })
      qc.invalidateQueries({ queryKey: ['farms'] })
    },
  })
}

export function useUpdatePlotDetails() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ farmId, items }: { farmId: string; items: PlotDetailsInput[] }) =>
      api<Plot[]>(`/farms/${farmId}/plots/details`, { method: 'PATCH', body: { items } }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['plots', v.farmId] }),
  })
}

export function useSaveHistory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ plotId, items }: { plotId: string; items: CropHistoryItem[] }) =>
      api<CropHistoryItem[]>(`/plots/${plotId}/history`, { method: 'PUT', body: { items } }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['history', v.plotId] }),
  })
}
