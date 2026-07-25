import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { CTRL_D } from "../components/terminal/types";

type UseXtermParams = {
  activeSessionId: string | null;
  /**
   * Owned by the caller (AgentTerminal), not created here: useTerminalSocket
   * also needs to read/write these, and it is wired up before this hook runs,
   * so the refs have to already exist by then.
   */
  termRef: MutableRefObject<Terminal | null>;
  pendingOutput: MutableRefObject<string[]>;
  exitPromptOpen: boolean;
  send: (payload: Record<string, unknown>) => void;
  /** Called instead of forwarding Ctrl+D to the agent. */
  onCtrlD: () => void;
};

/**
 * xterm construction, FitAddon, ResizeObserver, geometry reporting, focus, the
 * Ctrl+D interception, and the pending-output buffer.
 */
export function useXterm({ activeSessionId, termRef, pendingOutput, exitPromptOpen, send, onCtrlD }: UseXtermParams) {
  const fitRef = useRef<FitAddon | null>(null);
  const [termNode, setTermNode] = useState<HTMLDivElement | null>(null);

  // Create the terminal only while a session is attached, so the picker is not
  // sitting behind a stale, zero-sized xterm instance.
  useEffect(() => {
    if (!activeSessionId || !termNode) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: "#0B1021",
        foreground: "#E2E8F0",
        black: "#1e293b",
        green: "#22c55e",
        cyan: "#06b6d4",
        blue: "#3b82f6",
        magenta: "#a855f7",
        red: "#ef4444",
        yellow: "#eab308",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termNode);
    termRef.current = term;
    fitRef.current = fit;

    const safeFit = () => {
      if (!fitRef.current || !termRef.current?.element) return;
      try {
        fitRef.current.fit();
      } catch {
        // ignore transient sizing errors
      }
    };

    // Fitting only resizes the canvas in the browser. The remote PTY has to be
    // told separately, or the shell keeps wrapping lines and drawing
    // full-screen programs for its original geometry.
    const resizeHandler = term.onResize(({ cols, rows }) => {
      send({ type: "resize", cols, rows });
    });

    safeFit();
    // onResize only fires when the fitted size differs from xterm's default, so
    // send the current geometry unconditionally — the session may have been
    // left at a different size by a previous viewer.
    send({ type: "resize", cols: term.cols, rows: term.rows });

    for (const chunk of pendingOutput.current) term.write(chunk);
    pendingOutput.current = [];

    // Ctrl+D is swallowed here, before it can reach the agent. The shell never
    // sees it, so nothing has exited yet and the dialog can still offer to keep
    // the session running.
    const dataHandler = term.onData((data) => {
      if (data === CTRL_D) {
        onCtrlD();
        return;
      }
      send({ type: "input", data });
    });

    // Opening a session is a request to type in it: put the caret in the
    // terminal so the first keystroke lands there and the cursor is visible,
    // rather than making the user click the black rectangle first.
    term.focus();

    // A ResizeObserver catches everything a window listener misses: the sidebar
    // opening, the notice banner appearing, a phone rotating, the container's
    // own vh-based height changing.
    const observer = new ResizeObserver(() => safeFit());
    observer.observe(termNode);
    window.addEventListener("resize", safeFit);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", safeFit);
      resizeHandler.dispose();
      dataHandler.dispose();
      fitRef.current?.dispose();
      fitRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [activeSessionId, termNode, send]);

  // The exit dialog takes focus while it is open; hand it back on dismiss so
  // typing carries on where it left off.
  useEffect(() => {
    if (exitPromptOpen || !activeSessionId) return;
    termRef.current?.focus();
  }, [activeSessionId, exitPromptOpen]);

  return { termNode, setTermNode };
}
