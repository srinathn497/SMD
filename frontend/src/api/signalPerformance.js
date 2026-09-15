import { useQuery } from '@tanstack/react-query'

const BASE = 'http://localhost:8000/api/v1'

export const useSignalPerformance = (symbol = null) =>
  useQuery({
    queryKey: ['signal-performance', symbol],
    queryFn: async () => {
      const url = symbol
        ? `${BASE}/signal-intelligence/performance?symbol=${encodeURIComponent(symbol)}`
        : `${BASE}/signal-intelligence/performance`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch signal performance')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

export const useBacktestStatus = () =>
  useQuery({
    queryKey: ['backtest-status'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/signal-intelligence/backtest-status`)
      if (!res.ok) throw new Error('Failed to fetch backtest status')
      return res.json()
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  })
