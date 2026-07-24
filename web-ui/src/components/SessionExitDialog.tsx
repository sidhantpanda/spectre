import { useEffect, useRef } from "react";
import { Button } from "./ui/button";

type Props = {
  sessionId: string;
  /** False on hosts without tmux, where leaving does not preserve anything. */
  persistent: boolean;
  onKill: () => void;
  onLeave: () => void;
  onSendEof: () => void;
  onDismiss: () => void;
};

/**
 * Shown when Ctrl+D is pressed in the terminal.
 *
 * The keystroke is intercepted in the browser and never reaches the agent, so
 * the shell has not exited and the session is still intact while this is open —
 * every option here is still available.
 */
export function SessionExitDialog({ sessionId, persistent, onKill, onLeave, onSendEof, onDismiss }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onDismiss}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-exit-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="session-exit-title" className="text-lg font-semibold tracking-tight">
          Leave this session?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{sessionId}</code>
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {persistent
            ? "Leaving it running keeps the shell and its scrollback alive on the host, so you can attach again later."
            : "This host has no tmux, so the session cannot outlive your disconnect either way."}
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={onLeave}>Leave running, back to home</Button>
          <Button variant="outline" onClick={onKill} className="text-destructive hover:text-destructive">
            Kill session
          </Button>
          <Button variant="ghost" size="sm" onClick={onSendEof}>
            Send EOF to the shell instead
          </Button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Ctrl+D is also end-of-input. Use “Send EOF” to close stdin for things like <code>cat</code> or a REPL.
        </p>
      </div>
    </div>
  );
}
