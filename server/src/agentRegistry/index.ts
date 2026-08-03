import { type AgentRecord, type ControlMessage } from "../types";

export type AgentDependencies = {
  listAgents: () => AgentRecord[];
  pushToAgent: (id: string, message: ControlMessage) => void;
  refreshDockerInfo?: () => void;
  refreshSystemInfo?: () => void;
  refreshNetworkInfo?: () => void;
};

export { disconnectDevice, pushToAgent, resetAgentsForTest, startStaleAgentSweep } from "./connections";
export { currentAgent, listAgents, onAgentOutput, onAgentStatusChange, onAgentUpdateFailure } from "./events";
export { registerInboundAgent } from "./inbound";
export {
  refreshAllDockerInfo,
  refreshAllNetworkInfo,
  refreshAllSystemInfo,
  requestDockerInfo,
  requestNetworkInfo,
  requestSystemInfo,
} from "./info";
