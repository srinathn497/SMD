import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

export const fetchTradeIdeas = () =>
  axios.get('/api/v1/trade-ideas').then(r => r.data)

export const fetchScanStatus = () =>
  axios.get('/api/v1/trade-ideas/generate/status').then(r => r.data)

export const useTradeIdeas = (pollWhileScanning = false) =>
  useQuery({
    queryKey: ['trade-ideas'],
    queryFn: fetchTradeIdeas,
    staleTime: pollWhileScanning ? 0 : 30 * 60 * 1000,
    refetchInterval: pollWhileScanning ? 5000 : false,
    retry: 1,
  })

export const useScanStatus = (enabled = false) =>
  useQuery({
    queryKey: ['trade-ideas-scan-status'],
    queryFn: fetchScanStatus,
    refetchInterval: enabled ? 3000 : false,
    enabled,
  })

export const useGenerateTradeIdeas = () => {
  return useMutation({
    // POST returns immediately with { status: "scanning" } — no longer blocks
    mutationFn: () => axios.post('/api/v1/trade-ideas/generate').then(r => r.data),
  })
}
