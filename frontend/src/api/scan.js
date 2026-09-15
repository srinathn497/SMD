import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

export const fetchScan = (includeCrypto = true, extra = '') =>
  axios.get('/api/v1/scan/all', { params: { include_crypto: includeCrypto, extra } }).then(r => r.data)

export const scanSingle = (symbol, assetType) =>
  axios.post('/api/v1/scan/single', { symbol, asset_type: assetType }).then(r => r.data)

export const useScanAll = (includeCrypto, extra, enabled) =>
  useQuery({
    queryKey: ['scan', includeCrypto, extra],
    queryFn: () => fetchScan(includeCrypto, extra),
    enabled,
    staleTime: 300000,   // 5 min cache — scan is expensive
    gcTime: 600000,
  })

export const useScanSingle = () => useMutation({
  mutationFn: ({ symbol, assetType }) => scanSingle(symbol, assetType),
})
