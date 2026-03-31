export const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
export const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || "changeme";
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
export const DATA_DIR = process.env.DATA_DIR || "./data";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
