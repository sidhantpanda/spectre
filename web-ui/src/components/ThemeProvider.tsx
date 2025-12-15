import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  theme: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isSystemDark() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") {
    return isSystemDark() ? "dark" : "light";
  }
  return pref;
}

function getInitialPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem("theme-preference");
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => getInitialPreference());
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(getInitialPreference()));

  useEffect(() => {
    const applyTheme = () => {
      const resolved = resolveTheme(preference);
      setTheme(resolved);
      const root = document.documentElement;
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved === "dark" ? "dark" : "light";
    };

    applyTheme();

    if (preference === "system" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => applyTheme();
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
  }, [preference]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("theme-preference", preference);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setPreference,
      toggle: () => setPreference((prev) => (resolveTheme(prev) === "dark" ? "light" : "dark")),
    }),
    [preference, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
