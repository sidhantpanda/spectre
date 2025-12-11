import { Button } from "./components/ui/button";
import { Github } from "lucide-react";

function App() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Control server</p>
            <h1 className="text-2xl font-semibold tracking-tight">Spectre Control Panel</h1>
          </div>
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a href="https://github.com" target="_blank" rel="noreferrer">
              <Github className="h-4 w-4" />
              Repository
            </a>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-xl font-semibold tracking-tight">Welcome</h2>
          <p className="mt-2 text-muted-foreground">
            This interface will host the controls for the Spectre server. It is built with
            Vite, React, TypeScript, and shadcn UI components so you can quickly expand it with
            new panels and controls.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary action</Button>
            <Button variant="outline">Ghost action</Button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
