import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.VITE_OUT_DIR || "dist";
const buildRoot = path.join(
  os.tmpdir(),
  `djdi-golf-board-client-build-${outDir.replace(/[^a-z0-9_-]/gi, "_")}`
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyEntry(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.cpSync(from, to, { recursive: true, force: true });
  } else {
    fs.copyFileSync(from, to);
  }
}

fs.rmSync(buildRoot, { recursive: true, force: true });
fs.mkdirSync(buildRoot, { recursive: true });

const buildInputs = [
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "src",
  ".env",
  ".env.local",
].filter((entry) => fs.existsSync(path.join(root, entry)));

for (const entry of buildInputs) {
  copyEntry(path.join(root, entry), path.join(buildRoot, entry));
}

fs.symlinkSync(path.join(root, "node_modules"), path.join(buildRoot, "node_modules"));

run(
  process.execPath,
  [path.join(buildRoot, "node_modules", "vite", "bin", "vite.js"), "build"],
  {
    cwd: buildRoot,
    env: process.env,
  }
);

fs.rmSync(path.join(root, outDir), { recursive: true, force: true });
fs.cpSync(path.join(buildRoot, outDir), path.join(root, outDir), {
  recursive: true,
  force: true,
});
