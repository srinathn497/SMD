import { useQuery } from '@tanstack/react-query'
import { API_ORIGIN } from './apiBase'

const BASE = `${API_ORIGIN}/api/v1`

export const fetchSmartMoney = (symbols, includeCrypto = false) =>
  fetch(`${BASE}/smart-money?symbols=${encodeURIComponent(symbols)}&include_crypto=${includeCrypto}`)
    .then(r => { if (!r.ok) throw new Error('Smart money scan failed'); return r.json() })

export const useSmartMoney = (symbols = '', includeCrypto = false) =>
  useQuery({
    queryKey: ['smart-money', symbols, includeCrypto],
    queryFn: () => fetchSmartMoney(symbols, includeCrypto),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  })
