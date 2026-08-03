// Must be first: loads .env into process.env before ./config reads it.
import "./loadEnv";
import { createServer } from "http";
import { startAgentReleaseWatch } from "./agentRelease";
import { startStaleAgentSweep } from "./agentRegistry";
import { createApp } from "./app";
import { ConfigError, DATA_DIR, PORT, validateConfig } from "./config";
import { initDeviceStore } from "./deviceStore";
import { lanAddresses } from "./utils/net";
import { attachWebSockets } from "./websockets";

export { createApp } from "./app";

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  try {
    validateConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // Refusing to boot is the point: a Spectre server without a password is
      // an anonymous root shell for every enrolled machine.
      console.error(`\nSpectre cannot start.\n\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  initDeviceStore(DATA_DIR);

  const app = createApp();
  const httpServer = createServer(app);

  attachWebSockets(httpServer);
  startStaleAgentSweep();
  // Warms the "is an update available" answer before the first dashboard load.
  startAgentReleaseWatch();

  httpServer.listen(PORT, () => {
    const addresses = lanAddresses();
    const primary = addresses[0] ?? "localhost";

    console.log(`Spectre control server listening on :${PORT}`);
    console.log(`Device store: ${DATA_DIR}/spectre.db`);
    if (addresses.length > 0) {
      console.log(`Reachable on this network at: ${addresses.map((ip) => `${ip}:${PORT}`).join(", ")}`);
    }
    console.log(`Add a machine: create an auth key in the web UI, then run`);
    console.log(`  spectre-agent up --host ws://${primary}:${PORT} --authkey <key>`);
    console.log(`(use wss:// once the server is behind a TLS proxy)`);
  });
}
