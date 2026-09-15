import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

export const fetchSummary = () => axios.get('/api/v1/portfolio/summary').then(r => r.data)
export const fetchHoldings = () => axios.get('/api/v1/portfolio/holdings').then(r => r.data)
export const fetchTransactions = (symbol) =>
  axios.get('/api/v1/portfolio/transactions', { params: symbol ? { symbol } : {} }).then(r => r.data)

export const useSummary = () => useQuery({ queryKey: ['summary'], queryFn: fetchSummary, refetchInterval: 30000 })
export const useHoldings = () => useQuery({ queryKey: ['holdings'], queryFn: fetchHoldings, refetchInterval: 30000 })
export const useTransactions = (symbol) =>
  useQuery({ queryKey: ['transactions', symbol], queryFn: () => fetchTransactions(symbol) })

export const fetchRisk = () => axios.get('/api/v1/portfolio/risk').then(r => r.data)
export const useRisk = () =>
  useQuery({
    queryKey: ['portfolio-risk'],
    queryFn: fetchRisk,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

export const useAddTransaction = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => axios.post('/api/v1/portfolio/transactions', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holdings'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}
