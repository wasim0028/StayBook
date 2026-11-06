#!/usr/bin/env node
// Decides which services to build for this push and prints a GitHub Actions matrix.
//
// Env:
//   BEFORE   previous commit (github.event.before); all-zero or missing => build everything
//   AFTER    current commit (github.sha)
//   ONLY     comma-separated service names (workflow_dispatch), or "all"
//   CONFIG   path to services.json (default .github/services.json)
// Writes `matrix` and `any` to $GITHUB_OUTPUT when set, and always prints the matrix to stdout.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(process.env.CONFIG ?? ".github/services.json", "utf8"));
const services = config.services;
const byName = new Map(services.map((s) => [s.name, s]));

function changedFiles(before, after) {
  if (!before || /^0+$/.test(before)) return null; // new branch / first push: unknown diff
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${before}...${after}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean);
  } catch {
    // `before` not in history (force-push, shallow clone): be safe and build everything
    return null;
  }
}

function select() {
  const only = (process.env.ONLY ?? "").trim();
  if (only && only !== "all") {
    const names = only.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = names.filter((n) => !byName.has(n));
    if (unknown.length) throw new Error(`unknown service(s): ${unknown.join(", ")}`);
    return names.map((n) => byName.get(n));
  }
  if (only === "all") return services;

  const files = changedFiles(process.env.BEFORE, process.env.AFTER ?? "HEAD");
  if (files === null) return services;

  const touches = (prefixes) => files.some((f) => prefixes.some((p) => f === p || f.startsWith(p)));
  if (touches(config.sharedPaths)) return services;
  return services.filter((s) => touches(s.paths));
}

const selected = select();
const matrix = { include: selected.map(({ name, group, dockerfile }) => ({ name, group, dockerfile })) };
const json = JSON.stringify(matrix);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${json}\nany=${selected.length > 0}\n`);
}
console.log(json);
