import { useQuery } from '@tanstack/react-query'

const BASE = 'http://localhost:8000/api/v1'

// ── Buy Options ───────────────────────────────────────────────────────────────

export const fetchOptionsScan = (params = {}) => {
  const { minDte = 25, maxDte = 60, minDelta = 0.35, maxDelta = 0.65, convictionFilter = 'all' } = params
  const url = `${BASE}/income/options-scan?min_dte=${minDte}&max_dte=${maxDte}&min_delta=${minDelta}&max_delta=${maxDelta}&conviction_filter=${convictionFilter}`
  return fetch(url).then(r => {
    if (!r.ok) throw new Error('Options scan failed')
    return r.json()
  })
}

export const useOptionsScan = (params = {}) =>
  useQuery({
    queryKey: ['options-scan', params],
    queryFn: () => fetchOptionsScan(params),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 3000,
  })

// ── Stock Analyzer (manual input) ────────────────────────────────────────────

export const useStockPlaybook = (symbol) =>
  useQuery({
    queryKey: ['stock-playbook', symbol],
    queryFn: () =>
      fetch(`${BASE}/income/analyze?symbol=${encodeURIComponent(symbol)}&asset_type=stock`)
        .then(async r => {
          if (!r.ok) { const e = await r.json(); throw new Error(e.detail ?? 'Analysis failed') }
          return r.json()
        }),
    enabled: false,   // only runs when refetch() is called
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

// ── Opportunity Scanner ───────────────────────────────────────────────────────

export const useOpportunities = () =>
  useQuery({
    queryKey: ['opportunities'],
    queryFn: () =>
      fetch(`${BASE}/income/opportunities`).then(r => {
        if (!r.ok) throw new Error('Opportunity scan failed')
        return r.json()
      }),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })

// ── Covered Calls ─────────────────────────────────────────────────────────────

export const useCoveredCalls = () =>
  useQuery({
    queryKey: ['covered-calls'],
    queryFn: () =>
      fetch(`${BASE}/income/covered-calls`).then(r => {
        if (!r.ok) throw new Error('Covered calls scan failed')
        return r.json()
      }),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 3000,
  })

// ── Cash-Secured Puts ─────────────────────────────────────────────────────────

export const useCashSecuredPuts = () =>
  useQuery({
    queryKey: ['cash-secured-puts'],
    queryFn: () =>
      fetch(`${BASE}/income/cash-secured-puts`).then(r => {
        if (!r.ok) throw new Error('CSP scan failed')
        return r.json()
      }),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 3000,
  })

// ── IV Environment ────────────────────────────────────────────────────────────

export const useIVEnvironment = () =>
  useQuery({
    queryKey: ['iv-environment'],
    queryFn: () =>
      fetch(`${BASE}/income/iv-environment`).then(r => {
        if (!r.ok) throw new Error('IV environment scan failed')
        return r.json()
      }),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 3000,
  })
