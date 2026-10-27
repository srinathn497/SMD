import { useQuery } from '@tanstack/react-query'
import { API_ORIGIN } from './apiBase'

const BASE = `${API_ORIGIN}/api/v1`

export const fetchVolumeHistory = (symbol, assetType = 'stock') =>
  fetch(`${BASE}/volume-history/${symbol}?asset_type=${assetType}`)
    .then(r => { if (!r.ok) throw new Error('No data'); return r.json() })

export const fetchVolume24h = (symbol, assetType = 'stock') =>
  fetch(`${BASE}/volume-history/${symbol}/24h?asset_type=${assetType}`)
    .then(r => { if (!r.ok) throw new Error('No data'); return r.json() })

export const fetchVolumeFlow = (symbol, assetType = 'stock') =>
  fetch(`${BASE}/volume-history/${symbol}/flow?asset_type=${assetType}`)
    .then(r => { if (!r.ok) throw new Error('No data'); return r.json() })

// Buying vs selling over the last 5–60 min — backend caches 60 s
export const useVolumeFlow = (symbol, assetType = 'stock') =>
  useQuery({
    queryKey: ['volume-flow', symbol, assetType],
    queryFn: () => fetchVolumeFlow(symbol, assetType),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    enabled: !!symbol,
    retry: 1,
  })

export const useVolume24h = (symbol, assetType = 'stock') =>
  useQuery({
    queryKey: ['volume-24h', symbol, assetType],
    queryFn: () => fetchVolume24h(symbol, assetType),
    staleTime: 5 * 60 * 1000,        // matches the backend cache — the current hour keeps growing
    refetchInterval: 5 * 60 * 1000,
    enabled: !!symbol,
    retry: 1,
  })

export const useVolumeHistory = (symbol, assetType = 'stock') =>
  useQuery({
    queryKey: ['volume-history', symbol, assetType],
    queryFn: () => fetchVolumeHistory(symbol, assetType),
    staleTime: 60 * 60 * 1000,   // 1 hour — daily bars
    enabled: !!symbol,
  })
