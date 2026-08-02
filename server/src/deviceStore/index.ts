// Barrel: re-exports the deviceStore module's public surface exactly as it was
// when this lived in a single deviceStore.ts, so `from "./deviceStore"` keeps
// working for every existing consumer (app.ts, websockets.ts, agentRegistry.ts,
// server.ts, and the tests).
//
// A few helpers (e.g. createDevice, getPublicDevice) had to become
// cross-module exports for the split itself to compile, but were never part of
// deviceStore's public API — they are deliberately left out of this barrel.

export { type DeviceRecord, type PublicDevice, type PublicAuthKey, type PublicPendingDevice, type PollResult } from "./types";

export { initDeviceStore, isInitialized, prune, resetStoreForTest } from "./init";

export { onPendingDevicesChange } from "./internal";

export { computeIdentity } from "./identity";

export * from "./authKeys";

export * from "./pending";

export { findDeviceByKey, touchDevice } from "./credentials";

export * from "./runtime";

export { listAgentRecords, canonicalAgentRecordFor, listDevices, listConnections } from "./reads";

export { recordSessionAccess, lastConnectedAtFor, type SessionAccessKind } from "./accessHistory";

export * from "./mutations";
