const AUTH_TOKEN_KEY = "spectre_auth_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function storeToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}
