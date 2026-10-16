#!/usr/bin/env node
// exit-lights: record lit/dark per exit point. Zero deps.
// Usage:  node exit-lights/exit-lights.mjs run [--produces dist/] -- <cmd...>   (wrap a command)
//         node exit-lights/exit-lights.mjs scan                                  (static + ignored, roll up)
//         node --import ./exit-lights/exit-lights.mjs app.mjs                   (hook mode, used by `run`)
import { spawnSync, execSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SELF = fileURLToPath(import.meta.url);
const LOG = process.env.EXIT_LIGHTS_LOG;
const isMain = process.argv[1] && path.resolve(process.argv[1]) === SELF;
const light = (code) => (code === 0 ? 'lit' : 'dark');

// ---------- hook mode: preloaded into a child node process ----------
if (!isMain && LOG) {
  const cwd = process.cwd();
  const site = (err) => {
    const stack = (err && err.stack) || new Error().stack;
    for (const l of stack.split('\n').slice(1)) {
      const m = l.match(/\(?(?:file:\/\/)?(\/[^():]+):(\d+):\d+\)?$/);
      if (m && m[1] !== SELF && !m[1].startsWith('node:')) return { file: path.relative(cwd, m[1]), line: +m[2] };
    }
    return { file: path.relative(cwd, process.argv[1] || '?'), line: 0 };
  };
  const rec = (o) => appendFileSync(LOG, JSON.stringify({ ...o, light: light(o.code) }) + '\n');
  let done = false;
  const realExit = process.exit.bind(process);
  process.exit = (code) => { if (!done) { done = true; const c = code ?? process.exitCode ?? 0;
    rec({ ...site(), kind: 'process-exit', code: +c }); } return realExit(code); };
  process.on('uncaughtException', (e) => { done = true;
    rec({ ...site(e), kind: 'uncaught-throw', code: 1, message: String(e?.message ?? e).slice(0, 200) });
    console.error(e); realExit(1); });
  process.on('unhandledRejection', (e) => { done = true;
    rec({ ...site(e), kind: 'unhandled-rejection', code: 1, message: String(e?.message ?? e).slice(0, 200) });
    console.error(e); realExit(1); });
  process.on('exit', (code) => { if (!done) { done = true;
    rec({ file: path.relative(cwd, process.argv[1] || '?'), line: 0, kind: 'natural-end', code }); } });
}

// ---------- CLI ----------
const OUT = 'exit-lights.json';
const load = () => (existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8'))
  : { spec: 'exit-points/0.1', observed: [], static: [], ignored: [], produces: {} });
const save = (r) => writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n');

function run(args) {
  const r = load(); let produces = [];
  while (args[0] === '--produces') { produces.push(args[1]); args = args.slice(2); }
  if (args[0] === '--') args = args.slice(1);
  const cmd = args.join(' ');
  const log = path.resolve(`.exit-lights-${process.pid}.ndjson`); writeFileSync(log, '');
  const p = spawnSync(cmd, { shell: true, stdio: 'inherit', env: { ...process.env, EXIT_LIGHTS_LOG: log,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${SELF}`.trim() } });
  const code = p.status ?? 1;
  const inner = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  execSync(`rm -f ${JSON.stringify(log)}`);
  for (const e of inner) r.observed.push({ ...e, ...(e.file.startsWith('..') ? { tooling: true } : {}), command: cmd });
  r.observed.push({ file: 'package.json', line: 0, kind: 'script-end', code, light: light(code), command: cmd });
  for (const pth of produces) r.produces[pth] = { by: cmd, light: light(code) };
  save(r); return code;
}

function walk(d, acc = []) {
  for (const n of readdirSync(d)) { const f = path.join(d, n);
    if (['node_modules', '.git', 'dist'].includes(n)) continue;
    if (statSync(f).isDirectory()) walk(f, acc); else if (/\.(m|c)?js$/.test(n)) acc.push(f); }
  return acc;
}
function scan() {
  const r = load(); r.static = [];
  const tracked = new Set(execSync('git ls-files', { encoding: 'utf8' }).split('\n'));
  for (const f of walk('.')) {
    const rel = path.relative('.', f); if (!tracked.has(rel) || rel.startsWith('exit-lights/')) continue;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/\bprocess\.exit\s*\(/.test(l)) r.static.push({ file: rel, line: i + 1, kind: 'process-exit', light: 'unobserved' });
      else if (/^throw\b/.test(l)) r.static.push({ file: rel, line: i + 1, kind: 'top-level-throw', light: 'unobserved' });
      else if (/^(assert(\.\w+)?)\s*\(/.test(l)) r.static.push({ file: rel, line: i + 1, kind: 'top-level-throw', via: RegExp.$1, light: 'unobserved' });
    });
  }
  const ign = execSync('git ls-files --others --ignored --exclude-standard --directory', { encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((p) => !p.startsWith('.exit-lights-') && p !== OUT);
  const req = (process.env.EXIT_LIGHTS_REQUIRED || '').split(',').filter(Boolean);
  const names = new Set([...ign, ...Object.keys(r.produces), ...req]);
  r.ignored = [...names].map((p) => { const by = r.produces[p];
    return { path: p, present: ign.includes(p), required: !!by || req.includes(p), litBy: by?.light === 'lit' ? by.by : null,
      light: by?.light === 'lit' && ign.includes(p) ? 'lit' : 'dark' }; });
  // mark statics observed
  for (const s of r.static) { const o = r.observed.find((x) => x.file === s.file && x.line === s.line);
    if (o) s.light = o.light; }
  try { r.sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch {}
  const ok = r.observed.length > 0 && r.observed.every((o) => o.light === 'lit')
    && r.ignored.filter((i) => i.required).every((i) => i.light === 'lit');
  r.light = ok ? 'lit' : 'dark'; save(r);
  console.log(`exit-lights: ${r.observed.length} observed, ${r.static.length} static, ${r.ignored.length} ignored -> ● ${r.light}`);
  return ok ? 0 : 1;
}

if (isMain) {
  const [sub, ...rest] = process.argv.slice(2);
  process.exitCode = sub === 'run' ? run(rest) : sub === 'scan' ? scan() : (console.error('usage: run|scan'), 2);
}
