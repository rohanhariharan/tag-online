// Assemble the static bundle published to GitHub Pages.
// The site is public/ + shared/ + Phaser; there is no server on Pages, so the
// client falls back to offline practice mode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

copyDir(path.join(root, 'public'), out);
copyDir(path.join(root, 'shared'), path.join(out, 'shared'));

const phaser = path.join(root, 'node_modules', 'phaser', 'dist', 'phaser.min.js');
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.copyFileSync(phaser, path.join(out, 'vendor', 'phaser.min.js'));

// GitHub Pages runs Jekyll unless told otherwise.
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log('built _site/');
console.log('  index.html, js/, shared/, vendor/phaser.min.js');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
