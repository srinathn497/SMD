import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

const fetchHistory = (symbols, horizon, limit = 100) =>
  axios.get('/api/v1/prediction-history', {
    params: {
      symbols: symbols?.length ? symbols.join(',') : undefined,
      horizon: horizon || undefined,
      limit,
    },
  }).then(r => r.data)

const fetchAccuracy = (symbols, horizon) =>
  axios.get('/api/v1/prediction-history/accuracy', {
    params: {
      symbols: symbols?.length ? symbols.join(',') : undefined,
      horizon: horizon || undefined,
    },
  }).then(r => r.data)

// History for a specific list of symbols (Interests page: per watchlist symbol)
export const usePredictionHistory = (symbols, horizon = null) =>
  useQuery({
    queryKey: ['prediction-history', symbols?.join(',') ?? '', horizon],
    queryFn:  () => fetchHistory(symbols, horizon, 100),
    enabled:  !!(symbols?.length),
    staleTime: 0,
    retry: 1,
  })

// History for all symbols (Recommendations page)
export const useAllPredictionHistory = (horizon = null) =>
  useQuery({
    queryKey: ['prediction-history-all', horizon],
    queryFn:  () => fetchHistory(null, horizon, 200),
    staleTime: 0,
    retry: 1,
  })

// Accuracy summary — pass symbols=[] for aggregate across all
export const usePredictionAccuracy = (symbols, horizon = null) =>
  useQuery({
    queryKey: ['prediction-accuracy', symbols?.join(',') ?? '', horizon],
    queryFn:  () => fetchAccuracy(symbols, horizon),
    staleTime: 0,
    retry: 1,
  })

// ── On-demand resolve ──────────────────────────────────────────────────────

export const useTriggerResolve = () =>
  useMutation({
    mutationFn: () => axios.post('/api/v1/prediction-history/resolve').then(r => r.data),
  })

// ── On-demand populate ──────────────────────────────────────────────────────

const triggerPopulate = (symbols) =>
  axios.post('/api/v1/prediction-history/populate', null, {
    params: { symbols: symbols?.length ? symbols.join(',') : undefined },
  }).then(r => r.data)

const triggerNextDayPopulate = (symbols) =>
  axios.post('/api/v1/prediction-history/populate-next-day', null, {
    params: { symbols: symbols?.length ? symbols.join(',') : undefined },
  }).then(r => r.data)

const fetchPopulateStatus = () =>
  axios.get('/api/v1/prediction-history/populate-status').then(r => r.data)

// Mutation to kick off a populate run for the given symbols (or all defaults if none)
export const useTriggerPopulate = () =>
  useMutation({ mutationFn: triggerPopulate })

// Mutation to log next-day predictions using today's close as base
export const useTriggerNextDayPopulate = () =>
  useMutation({ mutationFn: triggerNextDayPopulate })

// Polls populate status every 3 s while enabled
export const usePopulateStatus = (enabled = false) =>
  useQuery({
    queryKey: ['prediction-populate-status'],
    queryFn:  fetchPopulateStatus,
    enabled,
    refetchInterval: enabled ? 3000 : false,
    staleTime: 0,
    retry: false,
  })
