import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SKIP_DIRS = new Set([
  ".git",
  ".playwright-mcp",
  "dist",
  "dist-djdi",
  "dist-server",
  "node_modules",
]);
const SKIP_FILES = new Set([".env", ".env.local"]);
const SCAN_ROOTS = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "DEPLOY.md",
  "Dockerfile",
  "README.md",
  "index.html",
  "package.json",
  "package-lock.json",
  "server.test.ts",
  "server.ts",
  "src",
  "scripts",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
];
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".example",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

function isSkipped(file) {
  return file
    .split(path.sep)
    .some((part) => SKIP_DIRS.has(part));
}

function isProbablyText(file) {
  if (SKIP_FILES.has(path.basename(file))) return false;
  const ext = path.extname(file);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(file);
  return base === "Dockerfile" || base === ".dockerignore" || base === ".gitignore";
}

function walkFiles(dir = root) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    if (isSkipped(rel)) continue;
    if (entry.isDirectory()) {
      files.push(...walkFiles(abs));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function scanFiles() {
  const files = [];
  for (const item of SCAN_ROOTS) {
    const abs = path.join(root, item);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      files.push(...walkFiles(abs));
    } else if (stat.isFile()) {
      files.push(item);
    }
  }
  return files;
}

function checkText(file) {
  if (isSkipped(file) || !isProbablyText(file)) return [];
  const abs = path.join(root, file);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return [];
  const text = fs.readFileSync(abs, "utf8");
  const errors = [];
  const lines = text.split(/\n/);
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line.replace(/\r$/, ""))) {
      errors.push(`${file}:${index + 1}: trailing whitespace`);
    }
  });
  return errors;
}

const files = scanFiles().filter((file) => isProbablyText(file));
const errors = [];

for (const file of files) errors.push(...checkText(file));

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedFiles: files.length,
      scanRoots: SCAN_ROOTS,
      skippedDirs: [...SKIP_DIRS].sort(),
    },
    null,
    2
  )
);
