import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  createAuthKey,
  enrollCommand,
  enrollExistingCommand,
  fetchConnectHost,
  type CreatedAuthKey,
} from "../state/enrollment";

type Props = {
  apiBase: string;
};

/** The "Add a machine" card: auth-key creation, the command box, and copy button. */
export function AddMachineCard({ apiBase }: Props) {
  const [createdKey, setCreatedKey] = useState<CreatedAuthKey | null>(null);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectHost, setConnectHost] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchConnectHost().then(setConnectHost).catch(() => setConnectHost(null));
  }, []);

  async function handleCreateAuthKey() {
    setIsCreatingKey(true);
    setKeyError(null);
    setCopied(false);
    try {
      setCreatedKey(await createAuthKey({ reusable: false }));
    } catch (err) {
      setKeyError((err as Error).message);
    } finally {
      setIsCreatingKey(false);
    }
  }

  const host = connectHost ?? apiBase.replace(/^http/, "ws");
  const command = useMemo(() => (createdKey ? enrollCommand(createdKey.key, host) : ""), [createdKey, host]);
  const existingCommand = useMemo(
    () => (createdKey ? enrollExistingCommand(createdKey.key, host) : ""),
    [createdKey, host],
  );

  function copyCommand() {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a machine</CardTitle>
        <CardDescription>
          Create an auth key and run the command on the machine you want to add. It dials out to this server, so it
          works behind NAT and firewalls.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {createdKey ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Run this on the machine you want to add. It installs the agent and connects it.
            </p>
            <div className="flex items-center gap-2">
              <code className="block flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 font-mono text-sm">
                {command}
              </code>
              <Button variant="outline" size="sm" onClick={copyCommand} aria-label="Copy command">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Already installed there? Run{" "}
              <code className="font-mono break-all">{existingCommand}</code> instead.
            </p>
            <p className="text-xs text-muted-foreground">
              Single use, expires {new Date(createdKey.expiresAt).toLocaleDateString()}. This key is shown once —
              copy it now.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setCreatedKey(null)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Button onClick={handleCreateAuthKey} disabled={isCreatingKey}>
              {isCreatingKey ? "Creating..." : "Create auth key"}
            </Button>
            {keyError && <p className="text-sm text-destructive">{keyError}</p>}
            <p className="text-xs text-muted-foreground">
              No key handy? Run <code className="font-mono">spectre-agent up --host …</code> on the machine and
              approve the code it prints — it appears in the list below, or{" "}
              <button type="button" className="underline underline-offset-4" onClick={() => navigate("/enroll")}>
                enter it by hand
              </button>
              .
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
