import { useQuery } from '@tanstack/react-query'

const BASE = 'http://localhost:8000/api/v1'

export const fetchVolumeHistory = (symbol, assetType = 'stock') =>
  fetch(`${BASE}/volume-history/${symbol}?asset_type=${assetType}`)
    .then(r => { if (!r.ok) throw new Error('No data'); return r.json() })

export const useVolumeHistory = (symbol, assetType = 'stock') =>
  useQuery({
    queryKey: ['volume-history', symbol, assetType],
    queryFn: () => fetchVolumeHistory(symbol, assetType),
    staleTime: 60 * 60 * 1000,   // 1 hour — daily bars
    enabled: !!symbol,
  })
