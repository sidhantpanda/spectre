const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

const configured = process.env.NEXT_PUBLIC_SITE_URL ?? vercelHost;

// Vercel exposes its own host variables as bare hostnames, so NEXT_PUBLIC_SITE_URL
// is easy to set the same way. Default a missing scheme to https and drop any
// trailing slash instead of throwing — siteUrl is both passed to `new URL()` and
// concatenated onto paths, so it has to be a scheme-qualified origin.
function normalizeOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(withScheme).href.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export const siteUrl = normalizeOrigin(configured) ?? "http://localhost:3001";
