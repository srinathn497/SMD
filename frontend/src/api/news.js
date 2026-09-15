import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export const fetchNews = (symbol, assetType) =>
  axios.get(`/api/v1/news/${symbol}?asset_type=${assetType}`).then(r => r.data)

export function useNews(symbol, assetType) {
  return useQuery({
    queryKey: ['news', symbol],
    queryFn: () => fetchNews(symbol, assetType || 'stock'),
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,   // 5 min — RSS doesn't update that often
    gcTime: 10 * 60 * 1000,
  })
}
