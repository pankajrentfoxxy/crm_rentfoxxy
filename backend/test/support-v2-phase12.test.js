'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../frontend/src/features/support-v2');
const BANNED = /\b(bg|text|border|ring|from|to|divide|outline)-(slate|gray|zinc|neutral|stone|blue|indigo|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|red|rose|pink|fuchsia|purple|violet)-[0-9]{2,3}\b/;
const MOBILE_MINH = new Set([
  'pages/BucketPage.jsx',
  'pages/MyBucketPage.jsx',
  'pages/JobExecutionPage.jsx',
  'pages/WarehouseReceiptPage.jsx',
  'components/RequestPartSheet.jsx',
  'components/ConditionGradingSheet.jsx',
]);

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(jsx|js)$/.test(name)) acc.push(full);
  }
  return acc;
}

test('phase 12: no support-v2 file imports CRM primitives', () => {
  const hits = [];
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes("components/ui/primitives'")) hits.push(path.relative(ROOT, file));
  }
  assert.deepEqual(hits, []);
});

test('phase 12: no stock Tailwind palette classes in support-v2', () => {
  const hits = [];
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    if (BANNED.test(src)) hits.push(path.relative(ROOT, file));
  }
  assert.deepEqual(hits, []);
});

test('phase 12: no rounded-xl / rounded-2xl in support-v2', () => {
  const hits = [];
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    if (/rounded-(xl|2xl)/.test(src)) hits.push(path.relative(ROOT, file));
  }
  assert.deepEqual(hits, []);
});

test('phase 12: min-h-[44px] only on technician screens', () => {
  const hits = [];
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('min-h-[44px]')) continue;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (!MOBILE_MINH.has(rel)) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});

test('phase 12: support primitives export Button, DataTable, PageHeader', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/ui/supportPrimitives.jsx'), 'utf8');
  assert.match(src, /export function Button/);
  assert.match(src, /export function DataTable/);
  assert.match(src, /export function PageHeader/);
  assert.match(src, /export function StatCard/);
  const shell = fs.readFileSync(path.join(ROOT, 'SupportV2Shell.jsx'), 'utf8');
  assert.match(shell, /bg-sup-ink/);
  assert.match(shell, /bg-sup-accent2 text-white/);
  assert.doesNotMatch(shell, /text-pri1/);
  const foundation = fs.readFileSync(path.join(ROOT, 'pages/FoundationPage.jsx'), 'utf8');
  assert.match(foundation, /This page is the contract/);
});
