export const API_BASE = "/api";

export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, { ...init, credentials: "include" });
}
