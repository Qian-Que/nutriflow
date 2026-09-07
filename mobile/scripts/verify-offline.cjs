const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const files = new Map();
const mockFS = { documentDirectory: 'file:///test/', makeDirectoryAsync: async () => {}, getInfoAsync: async path => ({ exists: files.has(path) }), readAsStringAsync: async path => files.get(path), writeAsStringAsync: async (path, text) => { files.set(path, text); }, moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); } };
function load(name) {
  const source = fs.readFileSync(path.join(__dirname, '..', name + '.ts'), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports, require: name => name === 'expo-file-system/legacy' ? mockFS : name === 'react-native' ? { Platform: { OS: 'android' } } : {}, console });
  return exports;
}
async function main() {
  let store = load('offlineStore');
  store.bindStorageSession('token-a', 'https://server.example', 'user-a');
  store.bindStorageSession('token-b', 'https://server.example', 'user-b');
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.enqueue('token-a', '/api/logs', { clientRequestId: 'request-' + i, calories: i })));
  await store.enqueue('token-a', '/api/logs', { clientRequestId: 'request-0', calories: 999 });
  assert.equal((await store.readPending('token-a')).length, 20);
  assert.equal((await store.readPending('token-b')).length, 0);
  await store.writeDraft('token-a', { text: 'draft', imageBase64: 'x'.repeat(3 * 1024 * 1024), date: '2026-09-08', mimeType: 'image/jpeg' });
  await store.acknowledge('token-a', 'request-0', { id: 'server-id', calories: 0 });
  store = load('offlineStore'); store.bindStorageSession('renewed-token', 'https://server.example', 'user-a');
  assert.equal((await store.readPending('renewed-token')).length, 20);
  assert.equal((await store.readPending('renewed-token'))[0].serverRecord.id, 'server-id');
  assert.equal((await store.readDraft('renewed-token')).imageBase64.length, 3 * 1024 * 1024);
  store.bindStorageSession('other-server', 'https://elsewhere.example', 'user-a'); assert.equal((await store.readPending('other-server')).length, 0);
  const edit = load('nutritionEditing');
  const original = { calories: 400, sodiumMg: 100, id: 12, items: [{ calories: 400, estimatedWeightGram: 200, name: 'meal' }], nutrients: { vitaminCMg: 10 } };
  const half = edit.scaleNutrients(original, 0.5);
  assert.equal(half.calories, 200); assert.equal(half.items[0].estimatedWeightGram, 100); assert.equal(half.nutrients.vitaminCMg, 5); assert.equal(half.id, 12); assert.equal(original.calories, 400);
  console.log('PASS: concurrent queue writes, deduplication, restart recovery, large image drafts, server/account isolation, acknowledged receipts, nutrition scaling');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
