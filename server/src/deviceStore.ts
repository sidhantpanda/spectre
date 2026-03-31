import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

export interface DeviceRecord {
  id: string;
  deviceKey: string;
  deviceId?: string;
  name?: string;
  enrolledAt: number;
  lastSeen: number;
}

export interface EnrollmentTokenRecord {
  token: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

interface StoreData {
  devices: DeviceRecord[];
  enrollmentTokens: EnrollmentTokenRecord[];
}

let storePath = "";
let data: StoreData = { devices: [], enrollmentTokens: [] };
let initialized = false;

function generateKey(): string {
  return randomBytes(32).toString("hex");
}

function generateToken(): string {
  return randomBytes(16).toString("hex");
}

function persist() {
  if (!storePath) return;
  const tmpPath = storePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, storePath);
}

export function initDeviceStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  storePath = path.join(dataDir, "store.json");

  if (fs.existsSync(storePath)) {
    try {
      data = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    } catch {
      data = { devices: [], enrollmentTokens: [] };
    }
  }
  initialized = true;
}

export function isInitialized() {
  return initialized;
}

export function createEnrollmentToken(expiresInMs = 15 * 60 * 1000): EnrollmentTokenRecord {
  const now = Date.now();
  const record: EnrollmentTokenRecord = {
    token: generateToken(),
    createdAt: now,
    expiresAt: now + expiresInMs,
    used: false,
  };
  data.enrollmentTokens.push(record);
  persist();
  return record;
}

export function validateEnrollmentToken(token: string): EnrollmentTokenRecord | null {
  const record = data.enrollmentTokens.find((t) => t.token === token && !t.used);
  if (!record) return null;
  if (Date.now() > record.expiresAt) return null;
  return record;
}

export function consumeEnrollmentToken(token: string): void {
  const record = data.enrollmentTokens.find((t) => t.token === token);
  if (record) {
    record.used = true;
    persist();
  }
}

export function createDevice(): DeviceRecord {
  const device: DeviceRecord = {
    id: uuid(),
    deviceKey: generateKey(),
    enrolledAt: Date.now(),
    lastSeen: Date.now(),
  };
  data.devices.push(device);
  persist();
  return device;
}

export function findDeviceByKey(key: string): DeviceRecord | null {
  return data.devices.find((d) => d.deviceKey === key) ?? null;
}

export function updateDevice(
  deviceKey: string,
  updates: Partial<Pick<DeviceRecord, "deviceId" | "name" | "lastSeen">>,
): void {
  const device = data.devices.find((d) => d.deviceKey === deviceKey);
  if (device) {
    Object.assign(device, updates);
    persist();
  }
}

export function listDevices(): DeviceRecord[] {
  return [...data.devices];
}

export function listActiveEnrollmentTokens(): EnrollmentTokenRecord[] {
  return data.enrollmentTokens.filter((t) => !t.used && Date.now() < t.expiresAt);
}
