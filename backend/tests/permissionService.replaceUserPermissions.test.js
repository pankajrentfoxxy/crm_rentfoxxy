const assert = require('assert');
const path = require('path');

let currentClient;

function createClient({ failOnInsert = false } = {}) {
  const calls = [];
  return {
    calls,
    released: false,
    async query(sql, params) {
      const normalized = String(sql).trim();
      if (normalized.startsWith('INSERT INTO user_permissions')) {
        calls.push({ type: 'insert', params });
        if (failOnInsert) {
          throw new Error('insert failed');
        }
        return {
          rows: [{
            id: 1,
            user_id: params[0],
            section: params[1],
            can_view: params[2],
            can_create: params[3],
            can_edit: params[4],
            can_delete: params[5],
            granted_by: params[6],
          }],
        };
      }
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        calls.push({ type: normalized.toLowerCase() });
        return { rows: [] };
      }
      if (normalized.startsWith('DELETE FROM user_permissions')) {
        calls.push({ type: 'delete', params });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    release() {
      this.released = true;
      calls.push({ type: 'release' });
    },
  };
}

const dbPath = require.resolve(path.join('..', 'config', 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    async connect() {
      return currentClient;
    },
    async query() {
      throw new Error('replaceUserPermissions should use a transaction client');
    },
  },
};

const { replaceUserPermissions } = require('../services/permissionService');

async function testCommitOnSuccess() {
  currentClient = createClient();
  const rows = await replaceUserPermissions(
    42,
    [{ section: 'tickets', can_view: true, can_create: false, can_edit: true, can_delete: false }],
    7
  );

  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(
    currentClient.calls.map((call) => call.type),
    ['begin', 'delete', 'insert', 'commit', 'release']
  );
}

async function testRollbackOnFailure() {
  currentClient = createClient({ failOnInsert: true });

  await assert.rejects(
    () => replaceUserPermissions(
      42,
      [{ section: 'tickets', can_view: true, can_create: false, can_edit: true, can_delete: false }],
      7
    ),
    /insert failed/
  );

  assert.deepStrictEqual(
    currentClient.calls.map((call) => call.type),
    ['begin', 'delete', 'insert', 'rollback', 'release']
  );
}

(async () => {
  await testCommitOnSuccess();
  await testRollbackOnFailure();
  console.log('permissionService.replaceUserPermissions tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
