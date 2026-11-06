#!/usr/bin/env node
// Reads and writes Kustomize image entries in the GitOps repo (comments and formatting are preserved).
//
//   node gitops-images.mjs bump <gitops-dir> <env> <deployed-dir>
//       For each <deployed-dir>/*.json ({"name","group","image","tag"}), set the image in
//       apps/<group>/<name>/overlays/<env>/kustomization.yaml. Prints one line per service.
//
//   node gitops-images.mjs read <gitops-dir> <group> <service> <env>
//       Prints {"name","group","image","tag"} for that overlay (used by promote.yaml).
//
// Base manifests reference images by logical name (marketplace/<service>); overlays map that name
// to the real registry with newName/newTag. Requires the `yaml` package (npm i yaml@2).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

const SAFE_NAME = /^[a-z0-9-]+$/;
const SAFE_TAG = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_IMAGE = /^[a-z0-9.-]+(:[0-9]+)?(\/[a-z0-9._-]+)+$/;
const ENVS = new Set(["dev", "staging", "prod"]);

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const logical = (service) => `marketplace/${service}`;

function overlayPath(root, group, service, env) {
  if (!SAFE_NAME.test(group) || !SAFE_NAME.test(service)) die(`unsafe group/service: ${group}/${service}`);
  if (!ENVS.has(env)) die(`unknown env: ${env}`);
  const p = join(root, "apps", group, service, "overlays", env, "kustomization.yaml");
  if (!existsSync(p)) die(`missing overlay: ${p} (create it in the GitOps repo first)`);
  return p;
}

function setImage(file, service, image, tag) {
  const doc = parseDocument(readFileSync(file, "utf8"));
  if (doc.errors.length) die(`${file}: ${doc.errors[0].message}`);
  const name = logical(service);
  const images = doc.get("images");
  const entry = doc.createNode({ name, newName: image, newTag: tag });

  if (!images) {
    doc.set("images", doc.createNode([{ name, newName: image, newTag: tag }]));
  } else {
    const items = images.items ?? [];
    const idx = items.findIndex((it) => it.get?.("name") === name);
    if (idx >= 0) {
      items[idx].set("newName", image);
      items[idx].set("newTag", tag);
    } else {
      images.add(entry);
    }
  }
  const out = doc.toString();
  const before = readFileSync(file, "utf8");
  if (out !== before) writeFileSync(file, out);
  return out !== before;
}

function readImage(file, service) {
  const doc = parseDocument(readFileSync(file, "utf8"));
  const items = doc.get("images")?.items ?? [];
  const it = items.find((i) => i.get?.("name") === logical(service));
  if (!it) die(`no image entry for ${logical(service)} in ${file}`);
  return { image: String(it.get("newName")), tag: String(it.get("newTag")) };
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "bump") {
  const [root, env, deployedDir] = args;
  if (!root || !env || !deployedDir) die("usage: bump <gitops-dir> <env> <deployed-dir>");
  const files = existsSync(deployedDir) ? readdirSync(deployedDir).filter((f) => f.endsWith(".json")) : [];
  if (files.length === 0) die(`no deployed services found in ${deployedDir}`);

  for (const f of files.sort()) {
    const d = JSON.parse(readFileSync(join(deployedDir, f), "utf8"));
    if (!SAFE_TAG.test(String(d.tag))) die(`unsafe tag in ${f}`);
    if (!SAFE_IMAGE.test(String(d.image))) die(`unsafe image in ${f}`);
    const file = overlayPath(root, d.group, d.name, env);
    const changed = setImage(file, d.name, d.image, d.tag);
    console.log(`${d.name} -> ${d.image}:${d.tag} ${changed ? "(updated)" : "(unchanged)"}`);
  }
} else if (cmd === "read") {
  const [root, group, service, env] = args;
  if (!root || !group || !service || !env) die("usage: read <gitops-dir> <group> <service> <env>");
  const { image, tag } = readImage(overlayPath(root, group, service, env), service);
  console.log(JSON.stringify({ name: service, group, image, tag }));
} else {
  die("usage: gitops-images.mjs bump|read ...");
}
