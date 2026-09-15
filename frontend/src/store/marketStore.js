import { create } from 'zustand'

export const useMarketStore = create((set) => ({
  selectedSymbol: 'AAPL',
  selectedAssetType: 'stock',
  livePrices: {},          // { 'AAPL': { price, change, change_pct } }
  watchlist: [],

  setSymbol: (symbol, assetType = 'stock') =>
    set({ selectedSymbol: symbol, selectedAssetType: assetType }),

  updateLivePrice: (symbol, data) =>
    set((state) => ({
      livePrices: { ...state.livePrices, [symbol]: data },
    })),

  setWatchlist: (items) => set({ watchlist: items }),
}))
