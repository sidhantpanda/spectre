import { type SessionInfo } from "../SessionPicker";

export type TerminalMessage =
  | { type: "output"; data: string; sessionId?: string }
  | { type: "status"; status: string; connectionId?: string }
  | { type: "sessions"; sessions?: SessionInfo[]; tmuxAvailable?: boolean }
  | { type: "attached"; sessionId: string }
  | { type: "sessionExited"; sessionId: string }
  | { type: "sessionClosed"; sessionId: string }
  | { type: "error"; message: string };

/** End-of-transmission — what Ctrl+D sends. */
export const CTRL_D = "\x04";
