import { Router } from 'express';

const repoUrl = 'https://github.com/Qian-Que/nutriflow';
const legacyRepoUrl = 'https://github.com/Qian-Que/nutrition-app';
export function parseRelease(data: any) {
  if (data?.draft || data?.prerelease || !/^v\d+\.\d+\.\d+$/.test(data?.tag_name ?? '')) throw new Error('Not a stable release');
  const version = data.tag_name.slice(1);
  const url = `${repoUrl}/releases/tag/v${version}`;
  const apkUrl = `${repoUrl}/releases/download/v${version}/NutriFlow-v${version}-android.apk`;
  const source = [repoUrl, legacyRepoUrl].find(root => data.html_url === `${root}/releases/tag/v${version}`);
  const asset = source && data.assets?.find((item: any) => item.browser_download_url === `${source}/releases/download/v${version}/NutriFlow-v${version}-android.apk` && item.state === 'uploaded' && item.size > 0);
  if (!asset) throw new Error('Release asset is unavailable');
  return { version, url, apkUrl, size: asset.size, publishedAt: data.published_at };
}
type Release = ReturnType<typeof parseRelease>;
let cached: Release | null = null;
let expires = 0;
let inFlight: Promise<Release> | null = null;
export async function latestRelease() {
  if (Date.now() < expires) {
    if (cached) return cached;
    throw new Error('Release check unavailable');
  }
  if (!inFlight) inFlight = (async () => {
    try {
      const response = await fetch('https://api.github.com/repos/Qian-Que/nutriflow/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NutriFlow-update-check' }, signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Release check unavailable');
      cached = parseRelease(await response.json()); expires = Date.now() + 300000;
      return cached;
    } catch (error) { cached = null; expires = Date.now() + 30000; throw error; }
    finally { inFlight = null; }
  })();
  return inFlight;
}
export const releasesRouter = Router();
export function releaseForClient(release: Release, canonical: boolean) {
  // Versions 1.4/1.5 only allow the previous repository URL, which GitHub redirects.
  const root = canonical ? repoUrl : legacyRepoUrl;
  return {...release, url:`${root}/releases/tag/v${release.version}`, apkUrl:`${root}/releases/download/v${release.version}/NutriFlow-v${release.version}-android.apk`};
}
releasesRouter.get('/latest', async (req, res) => {
  try { res.set('Cache-Control', 'public, max-age=60').json(releaseForClient(await latestRelease(), req.query.format === '2')); }
  catch { res.set('Cache-Control', 'no-store').status(503).json({ message: '暂时无法检查更新，请稍后重试' }); }
});
