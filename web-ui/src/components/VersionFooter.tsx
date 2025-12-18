import { useEffect, useState } from "react";
import { getWebUiVersion } from "../lib/version";
import { fetchServerVersion } from "../state/version";

const WEB_UI_VERSION = getWebUiVersion();

type Props = {
  apiBase?: string;
};

export function VersionFooter({ apiBase }: Props) {
  const [serverVersion, setServerVersion] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    fetchServerVersion(apiBase).then((version) => {
      if (mounted) {
        setServerVersion(version);
      }
    });
    return () => {
      mounted = false;
    };
  }, [apiBase]);

  const serverLabel =
    serverVersion === undefined ? "loading..." : serverVersion ?? "unavailable";

  return (
    <footer className="border-t bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="mx-auto flex max-w-5xl justify-center px-6 py-4 text-xs text-muted-foreground">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
          <span className="flex items-center gap-2">
            Web UI
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]">{WEB_UI_VERSION}</code>
          </span>
          <span className="flex items-center gap-2">
            Server
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]">{serverLabel}</code>
          </span>
        </div>
      </div>
    </footer>
  );
}
