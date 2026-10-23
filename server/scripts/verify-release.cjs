const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-test-'));
  Object.assign(process.env, { SQLITE_PATH: path.join(directory, 'test.db'), JWT_SECRET: 'test-only-secret', AI_API_KEY: '', OPENAI_API_KEY: '', AI_BACKUP_API_KEY: '', AI_BACKUP_BASE_URL: '', AI_BACKUP_MODEL: '', DATA_RETENTION_DAYS: '0', INITIAL_ADMIN_EMAIL: 'owner@example.test' });
  const { db } = require('../dist/lib/db');
  const bcrypt = require('bcryptjs');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('owner', 'owner@example.test', bcrypt.hashSync('local-test-password', 4), 'Owner', now, now);
  const ai = require('../dist/lib/aiSettings');
  assert(ai.isAdmin('owner')); assert(!ai.isAdmin('outsider'));
  const baseline = ai.getAIConfig();
  await ai.withPreviewSettings({ ...baseline, aiModel: 'preview-only' }, async () => { await Promise.resolve(); assert.equal(ai.getAIConfig().aiModel, 'preview-only'); });
  assert.equal(ai.getAIConfig().aiModel, baseline.aiModel);
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['dist/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let childError = ''; child.stderr.on('data', chunk => { childError += chunk; });
  child.stdout.on('data', chunk => { childError += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const api = async (route, method = 'GET', body, token) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) { try { await fetch(base + '/health'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    assert(ready, childError);
    const owner = (await api('/api/auth/login', 'POST', { email: 'owner@example.test', password: 'local-test-password' })).data.token;
    const member = (await api('/api/auth/register', 'POST', { email: 'member@example.test', password: 'local-test-password', displayName: 'Member' })).data.token;
    assert(owner && member);
    assert.equal((await api('/api/admin/ai-settings')).status, 401);
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await api('/api/admin/ai-settings', method, undefined, member)).status, 403);
    assert.equal((await api('/api/admin/ai-settings/test', 'POST', {}, member)).status, 403);
    assert.equal((await api('/api/admin/ai-settings/test?route=backup', 'POST', {}, member)).status, 403);
    assert.equal((await api('/api/admin/ai-settings/test?route=invalid', 'POST', {}, owner)).status, 400);
    const original = (await api('/api/admin/ai-settings', 'GET', undefined, owner)).data;
    const { hasApiKey, hasBackupApiKey, source, updatedAt, ...values } = original;
    const settings = { ...values, aiProvider: 'openai_compat_auto', aiBaseUrl: 'https://example.invalid/v1', aiModel: 'test-model', aiApiKey: 'secret-test-value', aiTimeoutMs: 20000, aiBackupProvider: 'openai_compat_auto', aiBackupBaseUrl: '', aiBackupModel: '', aiBackupImageDetail: '', aiBackupTimeoutMs: 0 };
    assert.equal((await api('/api/admin/ai-settings/test?route=backup', 'POST', settings, owner)).status, 400);
    assert.equal((await api('/api/admin/ai-settings', 'PUT', { ...settings, aiBaseUrl: 'http://example.invalid' }, owner)).status, 400);
    assert.equal((await api('/api/admin/ai-settings', 'PUT', { ...settings, aiTimeoutMs: -1 }, owner)).status, 400);
    let saved = await api('/api/admin/ai-settings', 'PUT', settings, owner);
    assert.equal(saved.status, 200); assert(!JSON.stringify(saved.data).includes('secret-test-value'));
    assert.equal(ai.getAIConfig().aiModel, 'test-model');
    assert(!db.prepare('SELECT encrypted FROM ai_settings').get().encrypted.includes('secret-test-value'));
    saved = await api('/api/admin/ai-settings', 'PUT', { ...settings, aiApiKey: '', aiModel: 'changed-live' }, owner);
    assert.equal(saved.status, 200); assert.equal(ai.getAIConfig().aiApiKey, 'secret-test-value'); assert.equal(ai.getAIConfig().aiModel, 'changed-live');
    assert.equal((await api('/api/admin/ai-settings', 'PUT', { ...settings, aiBaseUrl: 'https://different.invalid/v1', aiApiKey: '' }, owner)).status, 400);
    assert.equal((await api('/api/admin/ai-settings', 'PUT', { ...settings, aiBackupBaseUrl: 'https://backup.invalid/v1', aiBackupApiKey: '' }, owner)).status, 400);
    assert.equal((await api('/api/admin/ai-settings', 'DELETE', undefined, owner)).status, 200);
    assert.equal(ai.getAIConfig().aiModel, baseline.aiModel);
    assert.equal((await api('/api/auth/forgot-password/request', 'POST', { email: 'owner@example.test' })).status, 503);
    assert.equal((await api('/api/auth/forgot-password/confirm', 'POST', { email: 'owner@example.test', code: '123456', newPassword: 'bad-password' })).status, 503);
    const body = { clientRequestId: 'duplicate-test-id', loggedAt: '2020-01-01T04:00:00.000Z', calories: 200, proteinGram: 10, carbsGram: 20, fatGram: 5 };
    const results = await Promise.all([api('/api/logs', 'POST', body, owner), api('/api/logs', 'POST', body, owner)]);
    assert.equal(results[0].data.log.id, results[1].data.log.id);
    assert.equal((await api('/api/logs', 'GET', undefined, owner)).data.logs.length, 1);
    assert.equal((await api('/api/logs', 'GET', undefined, member)).data.logs.length, 0);
    await api('/api/weights', 'POST', { weightKg: 65, loggedAt: '2020-01-01T04:00:00.000Z' }, owner);
    require('../dist/lib/retention').pruneOldTimeSeriesData();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM food_logs').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM weight_logs').get().n, 1);
    const exported = (await api('/api/data/export', 'GET', undefined, owner)).data;
    assert.equal(exported.foodLogs.length, 1); assert(!JSON.stringify(exported).includes('password_hash'));
    assert.equal((await api('/api/data/export', 'GET', undefined, member)).data.foodLogs.length, 0);
    console.log('PASS: admin access, encrypted settings, live reload, key isolation, rollback, reset protection, idempotency, retention, per-user export');
  } finally {
    child.kill(); await new Promise(resolve => child.once('exit', resolve)); db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
