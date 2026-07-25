import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type Props = {
  connectedCount: number;
  disconnectedCount: number;
};

/** The Connected/Disconnected tiles. */
export function StatusCounts({ connectedCount, disconnectedCount }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Connected</CardTitle>
          <CardDescription>Agents with an active control socket.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-3xl font-semibold">{connectedCount}</p>
          <p className="text-sm text-muted-foreground">Including agents that have completed the handshake.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Disconnected</CardTitle>
          <CardDescription>Agents awaiting reconnection.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-3xl font-semibold">{disconnectedCount}</p>
          <p className="text-sm text-muted-foreground">These connections will need a new attempt.</p>
        </CardContent>
      </Card>
    </div>
  );
}
