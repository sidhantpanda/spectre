import { createServer } from "http";
import { type AddressInfo } from "net";
import { startStaleAgentSweep } from "./agentRegistry";
import { createApp } from "./app";
import { AUTH_TOKEN, DATA_DIR, PORT } from "./config";
import { initDeviceStore } from "./deviceStore";
import { attachWebSockets } from "./websockets";

export { createApp } from "./app";

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  initDeviceStore(DATA_DIR);
  console.log(`Device store initialized at ${DATA_DIR}/store.json`);

  const app = createApp();
  const httpServer = createServer(app);

  attachWebSockets(httpServer);
  startStaleAgentSweep();

  httpServer.listen(PORT, () => {
    console.log(`Spectre control server listening on :${PORT}`);
    const addr = httpServer.address();
    if (addr && typeof addr === "object") {
      const { address, port } = addr as AddressInfo;
      const host = address === "::" || address === "0.0.0.0" ? "localhost" : address;
      const wsURL = `ws://${host}:${port}`;
      console.log(`Enroll agents via the web UI or: POST /devices/enroll`);
      console.log(`Legacy token auth still available with: ./spectre-agent --host ${wsURL} --token ${AUTH_TOKEN}`);
    }
  });
}
