// Every EPUB this tool reads or writes is a licensed book. None of it may land in the work tree,
// gitignored folders included, so every path argument is checked here before it is touched.
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function outsideRepo(p, what = 'path') {
  if (!p) throw new Error(`${what} is required`);
  const abs = resolve(String(p).replace(/^~(?=\/|$)/, homedir()));
  const rel = relative(ROOT, abs);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error(`refusing ${what} inside the repo (${rel || '.'}): books never live in the work tree`);
  return abs;
}

export function args(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!spec.includes(k)) throw new Error(`unknown option ${argv[i]}`);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
