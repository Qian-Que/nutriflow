const assert = require('node:assert/strict');
const { parseRelease, latestRelease, releaseForClient } = require('../dist/routes/releases');
const fixture = { tag_name: 'v1.4.0', html_url: 'https://github.com/Qian-Que/nutrition-app/releases/tag/v1.4.0', published_at: '2026-10-23T00:00:00Z', assets: [{ state: 'uploaded', size: 123, browser_download_url: 'https://github.com/Qian-Que/nutrition-app/releases/download/v1.4.0/NutriFlow-v1.4.0-android.apk' }] };
assert.equal(parseRelease(fixture).version, '1.4.0');
const canonical = JSON.parse(JSON.stringify(fixture).replaceAll('Qian-Que/nutrition-app', 'Qian-Que/nutriflow'));
assert.deepEqual(parseRelease(fixture), parseRelease(canonical));
assert.equal(releaseForClient(parseRelease(canonical), false).url, fixture.html_url);
assert.equal(releaseForClient(parseRelease(canonical), true).url, canonical.html_url);
assert.throws(() => parseRelease({...canonical, assets:fixture.assets}));
for (const extra of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.4.0-rc1' }, { assets: [] }, { html_url: 'https://evil.example' }]) assert.throws(() => parseRelease({ ...fixture, ...extra }));
async function main() {
  let calls = 0;
  global.fetch = async (url, init) => { calls++; assert.equal(url, 'https://api.github.com/repos/Qian-Que/nutriflow/releases/latest'); assert.ok(init.signal); assert.equal(init.headers.Authorization, undefined); await new Promise(r => setTimeout(r, 10)); return { ok: true, json: async () => canonical }; };
  const results = await Promise.all([latestRelease(), latestRelease(), latestRelease()]);
  assert.equal(results[0].version, '1.4.0'); assert.equal(calls, 1);
  await latestRelease(); assert.equal(calls, 1);
  delete require.cache[require.resolve('../dist/routes/releases')];
  const failed = require('../dist/routes/releases');
  global.fetch = async () => { calls++; throw Error('unavailable'); };
  await assert.rejects(failed.latestRelease()); const count = calls;
  await assert.rejects(failed.latestRelease()); assert.equal(calls, count);
  console.log('PASS: published APK-only releases, origin validation, request coalescing, cache and failure backoff');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
