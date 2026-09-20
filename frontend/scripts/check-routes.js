#!/usr/bin/env node
/**
 * Part 1 §5 rule 4 / acceptance test 6.
 *
 * Fails when a route exists in the router with no navigation entry and no
 * UNREACHABLE_BY_DESIGN entry. This check is the thing that stops 53 pages
 * going missing again — the menu drifting from the router is not a mistake
 * anyone makes deliberately, it is one nobody notices.
 */
const { routedPaths, navPaths, coveredBy } = require('./route-inventory.js');

const nav = navPaths();
const routes = routedPaths();

// A path with a URL parameter is a detail page reached from its list, never a
// menu entry. Excluding them is the one judgement call in this check.
const concrete = routes.filter((r) => !r.path.includes(':'));

const orphans = concrete.filter(
  (r) => !coveredBy(r.path, nav.paths) && !nav.allow.has(r.path)
);

// The other direction matters just as much: a menu entry pointing at a route
// that no longer exists is a link to a blank page.
const routeSet = new Set(routes.map((r) => r.path));
const dangling = [...nav.paths].filter((p) => !coveredBy(p, routeSet));

let failed = false;

if (orphans.length) {
  failed = true;
  console.error(`check-routes: ${orphans.length} route(s) reachable by URL but absent from navigation.js.\n`);
  orphans.forEach((r) => console.error(`  ${r.path}  (${r.file})`));
  console.error('\nAdd each to a section in src/config/navigation.js, or to UNREACHABLE_BY_DESIGN with a reason.');
}

if (dangling.length) {
  failed = true;
  console.error(`\ncheck-routes: ${dangling.length} navigation entr(ies) point at no route.\n`);
  dangling.forEach((p) => console.error(`  ${p}`));
  console.error('\nEither the route was removed or the path is a typo. Both render a blank page.');
}

if (failed) process.exit(1);

console.log(
  `check-routes: clean — ${concrete.length} concrete routes, `
  + `${nav.paths.size} navigation entries, ${nav.allow.size} on the allowlist.`
);
