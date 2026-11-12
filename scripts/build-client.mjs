import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const temp = join(root, 'client', '.client-body.cjs');

try {
  await build({
    entryPoints: [join(root, 'client', 'index.ts')],
    outfile: temp,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'warning',
  });
  const body = await readFile(temp, 'utf8');
  const factory = `window.__ModuleLoader__.load({
  id: "dsh-turn-notifier",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`;
  await writeFile(join(root, 'client', 'client.js'), factory);
  console.log('built client/client.js');
} finally {
  await rm(temp, { force: true });
}
