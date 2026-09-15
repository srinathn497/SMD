import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

// ── Leaderboard ────────────────────────────────────────────────────────────────

export const useConvictionLeaderboard = (limit = 10, minScore = 0, direction = 'all', polling = false) =>
  useQuery({
    queryKey: ['conviction-leaderboard', limit, minScore, direction],
    queryFn: () =>
      axios
        .get('/api/v1/conviction/leaderboard', {
          params: { limit, min_score: minScore, direction },
        })
        .then(r => r.data),
    staleTime: polling ? 0 : 5 * 60 * 1000,
    refetchInterval: polling ? 5000 : 10 * 60 * 1000,
    retry: 1,
  })

// ── Scan status ────────────────────────────────────────────────────────────────

export const useConvictionScanStatus = (enabled = false) =>
  useQuery({
    queryKey: ['conviction-scan-status'],
    queryFn: () =>
      axios.get('/api/v1/conviction/scan/status').then(r => r.data),
    refetchInterval: enabled ? 5000 : false,  // poll every 5 s while enabled
    staleTime: 0,
    retry: false,
  })

// ── Trigger scan ───────────────────────────────────────────────────────────────
// Intentionally simple — just fires the POST.
// ConvictionLeaderboard's useConvictionScanStatus(true) already polls every 5 s
// and invalidates the leaderboard when it detects running → done.

export const useTriggerConvictionScan = () =>
  useMutation({
    mutationFn: () => axios.post('/api/v1/conviction/scan').then(r => r.data),
  })

// ── Model refresh ──────────────────────────────────────────────────────────────
// Retrains stale/old-schema ML bundles in the background. Run this after the
// machine has been off for a while, before Scan — otherwise Scan skips the ML
// signal for every stale symbol.

export const useModelRefreshStatus = (enabled = false) =>
  useQuery({
    queryKey: ['model-refresh-status'],
    queryFn: () =>
      axios.get('/api/v1/conviction/refresh-models/status').then(r => r.data),
    refetchInterval: enabled ? 3000 : false,
    staleTime: 0,
    retry: false,
  })

export const useTriggerModelRefresh = () =>
  useMutation({
    mutationFn: (force = false) =>
      axios
        .post('/api/v1/conviction/refresh-models', null, { params: { force } })
        .then(r => r.data),
  })
