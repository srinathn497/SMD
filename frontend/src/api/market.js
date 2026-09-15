import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export const fetchQuote = (symbol, assetType) =>
  axios.get(`/api/v1/market/quote`, { params: { symbol, asset_type: assetType } }).then(r => r.data)

export const fetchHistory = (symbol, assetType, interval = '1d') =>
  axios.get(`/api/v1/market/history`, { params: { symbol, asset_type: assetType, interval } }).then(r => r.data)

export const searchSymbols = (q) =>
  axios.get(`/api/v1/market/search`, { params: { q } }).then(r => r.data)

export const useQuote = (symbol, assetType) =>
  useQuery({
    queryKey: ['quote', symbol, assetType],
    queryFn: () => fetchQuote(symbol, assetType),
    refetchInterval: 15000,
    enabled: !!symbol,
  })

export const useHistory = (symbol, assetType, interval) =>
  useQuery({
    queryKey: ['history', symbol, assetType, interval],
    queryFn: () => fetchHistory(symbol, assetType, interval),
    enabled: !!symbol,
    staleTime: 60000,
  })

export const useSearchSymbols = (query) =>
  useQuery({
    queryKey: ['search', query],
    queryFn: () => searchSymbols(query),
    enabled: query.length >= 1,
    staleTime: 60000,
    placeholderData: (prev) => prev,
  })

export const useVixRegime = () =>
  useQuery({
    queryKey: ['vix-regime'],
    queryFn: () => axios.get('/api/v1/market/vix').then(r => r.data),
    staleTime: 5 * 60 * 1000,      // re-check every 5 min
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  })
