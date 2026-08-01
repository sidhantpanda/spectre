import { getApiBase } from "../lib/api";
import { authFetch } from "../lib/auth";

const API_BASE = getApiBase();

export type AuthKey = {
  id: string;
  /** Leading characters of the key, for identifying it after creation. */
  hint: string;
  description?: string;
  reusable: boolean;
  createdAt: number;
  expiresAt: number;
  uses: number;
  revoked: boolean;
};

/** Only ever returned once, at creation. */
export type CreatedAuthKey = AuthKey & { key: string };

export type PendingDevice = {
  id: string;
  userCode: string;
  hostname?: string;
  createdAt: number;
  expiresAt: number;
};

export type Device = {
  id: string;
  deviceId?: string;
  name?: string;
  enrolledAt: number;
  lastSeen: number;
  revoked: boolean;
};

async function expectOk(res: Response, action: string) {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `failed to ${action}`);
  }
  return res;
}

export async function createAuthKey(options: {
  reusable?: boolean;
  description?: string;
  expiresInMs?: number;
}): Promise<CreatedAuthKey> {
  const res = await authFetch(`${API_BASE}/authkeys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  await expectOk(res, "create auth key");
  return res.json();
}

export async function listAuthKeys(): Promise<AuthKey[]> {
  const res = await authFetch(`${API_BASE}/authkeys`);
  await expectOk(res, "list auth keys");
  return res.json();
}

export async function revokeAuthKey(id: string): Promise<void> {
  await expectOk(await authFetch(`${API_BASE}/authkeys/${id}`, { method: "DELETE" }), "revoke auth key");
}

export async function listPendingDevices(): Promise<PendingDevice[]> {
  const res = await authFetch(`${API_BASE}/devices/pending`);
  await expectOk(res, "list pending devices");
  return res.json();
}

export async function approveDevice(userCode: string, name?: string): Promise<Device> {
  const res = await authFetch(`${API_BASE}/devices/pending/${encodeURIComponent(userCode)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await expectOk(res, "approve device");
  return res.json();
}

export async function denyDevice(userCode: string): Promise<void> {
  await expectOk(
    await authFetch(`${API_BASE}/devices/pending/${encodeURIComponent(userCode)}/deny`, { method: "POST" }),
    "deny device",
  );
}

export async function listDevices(): Promise<Device[]> {
  const res = await authFetch(`${API_BASE}/devices`);
  await expectOk(res, "list devices");
  return res.json();
}

export async function revokeDevice(id: string): Promise<void> {
  await expectOk(await authFetch(`${API_BASE}/devices/${id}`, { method: "DELETE" }), "revoke device");
}

/**
 * The address an agent should dial, as reported by the server.
 *
 * The browser's own origin is the wrong thing to show here: in development it's
 * the Vite dev port, and it's always "localhost" for whoever loaded the page,
 * which no other machine can reach. The server knows its real LAN address (or
 * the operator-configured public host), so we ask it.
 */
export async function fetchConnectHost(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/connect-info`);
    if (res.ok) {
      const { host } = (await res.json()) as { host?: string };
      if (host) return host;
    }
  } catch {
    // Fall through to the browser origin.
  }
  return API_BASE.replace(/^http/, "ws");
}

const INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh";

/**
 * The command an operator pastes on the machine they want to add.
 *
 * It installs the agent and enrols it in one line, because the machine being
 * added usually has no agent on it yet — a command that assumed one was already
 * installed only worked on the second machine onwards.
 *
 * The key travels in the environment rather than as `--authkey`, so it stays
 * out of `ps` on the target while the install runs.
 */
export function enrollCommand(authKey: string, host: string): string {
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | sudo SPECTRE_AUTHKEY=${authKey} bash -s -- --host ${host}`;
}

/** The same enrolment for a machine that already has the agent installed. */
export function enrollExistingCommand(authKey: string, host: string): string {
  return `sudo SPECTRE_AUTHKEY=${authKey} spectre-agent up --host ${host}`;
}
