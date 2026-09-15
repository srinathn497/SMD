import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

// ── Fetchers ──────────────────────────────────────────────────────────────────
const fetchTrades = () => axios.get('/api/v1/trades').then(r => r.data)
const fetchStats  = () => axios.get('/api/v1/trades/stats').then(r => r.data)
const postTrade   = (data) =>
  axios.post('/api/v1/trades', data)
    .then(r => r.data)
    .catch(err => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Unknown error'
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    })
const closeTrade  = (id, close_price) =>
  axios.post(`/api/v1/trades/${id}/close`, { close_price: close_price ?? null }).then(r => r.data)
const deleteTrade = (id) => axios.delete(`/api/v1/trades/${id}`)

// ── Queries ───────────────────────────────────────────────────────────────────
export const useTrades = () =>
  useQuery({
    queryKey: ['trades'],
    queryFn: fetchTrades,
    refetchInterval: 60000,  // refresh every 60s
  })

export const useTradeStats = () =>
  useQuery({
    queryKey: ['trades', 'stats'],
    queryFn: fetchStats,
    refetchInterval: 60000,
  })

// ── Mutations ─────────────────────────────────────────────────────────────────
export const useOpenTrade = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => postTrade(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trades'] }),
  })
}

export const useCloseTrade = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, close_price }) => closeTrade(id, close_price),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trades'] }),
  })
}

export const useDeleteTrade = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => deleteTrade(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trades'] }),
  })
}
