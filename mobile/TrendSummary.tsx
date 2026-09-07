import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

type Day = { date: string; count: number; calories: number; proteinGram: number };
export function TrendSummary({ token, request, theme, days, onDaysChange }: {
  token: string; request: <T>(path: string, init?: RequestInit, token?: string) => Promise<T>;
  theme: { text: string; textMuted: string; accent: string; accentSoft: string; border: string; exercise: string };
  days: number; onDaysChange: (days: number) => void;
}) {
  const [data, setData] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dates = Array.from({ length: days }, (_, i) => { const date = new Date(); date.setDate(date.getDate() - days + 1 + i); return dateString(date); });
  const months = [...new Set(dates.map(date => date.slice(0, 7)))].join(',');
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void Promise.all(months.split(',').map(month => request<{ days: Day[] }>(`/api/logs/calendar?month=${month}`, {}, token)))
      .then(results => { if (active) setData(results.flatMap(result => result.days)); })
      .catch(() => { if (active) setError('饮食趋势暂未加载'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [months, token, request]);
  const values = dates.map(date => data.find(row => row.date === date));
  const recorded = values.filter((row): row is Day => Boolean(row && row.count > 0));
  const maximum = Math.max(1, ...recorded.map(row => row.calories));
  return <View style={{ gap: 12, paddingVertical: 16, borderTopWidth: 1, borderTopColor: theme.border }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>饮食回顾</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>{[7, 30].map(value => <Pressable key={value} accessibilityRole='radio' accessibilityState={{ checked: days === value }} onPress={() => onDaysChange(value)} style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 8, backgroundColor: days === value ? theme.accentSoft : 'transparent' }}><Text style={{ color: days === value ? theme.accent : theme.textMuted }}>{value === 7 ? '周' : '月'}</Text></Pressable>)}</View>
    </View>
    {loading ? <ActivityIndicator color={theme.accent} /> : error ? <Text style={{ color: theme.textMuted }}>{error}</Text> : <>
      <Text style={{ color: theme.text }}>{recorded.length ? `已记录 ${recorded.length}/${days} 天 · 记录日平均 ${Math.round(recorded.reduce((total, row) => total + row.calories, 0) / recorded.length)} kcal` : '这个时段暂无饮食记录'}</Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
        {dates.map((date, i) => <View key={date} style={{ width: 36, height: 142, alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
          <Text style={{ color: theme.textMuted, fontSize: 10 }}>{values[i] ? Math.round(values[i]!.calories) : '—'}</Text>
          <View style={{ width: 18, height: values[i] ? Math.max(3, values[i]!.calories / maximum * 96) : 2, borderRadius: 3, backgroundColor: values[i] ? theme.exercise : theme.border }} />
          <Text style={{ color: theme.textMuted, fontSize: 10 }}>{date.slice(5)}</Text>
        </View>)}
      </ScrollView>
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>— 未记录</Text>
    </>}
  </View>;
}
