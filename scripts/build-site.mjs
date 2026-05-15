import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const files = [
  'index.html',
  'privacy.html',
  'terms.html',
  'support.html',
  '404.html',
  'styles.css',
  'robots.txt',
  'IMPOSTER-icon.svg',
  'IMPOSTER-transparent.svg',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(path.join(root, file), path.join(output, file));
}

console.log(`Built static legal site in ${path.relative(root, output)}`);
