import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AppUpdateNotice, type UpdateState } from './AppUpdateNotice';
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

type Theme = { background: string; surface: string; border: string; text: string; textMuted: string; accent: string; button:string; input: string; accentSoft: string; activeText: string };
type Request = <T>(path: string, init?: RequestInit, token?: string, options?: { timeoutMs?: number }) => Promise<T>;
type Settings = {
  aiProvider: string; aiBaseUrl: string; aiModel: string; aiApiKey?: string; aiImageDetail: string; aiTimeoutMs: number;
  aiBackupProvider: string; aiBackupBaseUrl: string; aiBackupModel: string; aiBackupApiKey?: string; aiBackupImageDetail: string; aiBackupTimeoutMs: number;
  hasApiKey?: boolean; hasBackupApiKey?: boolean; source?: string; updatedAt?: string | null;
};
const providers = [{ value: 'openai_compat_auto', label: '兼容·自动' }, { value: 'openai_compat_chat', label: '兼容·Chat' }, { value: 'openai', label: 'OpenAI' }, { value: 'gemini', label: 'Gemini' }];

export function SettingsPanel({ token, email, request, theme, onClose, onLogout, mode, onModeChange, update }: {
  update: UpdateState;
  token: string; email: string; request: Request; theme: Theme; onClose: () => void; onLogout: () => void;
  mode: 'day' | 'night'; onModeChange: (mode: 'day' | 'night') => void;
}) {
  const [admin, setAdmin] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [backup, setBackup] = useState(false);
  const [timings, setTimings] = useState<{ route: string; model: string; server: number; total: number }[]>([]);
  const text = { color: theme.text };
  const muted = { color: theme.textMuted };
  const button = [styles.button, { borderColor: theme.border, backgroundColor: theme.surface }];
  const apply = (data: Settings) => { setSettings({ ...data, aiApiKey: '', aiBackupApiKey: '' }); setBackup(Boolean(data.aiBackupModel || data.aiBackupBaseUrl || data.hasBackupApiKey)); };
  const load = async () => {
    setLoading(true);
    try {
      const access = await request<{ isAdmin: boolean }>('/api/admin/access', {}, token, { timeoutMs: 8000 });
      setAdmin(access.isAdmin);
      if (access.isAdmin) apply(await request<Settings>('/api/admin/ai-settings', {}, token));
    } catch { setMessage('设置暂未加载，请检查网络后重试'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token]);
  const payload = () => {
    if (!settings) throw new Error('设置未加载');
    const { hasApiKey, hasBackupApiKey, source, updatedAt, ...editable } = settings;
    return { ...editable,
      aiBackupBaseUrl: backup ? editable.aiBackupBaseUrl : '', aiBackupModel: backup ? editable.aiBackupModel : '',
      aiBackupApiKey: backup ? editable.aiBackupApiKey : '', clearBackupKey: !backup,
    };
  };
  const action = async (kind: 'save' | 'test' | 'testBackup' | 'reset' | 'export') => {
    setBusy(true); setMessage('');
    try {
      if (kind === 'export') {
        const data = await request('/api/data/export', {}, token);
        const path = `${FileSystem.cacheDirectory}nutrition-${Date.now()}.json`;
        await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: '导出我的记录' });
        else throw new Error('当前设备不支持文件分享');
      } else if (kind === 'test' || kind === 'testBackup') {
        const draft = payload();
        const route = kind === 'testBackup' ? 'backup' : 'primary';
        const label = route === 'backup' ? '备用线路' : '主线路';
        // Compatibility mode may try Responses followed by Chat Completions.
        const timeoutMs = Math.max(60000, (route === 'backup' ? draft.aiBackupTimeoutMs || draft.aiTimeoutMs : draft.aiTimeoutMs) * 2 + 15000);
        const start = Date.now();
        const result = await request<{ elapsedMs: number; model: string }>(`/api/admin/ai-settings/test?route=${route}`, { method: 'POST', body: JSON.stringify(draft) }, token, { timeoutMs });
        setTimings(current => [{ route: label, model: result.model, server: result.elapsedMs, total: Date.now() - start }, ...current].slice(0, 4));
        setMessage(`${label}文字测试通过；配置未发布`);
      } else {
        const data = await request<Settings>('/api/admin/ai-settings', { method: kind === 'save' ? 'PUT' : 'DELETE', ...(kind === 'save' ? { body: JSON.stringify(payload()) } : {}) }, token);
        apply(data);
        setMessage(kind === 'save' ? '已保存，所有用户的新识别请求立即生效' : '已恢复服务器环境配置');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  };
  const field = (label: string, key: keyof Settings, secret = false, numeric = false) => <View key={key} style={styles.field}>
    <Text style={[styles.label, muted]}>{label}</Text>
    <TextInput accessibilityLabel={label} editable={!busy} secureTextEntry={secret} autoCapitalize='none' autoCorrect={false}
      keyboardType={numeric ? 'number-pad' : 'default'} value={String(settings?.[key] ?? '')}
      placeholder={secret ? '留空保留已配置密钥' : ''} placeholderTextColor={theme.textMuted}
      onChangeText={value => setSettings(current => current ? { ...current, [key]: numeric ? Number(value) : value } : current)}
      style={[styles.input, text, { backgroundColor: theme.input, borderColor: theme.border }]} />
  </View>;
  const options = (key: 'aiProvider' | 'aiBackupProvider' | 'aiImageDetail') => <View style={styles.row}>
    {(key === 'aiImageDetail' ? [{ value: 'auto', label: '自动' }, { value: 'low', label: '标准' }, { value: 'high', label: '精细' }] : providers).map(option => <Pressable key={option.value} disabled={busy} accessibilityRole='radio' accessibilityState={{ checked: settings?.[key] === option.value }}
      onPress={() => setSettings(current => current ? { ...current, [key]: option.value } : current)}
      style={[button, settings?.[key] === option.value && { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
      <Text style={settings?.[key] === option.value ? { color: theme.activeText } : text}>{option.label}</Text>
    </Pressable>)}
  </View>;
  return <Modal visible animationType='slide' onRequestClose={onClose}>
    <SafeAreaProvider>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.title, text]}>设置</Text>
        <Pressable accessibilityLabel='关闭设置' onPress={onClose} style={styles.icon}><Ionicons name='close-outline' size={24} color={theme.text} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
        <Text style={muted}>{email}</Text>
        <AppUpdateNotice update={update} theme={theme} />
        <View style={styles.row}>
          <Pressable accessibilityLabel='切换日夜主题' onPress={() => onModeChange(mode === 'day' ? 'night' : 'day')} style={button}><Ionicons name={mode === 'day' ? 'sunny-outline' : 'moon-outline'} size={20} color={theme.accent} /></Pressable>
          <Pressable disabled={busy} onPress={() => void action('export')} style={button}><Ionicons name='download-outline' size={18} color={theme.accent} /><Text style={text}>导出我的数据</Text></Pressable>
        </View>
        {loading && <ActivityIndicator color={theme.accent} />}
        {!!message && <Text accessibilityLiveRegion='polite' style={[styles.message, text, { backgroundColor: theme.accentSoft }]}>{message}</Text>}
        {timings.map((timing, index) => <View key={index} style={{ borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 10, gap: 4 }}>
          <Text style={text}>{timing.route} · {timing.model}</Text>
          <Text style={muted}>后端识别 {(timing.server / 1000).toFixed(1)} 秒 · 总等待 {(timing.total / 1000).toFixed(1)} 秒</Text>
        </View>)}
        {!loading && !settings && <Pressable onPress={() => void load()} style={button}><Ionicons name='refresh-outline' size={18} color={theme.accent} /><Text style={text}>刷新设置</Text></Pressable>}
        {admin && settings && <View style={[styles.section, { borderTopColor: theme.border }]}>
          <Text style={[styles.title, text]}>全局 AI</Text>
          <Text style={muted}>仅管理员可修改 · 对所有用户生效</Text>
          <Text style={muted}>{settings.source === 'database' ? '当前使用在线配置' : '当前使用服务器环境配置'}</Text>
          <Text style={[styles.subheading, text]}>主线路</Text>
          {options('aiProvider')}
          {field('接口地址', 'aiBaseUrl')}
          {field('模型名称', 'aiModel')}
          {field(`API 密钥${settings.hasApiKey ? '（已配置）' : '（未配置）'}`, 'aiApiKey', true)}
          <Text style={[styles.label, muted]}>图片精细度</Text>{options('aiImageDetail')}
          {field('超时时间（毫秒，5000–120000）', 'aiTimeoutMs', false, true)}
          <Pressable accessibilityRole='switch' accessibilityState={{ checked: backup }} disabled={busy} onPress={() => setBackup(value => !value)} style={[styles.row, { paddingVertical: 12 }]}>
            <Ionicons name={backup ? 'checkbox' : 'square-outline'} size={22} color={theme.accent} /><Text style={text}>启用备用线路</Text>
          </Pressable>
          {backup && <>
            {options('aiBackupProvider')}
            {field('备用接口地址', 'aiBackupBaseUrl')}
            {field('备用模型', 'aiBackupModel')}
            {field(`备用密钥${settings.hasBackupApiKey ? '（已配置）' : ''}`, 'aiBackupApiKey', true)}
            {field('备用超时（毫秒，0 为跟随主线路）', 'aiBackupTimeoutMs', false, true)}
          </>}
          <View style={styles.row}>
            <Pressable disabled={busy} onPress={() => void action('test')} style={button}><Ionicons name='pulse-outline' size={18} color={theme.accent} /><Text style={text}>测试主线路</Text></Pressable>
            {backup && <Pressable disabled={busy} onPress={() => void action('testBackup')} style={button}><Ionicons name='pulse-outline' size={18} color={theme.accent} /><Text style={text}>测试备用线路</Text></Pressable>}
            <Pressable disabled={busy} onPress={() => Alert.alert('发布全局配置', '保存后，所有用户的新识别请求将使用此配置。', [{ text: '取消', style: 'cancel' }, { text: '保存生效', onPress: () => void action('save') }])} style={[button, { backgroundColor: theme.button }]}><Ionicons name='save-outline' size={18} color='#ffffff' /><Text style={{ color: '#ffffff' }}>保存生效</Text></Pressable>
          </View>
          <Pressable disabled={busy} onPress={() => Alert.alert('恢复环境配置', '将移除在线配置，恢复服务器中设置的主、备用模型。', [{ text: '取消', style: 'cancel' }, { text: '恢复', onPress: () => void action('reset') }])} style={button}><Ionicons name='arrow-undo-outline' size={18} color={theme.accent} /><Text style={text}>恢复环境配置</Text></Pressable>
        </View>}
        {busy && <ActivityIndicator color={theme.accent} />}
        <Pressable disabled={busy} onPress={() => Alert.alert('退出登录', '本机待同步记录会保留，重新登录相同账号后可继续同步。', [{ text: '取消', style: 'cancel' }, { text: '退出', onPress: onLogout }])} style={button}><Ionicons name='log-out-outline' size={18} color={theme.accent} /><Text style={text}>退出登录</Text></Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1 },
  title: { fontSize: 20, fontWeight: '700' }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 16, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  field: { gap: 6, marginVertical: 8 }, label: { fontSize: 13 }, input: { borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 10, fontSize: 15 },
  section: { borderTopWidth: 1, paddingTop: 20, gap: 10 }, subheading: { fontSize: 16, fontWeight: '600', marginTop: 12 }, message: { padding: 12, lineHeight: 22, borderRadius: 8 },
});
