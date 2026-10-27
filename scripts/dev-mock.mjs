#!/usr/bin/env node
/**
 * Serve the mock corpus on its own port, leaving `npm run dev` (real data) alone.
 *
 *   npm run dev:mock
 *   npm run dev:mock -- --port 4400
 *
 * The corpus is generated on demand when it is missing, which is the fresh-clone
 * case: `npm install && npm run dev:mock` and there is UI to look at.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

const port = flag("port", process.env.PORT || "4318");
const dataRoot = path.resolve(process.cwd(), "data-mock");
const dbFile = path.join(dataRoot, "db.json");

if (!fs.existsSync(dbFile)) {
  console.log("no mock corpus yet; generating it");
  const made = spawnSync(process.execPath, [path.join("scripts", "mock.mjs")], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (made.status !== 0) process.exit(made.status || 1);
}

const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
if (!fs.existsSync(nextBin)) {
  console.error("next is not installed; run npm install first");
  process.exit(1);
}

console.log(`mock UI -> http://localhost:${port} (data: ${dataRoot})`);
const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: { ...process.env, LEADLINE_DATA: dataRoot, LEADLINE_DIST: ".next-mock" },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
