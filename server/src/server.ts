import { createServer } from "http";
import { type AddressInfo } from "net";
import { createApp } from "./app";
import { AUTH_TOKEN, PORT } from "./config";
import { attachWebSockets } from "./websockets";

export { createApp } from "./app";

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  const app = createApp();
  const httpServer = createServer(app);

  attachWebSockets(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`Spectre control server listening on :${PORT}`);
    const addr = httpServer.address();
    if (addr && typeof addr === "object") {
      const { address, port } = addr as AddressInfo;
      const host = address === "::" || address === "0.0.0.0" ? "localhost" : address;
      const wsURL = `ws://${host}:${port}/agents/register`;
      console.log(`Agents can initiate inbound control with: ./spectre-agent -host ${wsURL} -token ${AUTH_TOKEN}`);
    } else {
      console.log(`Agents can initiate inbound control using /agents/register with token ${AUTH_TOKEN}`);
    }
  });
}
