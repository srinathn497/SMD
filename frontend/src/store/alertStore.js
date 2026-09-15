import { create } from 'zustand'

export const useAlertStore = create((set) => ({
  alerts: [],
  triggered: [],

  setAlerts: (alerts) => set({ alerts }),
  addTriggered: (alert) =>
    set((state) => ({ triggered: [alert, ...state.triggered].slice(0, 50) })),
  clearTriggered: () => set({ triggered: [] }),
}))
