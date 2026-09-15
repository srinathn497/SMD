import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const BASE = 'http://localhost:8000/api/v1/option-trades'

async function fetchOptionTrades() {
  const r = await fetch(BASE)
  if (!r.ok) throw new Error('Failed to fetch option trades')
  return r.json()
}

export function useOptionTrades() {
  return useQuery({
    queryKey: ['option-trades'],
    queryFn: fetchOptionTrades,
    staleTime: 60 * 1000,
  })
}

export function useOpenOptionTrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: data => fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async r => {
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail ?? 'Failed') }
      return r.json()
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['option-trades'] }),
  })
}

export function useCloseOptionTrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, close_price }) => fetch(`${BASE}/${id}/close`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ close_price }),
    }).then(async r => {
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail ?? 'Failed') }
      return r.json()
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['option-trades'] }),
  })
}

export function useDeleteOptionTrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: id => fetch(`${BASE}/${id}`, { method: 'DELETE' }).then(r => {
      if (!r.ok && r.status !== 204) throw new Error('Failed to delete')
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['option-trades'] }),
  })
}
