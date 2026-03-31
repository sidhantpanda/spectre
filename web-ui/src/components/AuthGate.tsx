import { useEffect, useState } from "react";
import LoginPage from "../pages/LoginPage";
import { getApiBase } from "../lib/api";
import { clearToken, getStoredToken } from "../lib/auth";

type Props = {
  children: React.ReactNode;
};

type AuthState = "loading" | "no-auth" | "needs-login" | "authenticated";

export function AuthGate({ children }: Props) {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch(`${getApiBase()}/auth/status`);
      const { authEnabled } = await res.json();

      if (!authEnabled) {
        setState("no-auth");
        return;
      }

      const token = getStoredToken();
      if (!token) {
        setState("needs-login");
        return;
      }

      const agentsRes = await fetch(`${getApiBase()}/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (agentsRes.ok) {
        setState("authenticated");
      } else {
        clearToken();
        setState("needs-login");
      }
    } catch {
      const token = getStoredToken();
      setState(token ? "authenticated" : "needs-login");
    }
  }

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (state === "needs-login") {
    return <LoginPage onLogin={() => setState("authenticated")} />;
  }

  return <>{children}</>;
}
