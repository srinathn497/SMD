import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

// Returns refetch interval in ms if US market is open (Mon–Fri 9:30–16:00 ET), else false
function marketRefetch(intervalMs) {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const etHour = (now.getUTCHours() - 4 + 24) % 24   // approx EDT (UTC-4)
  const mins = etHour * 60 + now.getUTCMinutes()
  return (mins >= 570 && mins < 960) ? intervalMs : false  // 9:30–16:00
}

export const fetchSignals = (symbol, assetType) =>
  axios.get(`/api/v1/signals/${symbol}`, { params: { asset_type: assetType } }).then(r => r.data)

export const fetchPrediction = (symbol, assetType, trainingPeriod = '3y', horizon = '1d') =>
  axios.get(`/api/v1/signals/predict/${symbol}`, {
    params: { asset_type: assetType, training_period: trainingPeriod, horizon },
  }).then(r => r.data)

export const useSignals = (symbol, assetType) =>
  useQuery({
    queryKey: ['signals', symbol, assetType],
    queryFn: () => fetchSignals(symbol, assetType),
    enabled: !!symbol,
    staleTime: 60000,
  })

export const usePrediction = (symbol, assetType, trainingPeriod = '3y', horizon = '1d') =>
  useQuery({
    queryKey: ['prediction', symbol, assetType, trainingPeriod, horizon],
    queryFn: () => fetchPrediction(symbol, assetType, trainingPeriod, horizon),
    enabled: !!symbol,
    staleTime: 60000,   // 1 min — fresh enough without hammering backend
  })

export const useIntradayContext = (symbol, assetType, dailyDirection = 'UNKNOWN', dailyConfidence = 0) =>
  useQuery({
    queryKey: ['intraday', symbol, assetType, dailyDirection],
    queryFn: () =>
      axios
        .get(`/api/v1/signals/intraday/${symbol}`, {
          params: {
            asset_type: assetType,
            daily_direction: dailyDirection,
            daily_confidence: dailyConfidence,
          },
        })
        .then(r => r.data),
    enabled: !!symbol,
    staleTime: 2 * 60 * 1000,
    refetchInterval: () => marketRefetch(5 * 60 * 1000),   // every 5 min during market hours
    retry: 1,
  })

export const useIntradayPrediction = (symbol, assetType) =>
  useQuery({
    queryKey: ['intraday-predict', symbol, assetType],
    queryFn: () =>
      axios
        .get(`/api/v1/signals/intraday-predict/${symbol}`, {
          params: { asset_type: assetType },
        })
        .then(r => r.data),
    enabled: !!symbol,
    staleTime: 30 * 60 * 1000,
    refetchInterval: () => marketRefetch(15 * 60 * 1000),  // every 15 min during market hours
    retry: 1,
  })

export const useConviction = (symbol, assetType) =>
  useQuery({
    queryKey: ['conviction', symbol, assetType],
    queryFn: () =>
      axios
        .get(`/api/v1/signals/conviction/${symbol}`, {
          params: { asset_type: assetType },
        })
        .then(r => r.data),
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,   // 5 min — aggregates multiple models, no need to refetch constantly
    retry: 1,
  })

export const useOptionsFlow = (symbol, assetType) =>
  useQuery({
    queryKey: ['options-flow', symbol, assetType],
    queryFn: () =>
      axios
        .get(`/api/v1/signals/options/${symbol}`, {
          params: { asset_type: assetType },
        })
        .then(r => r.data),
    enabled: !!symbol && assetType !== 'crypto',
    staleTime: 30 * 60 * 1000,  // 30 min — options data doesn't change frequently
    retry: 1,
  })

export const useClearPredictionCache = (symbol, assetType, trainingPeriod) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      axios.delete(`/api/v1/signals/predict/${symbol}/cache`).then(r => r.data),
    onSuccess: () => {
      // Force a fresh fetch — backend will retrain from scratch
      qc.invalidateQueries({ queryKey: ['prediction', symbol, assetType, trainingPeriod] })
    },
  })
}
