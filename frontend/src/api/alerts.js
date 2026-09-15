import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

export const fetchAlerts = () => axios.get('/api/v1/alerts').then(r => r.data)
export const fetchWatchlist = () => axios.get('/api/v1/watchlist').then(r => r.data)

export const useAlerts = () => useQuery({ queryKey: ['alerts'], queryFn: fetchAlerts, refetchInterval: 15000 })
export const useWatchlist = () => useQuery({ queryKey: ['watchlist'], queryFn: fetchWatchlist })

export const useCreateAlert = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => axios.post('/api/v1/alerts', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export const useDeleteAlert = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => axios.delete(`/api/v1/alerts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export const useResetAlert = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => axios.patch(`/api/v1/alerts/${id}/reset`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export const useAddToWatchlist = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => axios.post('/api/v1/watchlist', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  })
}

export const useRemoveFromWatchlist = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => axios.delete(`/api/v1/watchlist/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  })
}
