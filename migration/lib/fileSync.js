/**
 * ERP Laravel storage → CRM backend/uploads file sync helpers.
 */
const fs = require('fs');
const path = require('path');

function stripStoragePrefix(rel) {
  if (!rel) return rel;
  if (rel.startsWith('storage/app/public/')) {
    return rel.slice('storage/app/public/'.length);
  }
  return rel;
}

function normalizeErpPath(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\\/g, '/');
  if (!s || s.startsWith('erp://') || s.startsWith('http://') || s.startsWith('https://')) {
    return null;
  }
  if (s.startsWith('[') || s.startsWith('{')) return null;
  if (s.startsWith('uploads/')) return s;
  return stripStoragePrefix(s.replace(/^\/+/, ''));
}

function crmRelativePath(erpPath) {
  const n = normalizeErpPath(erpPath);
  if (!n) return null;
  if (n.startsWith('uploads/')) return n;
  return `uploads/legacy/${n}`;
}

function resolveErpSourceFile(erpStorageRoot, erpPath) {
  const rel = normalizeErpPath(erpPath);
  if (!rel || rel.startsWith('uploads/')) return null;

  const candidates = [
    path.join(erpStorageRoot, rel),
    path.join(erpStorageRoot, 'public', rel),
    path.join(erpStorageRoot, '..', 'public', rel),
    path.join(erpStorageRoot, '..', 'public', 'storage', rel),
  ];

  for (const abs of candidates) {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function destAbsolutePath(crmUploadRoot, crmRelPath) {
  const rel = crmRelPath.startsWith('uploads/')
    ? crmRelPath.slice('uploads/'.length)
    : crmRelPath;
  return path.join(crmUploadRoot, rel);
}

function copyFileSafe(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    const srcStat = fs.statSync(src);
    const destStat = fs.statSync(dest);
    if (srcStat.size === destStat.size && srcStat.mtimeMs <= destStat.mtimeMs) {
      return { copied: false, skipped: true };
    }
  }
  fs.copyFileSync(src, dest);
  return { copied: true, skipped: false };
}

function collectPathsFromJson(raw, out) {
  if (raw == null) return;
  if (Array.isArray(raw)) {
    for (const item of raw) collectPathsFromJson(item, out);
    return;
  }
  if (typeof raw === 'object') {
    for (const v of Object.values(raw)) collectPathsFromJson(v, out);
    return;
  }
  const p = normalizeErpPath(raw);
  if (p && !p.startsWith('uploads/')) out.add(p);
}

module.exports = {
  normalizeErpPath,
  crmRelativePath,
  resolveErpSourceFile,
  destAbsolutePath,
  copyFileSafe,
  collectPathsFromJson,
};
