export const CURRENT_VERSION = '1.7.0';
export type AppRelease = { version: string; url: string; apkUrl: string; size: number; publishedAt: string };
export function isNewerVersion(next: string, current: string) {
  if (!/^\d+\.\d+\.\d+$/.test(next) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = next.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
export function validateRelease(value: any): AppRelease {
  if (!/^\d+\.\d+\.\d+$/.test(value?.version ?? '')) throw new Error('版本信息无效');
  const root = 'https://github.com/Qian-Que/nutriflow/releases';
  const roots = [root, 'https://github.com/Qian-Que/nutrition-app/releases'];
  if (!roots.some(source => value.url === `${source}/tag/v${value.version}` && value.apkUrl === `${source}/download/v${value.version}/NutriFlow-v${value.version}-android.apk`) || !(value.size > 0)) throw new Error('更新来源无效');
  return {...value, url:`${root}/tag/v${value.version}`, apkUrl:`${root}/download/v${value.version}/NutriFlow-v${value.version}-android.apk`};
}
