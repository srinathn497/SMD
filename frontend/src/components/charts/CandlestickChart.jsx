import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries } from 'lightweight-charts'
import { useHistory } from '../../api/market'

export default function CandlestickChart({ symbol, assetType, interval = '1d', height = 340 }) {
  const containerRef = useRef(null)
  const chartRef     = useRef(null)
  const seriesRef    = useRef(null)
  const { data, isPending } = useHistory(symbol, assetType, interval)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#111826' },
        textColor: '#8896ac',
        fontFamily: "'Space Grotesk', sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(28,36,54,0.7)' },
        horzLines: { color: 'rgba(28,36,54,0.7)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#1c2436' },
      timeScale: { borderColor: '#1c2436', timeVisible: true, secondsVisible: false },
      height,
      autoSize: true,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor:        '#35d07f',
      downColor:      '#ef6a6a',
      borderUpColor:  '#35d07f',
      borderDownColor:'#ef6a6a',
      wickUpColor:    '#35d07f',
      wickDownColor:  '#ef6a6a',
    })

    chartRef.current  = chart
    seriesRef.current = series

    return () => { chart.remove() }
  }, [height])

  useEffect(() => {
    if (!data?.bars?.length || !seriesRef.current) return
    const candles = data.bars
      .map(b => ({
        time:  Math.floor(b.timestamp / 1000),
        open:  b.open,
        high:  b.high,
        low:   b.low,
        close: b.close,
      }))
      .sort((a, b) => a.time - b.time)
    seriesRef.current.setData(candles)
    chartRef.current?.timeScale().fitContent()
  }, [data])

  return (
    <div className="relative">
      {isPending && (
        <div className="absolute top-2 right-3 z-10 text-xs text-slate-500 animate-pulse">
          Loading…
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  )
}
