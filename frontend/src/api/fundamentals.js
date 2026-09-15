import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export const fetchFundamentals = (symbol, currentPrice) =>
  axios.get(`/api/v1/fundamentals/${symbol}`, {
    params: currentPrice ? { current_price: currentPrice } : {},
  }).then(r => r.data)

export const useFundamentals = (symbol, assetType, currentPrice) =>
  useQuery({
    queryKey: ['fundamentals', symbol],
    queryFn:  () => fetchFundamentals(symbol, currentPrice),
    enabled:  !!symbol && assetType !== 'crypto',
    staleTime: 6 * 60 * 60 * 1000,   // 6 hours — matches backend cache
    retry: 1,
  })
