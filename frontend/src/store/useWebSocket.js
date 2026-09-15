import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMarketStore } from './marketStore'
import { useAlertStore } from './alertStore'
import toast from 'react-hot-toast'

export function useWebSocket(symbols = []) {
  const updateLivePrice = useMarketStore(s => s.updateLivePrice)
  const addTriggered = useAlertStore(s => s.addTriggered)
  const queryClient = useQueryClient()
  const wsRef = useRef(null)

  useEffect(() => {
    if (!symbols.length) return
    const symStr = symbols.join(',')
    const url = `ws://localhost:8000/ws/prices?symbols=${encodeURIComponent(symStr)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'price_update') {
          updateLivePrice(msg.symbol, { price: msg.price, change: msg.change, change_pct: msg.change_pct })
        } else if (msg.type === 'alert_triggered') {
          addTriggered(msg)
          toast(`🔔 ${msg.symbol}: ${msg.condition} @ $${msg.price}`, {
            duration: 6000,
            style: { background: '#92400e', color: '#fef3c7', border: '1px solid #f59e0b' },
          })
        } else if (msg.type === 'trade_closed') {
          const isWin = msg.status === 'HIT_TP'
          const sign = msg.pnl >= 0 ? '+' : ''
          toast(
            `${isWin ? '🎯' : '🛑'} ${msg.symbol} ${msg.status}: ${sign}$${msg.pnl?.toFixed(2)} (${sign}${msg.pnl_pct?.toFixed(1)}%)`,
            {
              duration: 8000,
              style: isWin
                ? { background: '#065f46', color: '#d1fae5', border: '1px solid #34d399' }
                : { background: '#7f1d1d', color: '#fee2e2', border: '1px solid #f87171' },
            }
          )
          queryClient.invalidateQueries({ queryKey: ['trades'] })
        }
      } catch {}
    }

    ws.onerror = () => console.warn('WebSocket error — retrying on next render')

    return () => ws.close()
  }, [symbols.join(',')])
}
