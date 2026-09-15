import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Market from './pages/Market'
import Portfolio from './pages/Portfolio'
import Alerts from './pages/Alerts'
import Recommendations from './pages/Recommendations'
import TradeIdeas from './pages/TradeIdeas'
import Trades from './pages/Trades'
import Interests from './pages/Interests'
import SmartMoney from './pages/SmartMoney'
import Income from './pages/Income'
import { useMarketStore } from './store/marketStore'
import { useWatchlist } from './api/alerts'
import { useWebSocket } from './store/useWebSocket'
import { useEffect } from 'react'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

function WebSocketProvider() {
  const selectedSymbol = useMarketStore(s => s.selectedSymbol)
  const watchlist = useMarketStore(s => s.watchlist)
  const setWatchlist = useMarketStore(s => s.setWatchlist)
  const { data: wlData } = useWatchlist()

  useEffect(() => {
    if (wlData) setWatchlist(wlData.map(i => i.symbol))
  }, [wlData])

  const symbols = [...new Set([selectedSymbol, ...watchlist].filter(Boolean))]
  useWebSocket(symbols)
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <WebSocketProvider />
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/trade-ideas" element={<TradeIdeas />} />
            <Route path="/recommendations" element={<Recommendations />} />
            <Route path="/market" element={<Market />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/interests" element={<Interests />} />
            <Route path="/smart-money" element={<SmartMoney />} />
            <Route path="/income" element={<Income />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
