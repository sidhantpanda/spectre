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

/** The command an operator pastes on the machine they want to add. */
export function enrollCommand(authKey: string): string {
  const host = API_BASE.replace(/^http/, "ws");
  return `sudo spectre-agent up --host ${host} --authkey ${authKey}`;
}
