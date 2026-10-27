#!/usr/bin/env node
/** Remove build artifacts. Use when the dev server shows "Cannot find module './NNN.js'":
 *  that means `next build` and `next dev` shared `.next` and clobbered each other. */
import fs from "node:fs";

for (const dir of [".next", ".next-prod", ".next-mock"]) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`removed ${dir}`);
}
