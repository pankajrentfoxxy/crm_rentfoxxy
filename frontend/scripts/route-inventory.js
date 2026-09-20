#!/usr/bin/env node
/**
 * Extracts every routed path and every path the menu can reach, and diffs them.
 * Shared by check-routes.js and by the docs/route-inventory.md deliverable.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../src');

function read(dir, filter) {
  return fs.readdirSync(dir)
    .filter(filter)
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/** Routed paths, with the (section, action) the route already declares. */
function routedPaths() {
  const out = [];
  for (const { file, text } of read(path.join(SRC, 'routes'), (f) => f.endsWith('.jsx'))) {
    // Each entry is `{ path: '/x', element: ... }`; take the path and then look
    // ahead in the same entry for guard('section','action') or section="x".
    const re = /path:\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(text))) {
      const tail = text.slice(m.index, m.index + 600);
      const g = tail.match(/guard\(\s*'([^']+)'\s*,\s*'([^']+)'/);
      const s = tail.match(/sections?=\{?\[?\s*'([^']+)'/) || tail.match(/section="([^"]+)"/);
      const a = tail.match(/action="([^"]+)"/);
      out.push({
        path: m[1],
        file,
        section: g?.[1] || s?.[1] || null,
        action: g?.[2] || a?.[1] || (g || s ? 'view' : null),
      });
    }
  }
  return out;
}

/** Every `to:` / `path:` the legacy menu can reach. */
function menuPaths() {
  const text = fs.readFileSync(path.join(SRC, 'config/menuConfig.js'), 'utf8');
  const set = new Set();
  for (const m of text.matchAll(/(?:to|path):\s*'([^']+)'/g)) set.add(m[1].split('?')[0]);
  return set;
}

/** Everything in the new declarative tree, once it exists. */
function navPaths() {
  const f = path.join(SRC, 'config/navigation.js');
  if (!fs.existsSync(f)) return { paths: new Set(), allow: new Set() };
  const text = fs.readFileSync(f, 'utf8');
  const paths = new Set();
  for (const m of text.matchAll(/to:\s*'([^']+)'/g)) paths.add(m[1].split('?')[0]);
  const allow = new Set();
  const block = text.match(/UNREACHABLE_BY_DESIGN\s*=\s*\[([\s\S]*?)\]/);
  if (block) for (const m of block[1].matchAll(/'([^']+)'/g)) allow.add(m[1]);
  return { paths, allow };
}

/** A wildcard route covers everything beneath it. */
function coveredBy(p, set) {
  if (set.has(p)) return true;
  for (const entry of set) {
    if (entry.endsWith('/*') && p.startsWith(entry.slice(0, -2))) return true;
  }
  // '/sales-pipeline/*' in the router is reached by '/sales-pipeline/quotations' in a menu
  if (p.endsWith('/*')) {
    const base = p.slice(0, -2);
    for (const entry of set) if (entry.startsWith(base)) return true;
  }
  return false;
}

module.exports = { routedPaths, menuPaths, navPaths, coveredBy };

if (require.main === module) {
  const routes = routedPaths();
  const menu = menuPaths();
  const nav = navPaths();
  const params = routes.filter((r) => r.path.includes(':'));
  const concrete = routes.filter((r) => !r.path.includes(':'));
  const unreachableMenu = concrete.filter((r) => !coveredBy(r.path, menu));
  const unreachableNav = concrete.filter((r) => !coveredBy(r.path, nav.paths) && !nav.allow.has(r.path));

  console.log(`routed paths           : ${routes.length}`);
  console.log(`  with a URL parameter : ${params.length}  (detail pages, never in a menu)`);
  console.log(`  concrete             : ${concrete.length}`);
  console.log(`declared (section,action): ${routes.filter((r) => r.section).length} of ${routes.length}`);
  console.log(`legacy menu entries    : ${menu.size}`);
  console.log(`unreachable from legacy menu : ${unreachableMenu.length}`);
  console.log(`navigation.js entries  : ${nav.paths.size} (allowlist ${nav.allow.size})`);
  console.log(`unreachable from navigation.js : ${unreachableNav.length}`);
}
