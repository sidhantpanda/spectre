import fs from "fs";
import path from "path";

/**
 * Loads the nearest `.env` into process.env before any config is read.
 *
 * Searches upward from the working directory so it finds a repo-root `.env`
 * whether the server is started from the root or from `server/` (as
 * `pnpm --filter @spectre/server dev` does). Variables already present in the
 * environment win — a value exported in the shell or set by the `pnpm dev`
 * script is never clobbered by the file.
 *
 * This module must be imported before `./config`, which reads process.env at
 * import time. Import order in server.ts guarantees that.
 */
function loadEnv() {
  // process.loadEnvFile landed in Node 20.12; skip cleanly on older runtimes.
  if (typeof process.loadEnvFile !== "function") return;

  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
        if (!process.env.SPECTRE_ENV_LOADED_FROM) {
          process.env.SPECTRE_ENV_LOADED_FROM = candidate;
        }
      } catch {
        /* malformed .env — fall through and let config validation report it */
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadEnv();
