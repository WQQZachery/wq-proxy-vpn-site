#!/usr/bin/env node
// Maintainer tool (not part of the normal build): derive the Flutter/Dart package list of the app
// from its pubspec.lock and detect each package's license from the LICENSE file in a local pub
// cache. Output: data/dependencies.json (committed). The build only reads the committed JSON, so
// CI does not need the app repository or a pub cache.
//
//   APP_DIR=/path/to/wq-s-vpn-proxy PUB_CACHE=~/.pub-cache npm run gen-deps
//
// The app repository is read-only for this script.

import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = process.env.APP_DIR;
const PUB_CACHE = process.env.PUB_CACHE;
if (!APP_DIR || !PUB_CACHE) {
  console.error('Set APP_DIR (app repo checkout) and PUB_CACHE (pub cache root).');
  process.exit(1);
}

function parseLock(text) {
  const pk = [];
  const re = /\n  ([A-Za-z0-9_]+):\n    dependency: "?([^"\n]+)"?\n    description:\n?([\s\S]*?)\n    source: (\S+)\n    version: "([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) pk.push({ name: m[1], dependency: m[2], source: m[4], version: m[5] });
  return pk;
}

function classify(text) {
  const has = (s) => text.includes(s);
  const ids = [];
  if (has('Neither the name') || has('names of its') || has('BSD 3-Clause')) ids.push('BSD-3-Clause');
  else if (has('BSD 2-Clause') || (has('Redistribution and use') && !has('Apache License'))) ids.push('BSD-2-Clause');
  else if (has('Redistribution and use in source and binary forms') && has('Apache License')) ids.push('BSD-3-Clause');
  if (has('Permission is hereby granted, free of charge')) ids.push('MIT');
  if (has('Apache License') && has('Version 2.0')) ids.push('Apache-2.0');
  return ids.length ? ids.join(' AND ') : 'UNKNOWN';
}

const lock = await readFile(path.join(APP_DIR, 'pubspec.lock'), 'utf8');
let commit = null;
try { commit = execFileSync('git', ['-C', APP_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
const out = [];
for (const p of parseLock(lock)) {
  let license = 'Flutter SDK (BSD-3-Clause)';
  if (p.source === 'hosted') {
    const f = path.join(PUB_CACHE, 'hosted', 'pub.dev', `${p.name}-${p.version}`, 'LICENSE');
    try { await access(f); license = classify(await readFile(f, 'utf8')); } catch { license = 'UNKNOWN (LICENSE not found in local cache)'; }
  }
  const scope = p.dependency.includes('dev') ? 'dev' : p.dependency === 'transitive' ? 'transitive' : 'direct';
  out.push({ ...p, scope, license, url: p.source === 'hosted' ? `https://pub.dev/packages/${p.name}/versions/${p.version}` : null });
}
out.sort((a, b) => a.name.localeCompare(b.name));
const snapshot = {
  generated_from: 'pubspec.lock',
  app_commit: commit,
  note: 'License detected from each package LICENSE file in the local pub cache (text pattern match); dev/test-only packages are marked and are not shipped in the APK. Platform packages for iOS/macOS/Windows/Linux/web appear in the lock file but are not compiled into the Android APK.',
  packages: out,
};
await writeFile(path.join(ROOT, 'data', 'dependencies.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`wrote ${out.length} packages`);
