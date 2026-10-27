// Single source of truth for where the backend lives.
// Empty string = same-origin relative requests (dev: proxied by vite.config.js;
// prod: set VITE_API_URL / VITE_WS_URL if the frontend isn't served from the
// same origin as the API).
export const API_ORIGIN = import.meta.env.VITE_API_URL || ''
export const WS_ORIGIN = import.meta.env.VITE_WS_URL || ''
