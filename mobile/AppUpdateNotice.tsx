import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CURRENT_VERSION, isNewerVersion, validateRelease, type AppRelease } from './appUpdate';

type Request = <T>(path: string, init?: RequestInit, token?: string, options?: { timeoutMs?: number }) => Promise<T>;
type Theme = { text: string; textMuted: string; accent: string; accentSoft: string; border: string };
export function useAppUpdate(request: Request, server: string) {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [checking, setChecking] = useState(false), [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState('');
  const busy = useRef(false), active = useRef(true);
  const nextAutoAttempt = useRef(0);
  const key = `nutrition:update:${server}`;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const check = useCallback(async (manual = false) => {
    if (busy.current || (!manual && Date.now() < nextAutoAttempt.current)) return;
    busy.current = true;
    try {
      let saved: any = null;
      try { saved = JSON.parse(await AsyncStorage.getItem(key) ?? 'null'); } catch { /* A broken cache must not prevent manual checks. */ }
      if (!active.current) return;
      setDismissed(saved?.dismissed ?? '');
      if (!manual && saved?.checkedAt > Date.now() - 6 * 3600000) {
        if (saved.release) { try { setRelease(validateRelease(saved.release)); } catch { /* Recheck on the next interval. */ } }
        return;
      }
      setChecking(true); if (manual) setMessage('');
      try {
        const next = validateRelease(await request('/api/releases/latest', {}, undefined, { timeoutMs: 7000 }));
        if (!active.current) return;
        setRelease(next);
        setMessage(isNewerVersion(next.version, CURRENT_VERSION) ? `新版本 v${next.version}` : '当前已是最新版本');
        await AsyncStorage.setItem(key, JSON.stringify({ release: next, checkedAt: Date.now(), dismissed: saved?.dismissed ?? '' })).catch(() => {});
      } catch {
        nextAutoAttempt.current = Date.now() + 3600000;
        if (active.current && manual) setMessage('暂时无法检查更新，请稍后重试');
        // Failures are not presented as "up to date" and do not erase an already discovered release.
      }
    } finally { busy.current = false; if (active.current) setChecking(false); }
  }, [key, request]);
  useEffect(() => {
    const timer = setTimeout(() => { if (AppState.currentState === 'active') void check(); }, 4000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [check]);
  const dismiss = async () => {
    if (!release) return;
    setDismissed(release.version);
    await AsyncStorage.setItem(key, JSON.stringify({ release, checkedAt: Date.now(), dismissed: release.version })).catch(() => {});
  };
  const open = async () => {
    try { if (release) await Linking.openURL(validateRelease(release).url); }
    catch { setMessage('无法打开发布页，请稍后重试'); }
  };
  return { release, checking, message, check, dismiss, open, available: Boolean(release && isNewerVersion(release.version, CURRENT_VERSION)), dismissed };
}
export type UpdateState = ReturnType<typeof useAppUpdate>;
export function AppUpdateNotice({ update, theme, compact = false }: { update: UpdateState; theme: Theme; compact?: boolean }) {
  if (compact && (!update.available || update.dismissed === update.release?.version)) return null;
  if (compact) return <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: theme.accentSoft }}>
    <Pressable accessibilityRole='button' onPress={() => void update.open()} style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Ionicons name='arrow-up-circle-outline' size={20} color={theme.accent} /><Text style={{ color: theme.text, flex: 1 }}>新版本 v{update.release?.version}</Text><Ionicons name='chevron-forward' size={18} color={theme.accent} /></Pressable>
    <Pressable accessibilityLabel='不再提醒此版本' onPress={() => void update.dismiss()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name='close-outline' size={20} color={theme.text} /></Pressable>
  </View>;
  return <View style={{ padding: compact ? 8 : 0, gap: 8, backgroundColor: compact ? theme.accentSoft : undefined }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name='arrow-up-circle-outline' size={20} color={theme.accent} />
      <Text style={{ flex: 1, color: theme.text }}>{compact ? `新版本 v${update.release?.version}` : `当前版本 v${CURRENT_VERSION}`}</Text>
      {compact && <Pressable accessibilityLabel='稍后提醒此版本' onPress={() => void update.dismiss()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name='close-outline' size={20} color={theme.text} /></Pressable>}
    </View>
    {!compact && !!update.message && <Text accessibilityLiveRegion='polite' style={{ color: theme.textMuted }}>{update.message}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {!compact && <Pressable disabled={update.checking} accessibilityRole='button' onPress={() => void update.check(true)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name='refresh-outline' size={18} color={theme.accent} /><Text style={{ color: theme.accent }}>{update.checking ? '检查中' : '检查更新'}</Text></Pressable>}
      {update.available && <Pressable accessibilityRole='button' onPress={() => void update.open()} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name='download-outline' size={18} color={theme.accent} /><Text style={{ color: theme.accent }}>查看新版 APK</Text></Pressable>}
    </View>
  </View>;
}
