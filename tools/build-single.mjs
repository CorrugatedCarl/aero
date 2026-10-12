// tools/build-single.mjs — inlines style.css, the sprite and every module under src/ into one HTML file.
//   node tools/build-single.mjs            → dist/aero.html           (standalone page)
//   node tools/build-single.mjs --fragment → dist/aero-fragment.html  (no <html>/<head>/<body>, for hosts that wrap it)
// Each module becomes a function scope; imports become destructuring of the module it names.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fragment = process.argv.includes('--fragment');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const order = ['util', 'config', 'aero', 'terrain', 'aircraft', 'sim', 'input', 'render', 'hud', 'main'];
const id = (spec) => '__' + path.basename(spec, '.js');

let js = '';
for (const name of order) {
  let src = read(`src/${name}.js`);
  // embed the sprite so the single file needs nothing next to it
  if (name === 'config') {
    src = src.replace(/src: '([^']+\.png)'/, (_, file) =>
      `src: 'data:image/png;base64,${fs.readFileSync(path.join(root, file)).toString('base64')}'`);
  }
  const exportsList = [];
  src = src.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';?[ \t]*$/gm, (_, names, spec) => {
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2'));
    return `const { ${parts.join(', ')} } = ${id(spec)};`;
  });
  if (/^import\s/m.test(src)) throw new Error(`unsupported import form in src/${name}.js`);
  src = src.replace(/^export\s+(const|let|function|class)\s+(\w+)/gm, (_, kind, n) => { exportsList.push(n); return `${kind} ${n}`; });
  if (/^export\s/m.test(src)) throw new Error(`unsupported export form in src/${name}.js`);
  js += `// ---- src/${name}.js\nconst ${id(name)} = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n\n`;
}

const html = read('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = [...html.matchAll(/<link[^>]+fonts\.(googleapis|gstatic)[^>]*>/g)].map((m) => m[0]).join('\n');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/<script type="module"[^>]*><\/script>\s*/, '');
const style = `<style>\n${read('style.css')}</style>`;
const script = `<script>\n${js}</script>`;

const out = fragment
  ? `${title}\n${fonts}\n${style}\n${body.trim()}\n${script}\n`
  : html.replace(/<link rel="stylesheet" href="style.css">/, style)
    .replace(/<script type="module"[^>]*><\/script>/, script);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const file = path.join(root, 'dist', fragment ? 'aero-fragment.html' : 'aero.html');
fs.writeFileSync(file, out);
console.log(`${path.relative(root, file)}  ${(out.length / 1024).toFixed(1)} KB`);
