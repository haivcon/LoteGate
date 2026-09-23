import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
// Optional local tooling, not runtime dependencies. Exact versions only.
export async function external(name, version, env) {
  const explicit = process.env[env];
  const cache = process.env.npm_config_cache ?? join(process.env.LOCALAPPDATA ?? '', 'npm-cache');
  const roots = explicit ? [explicit] : (await readdir(join(cache, '_npx')).catch(() => [])).map(n => join(cache, '_npx', n, 'node_modules', name));
  for (const root of roots) {
    try { const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); if (pkg.name === name && pkg.version === version) return createRequire(join(root, 'package.json'))(root); } catch { /* Try next installed snapshot. */ }
  }
  throw new Error(`Missing optional ${name}@${version}. Set ${env} to its installed package directory. See README.`);
}
