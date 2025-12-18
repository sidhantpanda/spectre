const RUNTIME_WEB_UI_VERSION =
  typeof window !== "undefined" &&
  window.__ENV?.SPECTRE_WEB_UI_VERSION &&
  window.__ENV.SPECTRE_WEB_UI_VERSION.length > 0
    ? window.__ENV.SPECTRE_WEB_UI_VERSION
    : undefined;

const WEB_UI_VERSION = RUNTIME_WEB_UI_VERSION ?? `dev-${Math.floor(Date.now() / 1000)}`;

export function getWebUiVersion() {
  return WEB_UI_VERSION;
}
