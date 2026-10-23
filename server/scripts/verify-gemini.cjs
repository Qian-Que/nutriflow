const assert = require('node:assert/strict');
process.env.SQLITE_PATH = ':memory:';
const { db } = require('../dist/lib/db');
const { getAIConfig, withPreviewSettings } = require('../dist/lib/aiSettings');
const { GEMINI_MAX_OUTPUT_TOKENS, parseGeminiResponseBody, extractGeminiText } = require('../dist/services/geminiResponse');
const { testPrimaryAI, describeAITestFailure, selectTestRoute } = require('../dist/services/aiSettingsTest');
const { analyzeFoodText, analyzeFoodImage } = require('../dist/services/aiNutrition');
const { analyzeExerciseText } = require('../dist/services/aiExercise');
const { classifyEntry } = require('../dist/services/aiClassifier');

const candidate = (text, finishReason = 'STOP', extra = []) => ({ candidates: [{ index: 0, content: { parts: [...extra, { text }] }, finishReason }] });
const food = { items: [{ name: 'milk', calories: 150, proteinGram: 8, carbsGram: 12, fatGram: 8 }], totals: { calories: 150, proteinGram: 8, carbsGram: 12, fatGram: 8 }, confidence: 0.8, notes: 'test' };
const secret = 'test-secret-never-display';
const original = getAIConfig();
const settings = { ...original, aiProvider: 'gemini', aiBaseUrl: 'https://example.invalid/v1beta/models', aiModel: 'gemini-test', aiApiKey: secret, aiTimeoutMs: 45000, aiBackupBaseUrl: '', aiBackupApiKey: '', aiBackupModel: '' };
const sse = frames => frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n';
const decode = value => extractGeminiText(parseGeminiResponseBody(value));
function expectCode(body, code, status = null) {
  assert.throws(() => decode(body), error => {
    const diagnostic = describeAITestFailure(error, 45000);
    assert.equal(diagnostic.code, code);
    assert.equal(diagnostic.upstreamStatus, status);
    assert(!JSON.stringify(diagnostic).includes(secret));
    return true;
  });
}

async function main() {
  const backup = selectTestRoute({ ...settings, aiBackupProvider: 'openai_compat_chat', aiBackupBaseUrl: 'https://backup.invalid/v1', aiBackupModel: 'backup-chat', aiBackupApiKey: 'backup-secret', aiBackupTimeoutMs: 12345 }, 'backup');
  assert.equal(backup.aiApiKey, 'backup-secret'); assert.equal(backup.aiTimeoutMs, 12345); assert.equal(backup.aiModel, 'backup-chat');
  assert.equal(selectTestRoute({ ...settings, aiBackupBaseUrl: 'https://backup.invalid/v1' }, 'backup').aiApiKey, '');
  assert.equal(selectTestRoute(settings, 'primary'), settings);
  const serialized = JSON.stringify(food);
  const fragments = [candidate(serialized.slice(0, 25), undefined), candidate(serialized.slice(25))];
  delete fragments[0].candidates[0].finishReason;
  assert.equal(decode(JSON.stringify(candidate(serialized))), serialized);
  assert.equal(decode(JSON.stringify(fragments)), serialized);
  assert.equal(decode(sse(fragments)), serialized);
  assert.equal(decode(JSON.stringify(candidate(serialized, 'STOP', [{ thought: true, text: '{invalid thought}' }]))), serialized);
  assert.equal(decode(sse([...fragments, { usageMetadata: { totalTokenCount: 20 } }])), serialized);
  expectCode(JSON.stringify(candidate(serialized, 'MAX_TOKENS')), 'OUTPUT_TRUNCATED');
  expectCode(sse([fragments[0], candidate('', 'MAX_TOKENS')]), 'OUTPUT_TRUNCATED');
  expectCode(JSON.stringify(candidate('', 'SAFETY')), 'RESPONSE_BLOCKED');
  expectCode(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY', secret } }), 'RESPONSE_BLOCKED');
  expectCode(JSON.stringify(candidate('', 'OTHER')), 'INCOMPLETE_RESPONSE');
  expectCode(JSON.stringify(candidate('', 'STOP', [{ thought: true, text: secret } ])), 'EMPTY_RESPONSE');
  expectCode(JSON.stringify({ choices: [{ message: { content: secret } }] }), 'PROTOCOL_MISMATCH');
  expectCode(JSON.stringify({ error: { code: 403, message: secret } }), 'AUTH', 403);
  expectCode(JSON.stringify({ error: { message: secret } }), 'UPSTREAM');
  expectCode('<html>' + secret + '</html>', 'RESPONSE_FORMAT');
  expectCode('data: {broken ' + secret + '\n\n', 'RESPONSE_FORMAT');
  expectCode('', 'EMPTY_RESPONSE');

  const originalFetch = global.fetch;
  let responseBody = JSON.stringify(candidate(serialized));
  let calls = [];
  global.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    calls.push({ url: new URL(url), request });
    assert.equal(request.generationConfig.maxOutputTokens, GEMINI_MAX_OUTPUT_TOKENS);
    assert.equal(request.generationConfig.responseMimeType, 'application/json');
    assert.equal(new URL(url).pathname, '/v1beta/models/gemini-test:generateContent');
    return new Response(responseBody);
  };
  try {
    for (const body of [JSON.stringify(candidate(serialized)), JSON.stringify(fragments), sse(fragments)]) {
      responseBody = body;
      assert.equal((await testPrimaryAI(settings)).ok, true);
    }
    responseBody = JSON.stringify(candidate(serialized));
    assert.equal((await withPreviewSettings(settings, () => analyzeFoodImage('dGVzdA==', 'image/jpeg'))).totals.calories, 150);
    assert(calls.at(-1).request.contents[0].parts.some(part => part.inlineData?.data === 'dGVzdA=='));
    responseBody = sse([candidate(JSON.stringify({ exerciseType: 'walk', durationMin: 30, calories: 100 }))]);
    assert.equal((await withPreviewSettings(settings, () => analyzeExerciseText('walk', 60))).calories, 100);
    responseBody = JSON.stringify(candidate(JSON.stringify({ kind: 'FOOD', confidence: 0.9, reason: 'food' })));
    assert.equal((await withPreviewSettings(settings, () => classifyEntry({ description: 'milk' }))).kind, 'FOOD');
    responseBody = JSON.stringify(candidate('', 'MAX_TOKENS'));
    calls = [];
    await assert.rejects(testPrimaryAI({ ...settings, aiBackupBaseUrl: 'https://backup.invalid/v1', aiBackupModel: 'backup-chat', aiBackupApiKey: secret }), error => describeAITestFailure(error, 45000).code === 'OUTPUT_TRUNCATED');
    assert.equal(calls.length, 1, 'settings test must not silently succeed using backup');
    calls = [];
    global.fetch = async (url, init) => {
      const host = new URL(url).hostname;
      calls.push(host);
      if (host === 'example.invalid') return new Response(responseBody);
      assert.equal(host, 'backup.invalid');
      assert.equal(new URL(url).pathname, '/v1/chat/completions');
      assert.equal(JSON.parse(init.body).model, 'backup-chat');
      return new Response(JSON.stringify({ choices: [{ message: { content: serialized } }] }));
    };
    const backedUp = await withPreviewSettings({ ...settings, aiBackupProvider: 'openai_compat_chat', aiBackupBaseUrl: 'https://backup.invalid/v1', aiBackupModel: 'backup-chat', aiBackupApiKey: secret }, () => analyzeFoodText('milk'));
    assert.equal(backedUp.ai.model, 'backup-chat');
    assert.deepEqual(calls, ['example.invalid', 'backup.invalid']);
    assert.equal(getAIConfig().aiModel, original.aiModel);
    console.log('PASS: Gemini JSON/SSE/array reconstruction, thought filtering, safe finish diagnostics, all three adapters, primary-only test, backup fallback, unchanged global settings');
  } finally { global.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
