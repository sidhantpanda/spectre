import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { AgentStatusDot } from "./AgentStatusDot";
import { type PendingDevice } from "../state/enrollment";

type Props = {
  device: PendingDevice;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
};

export function PendingDeviceItem({ device, busy, onApprove, onReject }: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <AgentStatusDot status="pending" />
          <p className="font-medium">{device.hostname ?? "unknown host"}</p>
          <Badge variant="outline" className="border-amber-500/50 text-[11px]">
            Pending approval
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Code <span className="font-mono tracking-widest text-foreground">{device.userCode}</span> — confirm it
          matches what the machine printed.
        </p>
        <p className="text-xs text-muted-foreground">Expires at {new Date(device.expiresAt).toLocaleTimeString()}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" disabled={busy} onClick={onApprove}>
          {busy ? "Working..." : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onReject}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
