import { useQuery } from '@tanstack/react-query'

const BASE = 'http://localhost:8000/api/v1'

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
