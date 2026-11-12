import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  FaceModelEmitter,
  WorkspaceAnalyzer,
  writeWorkspaceArtifacts,
} from '@deepseek-ai/dsh-typert-generator';

const PACKAGE_NAME = 'dsh-turn-notifier';
const pluginRoot = process.cwd();
const sourceRoot = process.env.DSH_SOURCE;
if (!sourceRoot) {
  throw new Error(
    'build:typert requires DSH_SOURCE pointing at the deepseek-harness checkout at commit 22ddee3; '
      + 'generated artifacts are committed, so ordinary builds do not need this step',
  );
}

const sourcePackage = join(sourceRoot, 'packages', PACKAGE_NAME);
const configPath = join(sourceRoot, 'tsconfig.host.json');
if (existsSync(sourcePackage)) {
  throw new Error(`refusing to overwrite existing source package ${sourcePackage}`);
}
const originalConfig = await readFile(configPath, 'utf8');

try {
  await mkdir(sourcePackage, { recursive: true });
  for (const file of ['package.json', 'tsconfig.json', 'tsconfig.typert.json']) {
    await cp(join(pluginRoot, file), join(sourcePackage, file));
  }
  await cp(join(pluginRoot, 'src'), join(sourcePackage, 'src'), { recursive: true });

  const manifest = JSON.parse(await readFile(join(sourcePackage, 'package.json'), 'utf8'));
  delete manifest.exports['./client'];
  delete manifest.exports['./icon'];
  delete manifest.dsh?.client;
  manifest.exports['.'] = './src/remote.ts';
  await writeFile(join(sourcePackage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const reference = `    { "path": "./packages/${PACKAGE_NAME}" }`;
  const updatedConfig = originalConfig.replace(/\n  \]\n\}\s*$/, `,\n${reference}\n  ]\n}\n`);
  if (updatedConfig === originalConfig) throw new Error('could not append the package reference to tsconfig.host.json');
  await writeFile(configPath, updatedConfig);

  const model = new WorkspaceAnalyzer({
    root: sourceRoot,
    packages: [PACKAGE_NAME],
    faces: ['host'],
    checkDiagnostics: false,
    rejectBuildOutputs: true,
  }).analyze();
  const face = model.faces[0];
  if (face === undefined) throw new Error('typert analyzer produced no host face');
  const pkg = face.packages.find((candidate) => candidate.name === PACKAGE_NAME);
  if (pkg === undefined) throw new Error(`typert analyzer did not discover ${PACKAGE_NAME}`);
  const artifact = new FaceModelEmitter(face).emit(PACKAGE_NAME);
  writeWorkspaceArtifacts(sourceRoot, [{ ...artifact, packageRoot: pkg.root }]);

  await mkdir(join(pluginRoot, 'lib'), { recursive: true });
  for (const file of await readdir(join(sourcePackage, 'lib'))) {
    if (/^typert\./.test(file)) {
      await cp(join(sourcePackage, 'lib', file), join(pluginRoot, 'lib', file));
    }
  }
  console.log(`built ${artifact.face} typert artifact for ${artifact.package}`);
} finally {
  await writeFile(configPath, originalConfig);
  await rm(sourcePackage, { recursive: true, force: true });
}
