import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { approveDevice, denyDevice, listPendingDevices, type PendingDevice } from "../state/enrollment";

/**
 * Where an operator lands after running `spectre-agent up` on a new machine.
 * The agent prints a code; approving it here is what actually grants that
 * machine a credential.
 */
export default function EnrollPage() {
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await listPendingDevices());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Machines appear here seconds after someone runs the agent, so poll while
    // this page is open rather than making the operator reload.
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function handleApprove(userCode: string) {
    setBusy(true);
    setError(null);
    try {
      const device = await approveDevice(userCode);
      setApproved(device.name ?? device.id);
      setCode("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeny(userCode: string) {
    setBusy(true);
    try {
      await denyDevice(userCode);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.trim()) void handleApprove(code.trim().toUpperCase());
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add a machine</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approve the code shown by <code className="font-mono">spectre-agent up</code> on the machine you want to add.
          </p>
        </div>

        {approved && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
            Approved <span className="font-medium">{approved}</span>. It will connect within a few seconds.
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Waiting for approval</CardTitle>
            <CardDescription>
              {pending.length === 0
                ? "No machines are waiting. Run `spectre-agent up --host …` on a machine to see it here."
                : "Confirm the code matches what the machine printed before approving."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between gap-4 rounded-lg border bg-muted/40 p-4"
              >
                <div className="space-y-1">
                  <p className="font-mono text-lg font-semibold tracking-widest">{device.userCode}</p>
                  <p className="text-sm text-muted-foreground">{device.hostname ?? "unknown host"}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires at {new Date(device.expiresAt).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void handleApprove(device.userCode)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleDeny(device.userCode)}>
                    Deny
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enter a code</CardTitle>
            <CardDescription>If the machine is not listed above, type the code it printed.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex gap-2" onSubmit={handleSubmit}>
              <input
                className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm uppercase tracking-widest"
                placeholder="XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
              />
              <Button type="submit" disabled={busy || !code.trim()}>
                Approve
              </Button>
            </form>
          </CardContent>
        </Card>

        <Link to="/" className="inline-block text-sm text-muted-foreground underline underline-offset-4">
          Back to machines
        </Link>
      </div>
    </main>
  );
}
