const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-ai-test-'));
  process.env.SQLITE_PATH = path.join(directory, 'test.db');
  const { getAIConfig } = require('../dist/lib/aiSettings');
  const { db } = require('../dist/lib/db');
  const { testPrimaryAI, describeAITestFailure } = require('../dist/services/aiSettingsTest');
  const original = getAIConfig();
  const settings = { ...original, aiProvider: 'gemini', aiBaseUrl: 'https://example.invalid/v1beta/models', aiModel: 'test-model', aiApiKey: 'test-secret', aiTimeoutMs: 45000 };
  const originalFetch = global.fetch;
  let calls = 0;
  let responseDelay = 21000;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(new URL(url).pathname, '/v1beta/models/test-model:generateContent');
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { init.signal.removeEventListener('abort', abort); resolve(); }, responseDelay);
      init.signal.addEventListener('abort', abort, { once: true });
    });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ name: 'milk', calories: 150, proteinGram: 8, carbsGram: 12, fatGram: 8 }], totals: { calories: 150, proteinGram: 8, carbsGram: 12, fatGram: 8 }, confidence: 0.8, notes: 'test' }) }] } }] }));
  };
  try {
    const pending = testPrimaryAI(settings);
    assert.equal(getAIConfig().aiModel, original.aiModel);
    const result = await pending;
    assert.equal(result.ok, true); assert(result.elapsedMs >= 20000); assert.equal(calls, 1);
    assert.equal(getAIConfig().aiModel, original.aiModel);
    responseDelay = 100;
    await assert.rejects(testPrimaryAI({ ...settings, aiTimeoutMs: 30 }), error => describeAITestFailure(error, 30).code === 'TIMEOUT');
    for (const [status, code] of [[401,'AUTH'],[403,'AUTH'],[404,'NOT_FOUND'],[429,'RATE_LIMIT'],[500,'UPSTREAM']]) {
      const diagnostic = describeAITestFailure(new Error(`AI 网络请求失败：https://example.invalid?key=test-secret；AI 接口调用失败（${status}）：test-secret`),45000);
      assert.equal(diagnostic.code,code); assert.equal(diagnostic.upstreamStatus,status); assert(!diagnostic.message.includes('test-secret'));
    }
    assert.equal(describeAITestFailure(new Error('AI 返回结果不是有效 JSON'),45000).code,'RESPONSE_FORMAT');
    assert.equal(describeAITestFailure(new Error('fetch failed ENOTFOUND'),45000).code,'NETWORK');
    console.log('PASS: 21-second Gemini response, configured timeout, unchanged global settings, single primary request, safe actionable diagnostics');
  } finally { global.fetch = originalFetch; db.close(); fs.rmSync(directory,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
