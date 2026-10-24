import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TimingDetails } from './RecognitionInbox';
import { changeReviewItem, needsReviewAcknowledgement, nutrientFields, reviewBody, scaleReview, removeReviewItem, type ReviewDraft } from './recognitionDraft';

type Theme = { background: string; surface: string; border: string; text: string; textMuted: string; accent: string; button:string; input: string; accentSoft: string; danger: string };
export function RecognitionReview({ draft, theme, busy, onChange, onClose, onDiscard, onSave }: {
  draft: ReviewDraft; theme: Theme; busy: boolean; onChange: (value: ReviewDraft) => void;
  onClose: () => void; onDiscard: () => void; onSave: () => void;
}) {
  const [error, setError] = useState('');
  const locked = busy || Boolean(draft.submitted);
  const text = { color: theme.text }, muted = { color: theme.textMuted };
  const change = (next: ReviewDraft) => { setError(''); onChange(next); };
  const field = (label: string, value: unknown, update: (value: string) => void, number = false, full = false) => <View key={label} style={full ? styles.fullField : styles.field}>
    <Text style={[styles.label, muted]}>{label}</Text>
    <TextInput accessibilityLabel={label} value={String(value ?? '')} editable={!locked} onChangeText={update}
      keyboardType={number ? 'decimal-pad' : 'default'} maxLength={number ? 10 : label === '备注' ? 300 : label === '运动名称' ? 60 : 100}
      style={[styles.input, text, { backgroundColor: theme.input, borderColor: theme.border }]} />
  </View>;
  const setBody = (key: string, value: string) => change({ ...draft, body: { ...draft.body, [key]: value } });
  return <Modal visible animationType='slide' onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
        <View style={[styles.header, { borderColor: theme.border }]}>
          <View style={{ flex: 1, gap: 3 }}><Text style={[styles.title, text]}>校对{draft.kind === 'FOOD' ? '饮食' : '运动'}</Text><Text style={muted}>{new Date(draft.body.loggedAt).toLocaleDateString('zh-CN')} · 尚未记入统计</Text></View>
          <Pressable accessibilityLabel='暂存并关闭校对' disabled={busy} onPress={onClose} style={styles.icon}><Ionicons name='close-outline' size={24} color={theme.text} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps='handled' keyboardDismissMode='on-drag' contentContainerStyle={styles.content}>
          {draft.timings && <TimingDetails timings={draft.timings} color={theme.textMuted}/>}
          {needsReviewAcknowledgement(draft) && <View style={[styles.warning, { borderColor: theme.danger }]}>
            <Ionicons name='alert-circle-outline' size={20} color={theme.danger} />
            <Text style={[text, { flex: 1, lineHeight: 22 }]}>{draft.fallback === 'TEXT_ONLY' ? '图片未解析成功，本次仅按文字估算。' : '本次识别把握较低，请核对名称和份量。'}</Text>
          </View>}
          <View style={[styles.summary, { backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.calories, text]}>{Math.round(Number(draft.body.calories) || 0)} <Text style={styles.label}>kcal</Text></Text>
            <Text style={muted}>{draft.kind === 'FOOD' ? `蛋白质 ${draft.body.proteinGram} g · 碳水 ${draft.body.carbsGram} g · 脂肪 ${draft.body.fatGram} g` : `${draft.body.durationMin} 分钟`}</Text>
          </View>
          {draft.kind === 'FOOD' ? <>
            <View style={styles.row}>
              {[{ label: '减半', factor: 0.5, icon: 'remove-outline' }, { label: '加倍', factor: 2, icon: 'add-outline' }].map(option => <Pressable key={option.label} disabled={locked} accessibilityLabel={`总份量${option.label}`} style={[styles.button, { borderColor: theme.border }]} onPress={() => {
                try { change(scaleReview(draft, option.factor)); } catch (e) { setError((e as Error).message); }
              }}><Ionicons name={option.icon as any} size={18} color={theme.accent} /><Text style={text}>{option.label}</Text></Pressable>)}
            </View>
            {draft.body.items.map((item: any, index: number) => <View key={index} style={[styles.item, { borderColor: theme.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={[styles.subtitle, text]}>食物 {index + 1}</Text>
                {draft.body.items.length > 1 && <Pressable accessibilityLabel={`移除食物${index + 1}`} disabled={locked} onPress={() => change(removeReviewItem(draft, index))} style={styles.icon}><Ionicons name='trash-outline' size={20} color={theme.danger} /></Pressable>}
              </View>
              {field(`食物${index + 1}名称`, item.name, value => change(changeReviewItem(draft, index, 'name', value)), false, true)}
              <View style={styles.row}>
                {field(`食物${index + 1}克数`, item.estimatedWeightGram, value => change(changeReviewItem(draft, index, 'estimatedWeightGram', value)), true)}
                {nutrientFields.map(([key, label, unit]) => field(`食物${index + 1}${label} (${unit})`, item[key] ?? 0, value => change(changeReviewItem(draft, index, key, value)), true))}
              </View>
            </View>)}
            <Pressable accessibilityLabel='补充遗漏食物' disabled={locked || draft.body.items.length >= 30} style={styles.check} onPress={() => change({ ...draft, body: { ...draft.body, items: [...draft.body.items, { name: '', calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 }] } })}><Ionicons name='add-outline' size={20} color={theme.accent} /><Text style={text}>补充食物</Text></Pressable>
            <View style={styles.row}>{[['BREAKFAST', '早餐'], ['LUNCH', '午餐'], ['DINNER', '晚餐'], ['SNACK', '加餐']].map(([value, label]) => <Pressable key={value} accessibilityRole='radio' accessibilityState={{ checked: draft.body.mealType === value }} disabled={locked} onPress={() => setBody('mealType', value)} style={[styles.button, { borderColor: theme.border, backgroundColor: draft.body.mealType === value ? theme.accentSoft : theme.surface }]}><Text style={text}>{label}</Text></Pressable>)}</View>
          </> : <>
            {field('运动名称', draft.body.exerciseType, value => setBody('exerciseType', value), false, true)}
            <View style={styles.row}>{field('时长 (分钟)', draft.body.durationMin, value => setBody('durationMin', value), true)}{field('消耗 (kcal)', draft.body.calories, value => setBody('calories', value), true)}{field('MET', draft.body.met, value => setBody('met', value), true)}</View>
          </>}
          {field('备注', draft.body.note, value => setBody('note', value), false, true)}
          <View style={styles.row}>{[['PRIVATE', '仅自己'], ['FRIENDS', '好友'], ['PUBLIC', '公开']].map(([value, label]) => <Pressable key={value} accessibilityRole='radio' accessibilityState={{ checked: draft.body.visibility === value }} disabled={locked} onPress={() => setBody('visibility', value)} style={[styles.button, { borderColor: theme.border, backgroundColor: draft.body.visibility === value ? theme.accentSoft : theme.surface }]}><Text style={text}>{label}</Text></Pressable>)}</View>
          {needsReviewAcknowledgement(draft) && <Pressable accessibilityRole='checkbox' accessibilityLabel='已核对不确定的识别结果' aria-checked={draft.acknowledged} accessibilityState={{ checked: draft.acknowledged }} disabled={locked} onPress={() => change({ ...draft, acknowledged: !draft.acknowledged })} style={styles.check}>
            <Ionicons name={draft.acknowledged ? 'checkbox' : 'square-outline'} size={24} color={theme.accent} /><Text style={[text, { flex: 1 }]}>已核对不确定的识别结果</Text>
          </Pressable>}
          <Pressable disabled={locked} accessibilityLabel='放弃本次识别结果' onPress={onDiscard} style={styles.check}><Ionicons name='trash-outline' size={20} color={theme.danger} /><Text style={{ color: theme.danger }}>{draft.jobId ? '放弃这条结果' : '放弃结果，返回修改描述'}</Text></Pressable>
        </ScrollView>
        <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          {!!error && <Text accessibilityRole='alert' style={{ color: theme.danger, marginBottom: 8 }}>{error}</Text>}
          <Pressable disabled={busy} accessibilityLabel='确认保存记录' onPress={() => { try { reviewBody(draft); setError(''); onSave(); } catch (e) { setError((e as Error).message); } }} style={[styles.save, { backgroundColor: theme.button, opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator color='#ffffff' /> : <Ionicons name='checkmark-outline' size={22} color='#ffffff' />}<Text style={{ color:'#ffffff', fontWeight: '700' }}>{busy ? '保存中' : draft.submitted ? '重试保存' : '确认保存'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  header: { padding: 16, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { fontSize: 20, fontWeight: '700' }, subtitle: { fontSize: 15, fontWeight: '600' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 16, gap: 16 },
  warning: { flexDirection: 'row', gap: 8, borderLeftWidth: 3, paddingLeft: 10 }, summary: { padding: 14, gap: 6 }, calories: { fontSize: 28, fontWeight: '700' }, label: { fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, field: { width: '47%', gap: 6 }, fullField: { width: '100%', gap: 6 }, input: { minHeight: 46, borderWidth: 1, borderRadius: 6, padding: 10, fontSize: 16 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }, item: { borderTopWidth: 1, paddingTop: 16, gap: 10 },
  check: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }, footer: { padding: 12, borderTopWidth: 1 }, save: { minHeight: 48, borderRadius: 6, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
});
