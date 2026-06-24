#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔨 Building Vokab...\n');

// Read source files
const html = fs.readFileSync('src/index.html', 'utf8');
const app = fs.readFileSync('src/app.js', 'utf8');
const packsPath = 'src/data/vocab-by-pn.json';
const packs = JSON.parse(fs.readFileSync(packsPath, 'utf8'));

console.log(`✓ Loaded HTML template`);
console.log(`✓ Loaded app.js (${app.split('\n').length} lines)`);
console.log(`✓ Loaded packs (${Object.keys(packs).map(k => `${k}: ${packs[k].length} items`).join(', ')})`);

// Create PACKS constant
const packsCode = `const PACKS = ${JSON.stringify(packs, null, 2)};`;

// Create final HTML
let final = html
  .replace('/* PACKS_PLACEHOLDER */', packsCode)
  .replace('/* APP_CODE_PLACEHOLDER */', app);

// Write output. GitHub Pages serves the root index.html, so write there directly
// (the deployed file). Also mirror to dist/ for local preview.
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', final, 'utf8');
fs.writeFileSync('index.html', final, 'utf8');

console.log(`\n✓ Built index.html (root, deployed) + dist/index.html`);
console.log(`  Size: ${(final.length / 1024).toFixed(1)} KB\n`);
console.log('Done! Commit index.html — GitHub Pages serves it from the repo root.\n');
