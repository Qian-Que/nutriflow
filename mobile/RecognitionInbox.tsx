import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RecordImage } from './RecordImage';
import type { BackgroundJob, JobTimings, UploadTicket } from './backgroundRecognition';

type Theme = {background:string;surface:string;border:string;text:string;textMuted:string;accent:string;accentSoft:string;danger:string};
const seconds = (value: number | null) => value === null ? '未测得' : `${(value/1000).toFixed(1)} 秒`;
const jobDate = (value: string) => { const d=new Date(value); const pad=(n:number)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function TimingDetails({timings,color}: {timings:JobTimings;color:string}) {
  return <Text style={{color,fontSize:12,lineHeight:19}}>上传确认 {seconds(timings.uploadMs)} · 排队 {seconds(timings.queueMs)}{timings.classificationMs > 0 ? ` · 判类 ${seconds(timings.classificationMs)}` : ''}{timings.recognitionMs > 0 ? ` · 识别 ${seconds(timings.recognitionMs)}` : ''}{timings.fallbackMs > 0 ? ` · 文字降级 ${seconds(timings.fallbackMs)}` : ''}</Text>;
}
export function RecognitionInbox({jobs,ticket,busy,message,theme,baseUrl,token,onClose,onOpen,onSave,onRetry,onDiscard,onRetryUpload,onCancelUpload,onRefresh}: {
  jobs:BackgroundJob[];ticket:UploadTicket|null;busy:boolean;message:string;theme:Theme;baseUrl:string;token:string;
  onClose:()=>void;onOpen:(job:BackgroundJob)=>void;onRetry:(job:BackgroundJob)=>void;onDiscard:(job:BackgroundJob)=>void;onRetryUpload:()=>void;onCancelUpload:()=>void;onRefresh:()=>void;
  onSave:(job:BackgroundJob)=>Promise<void>;
}) {
  const [filter,setFilter] = useState('all');
  const [saving,setSaving] = useState<string|null>(null);
  const visible = jobs.filter(job => filter === 'all' || (filter === 'active' ? ['queued','running'].includes(job.status) : job.status === filter));
  return <Modal visible animationType='slide' onRequestClose={onClose}>
    <SafeAreaView style={{flex:1,backgroundColor:theme.background}}>
      <View style={[styles.header,{borderColor:theme.border}]}><Text style={{flex:1,fontSize:20,fontWeight:'700',color:theme.text}}>识别任务</Text>
        <Pressable accessibilityLabel='刷新识别任务' onPress={onRefresh} style={styles.icon}><Ionicons name='refresh-outline' size={22} color={theme.accent}/></Pressable>
        <Pressable accessibilityLabel='关闭识别任务' onPress={onClose} style={styles.icon}><Ionicons name='close-outline' size={24} color={theme.text}/></Pressable>
      </View>
      <View style={styles.filters}>{[['all','全部'],['active','处理中'],['completed','已识别'],['failed','失败']].map(([value,label]) => <Pressable key={value} accessibilityRole='tab' accessibilityState={{selected:filter===value}} aria-selected={filter===value} onPress={()=>setFilter(value!)} style={[styles.filter,{borderBottomColor:filter===value?theme.accent:'transparent'}]}><Text style={{color:filter===value?theme.accent:theme.textMuted}}>{label}</Text></Pressable>)}</View>
      <ScrollView contentContainerStyle={styles.content}>
        {!!message && <Text accessibilityLiveRegion='polite' style={{color:theme.textMuted,lineHeight:21}}>{message}</Text>}
        {ticket && <View style={[styles.item,{borderColor:theme.border}]}><Text style={{color:theme.text,fontWeight:'600'}}>{busy ? '上传中，请等待确认' : '上传尚未确认'}</Text><Text numberOfLines={2} style={{color:theme.textMuted}}>{ticket.input.description || '照片记录'}</Text>
          <Pressable accessibilityRole='button' disabled={busy} onPress={onRetryUpload} style={styles.action}><Ionicons name='cloud-upload-outline' size={20} color={theme.accent}/><Text style={{color:theme.accent}}>重试上传</Text></Pressable>
          <Pressable accessibilityRole='button' disabled={busy} onPress={onCancelUpload} style={styles.action}><Ionicons name='close-outline' size={20} color={theme.danger}/><Text style={{color:theme.danger}}>取消上传，保留原文</Text></Pressable>
        </View>}
        {!visible.length && <Text style={{color:theme.textMuted,paddingVertical:24}}>暂无{filter==='completed'?'识别结果':'任务'}</Text>}
        {visible.map(job => <View key={job.id} style={[styles.item,{borderColor:theme.border}]}>
          <View style={styles.row}>
            {job.context.hasImage && job.reviewState!=='saved' && <RecordImage uri={`/api/recognition/jobs/${job.id}/image?size=thumb`} baseUrl={baseUrl} token={token} style={{width:54,height:54,borderRadius:6}}/>}
            <View style={{flex:1,gap:5}}><Text style={{color:theme.text,fontSize:15,fontWeight:'600'}} numberOfLines={2}>{job.context.description || '照片记录'}</Text><Text style={{color:theme.textMuted,fontSize:12}}>{jobDate(job.record?.loggedAt ?? job.context.loggedAt)}</Text><Text style={{color:job.status==='failed'?theme.danger:theme.textMuted,fontSize:12}}>{job.phase}{job.status==='running' ? ` · 已处理 ${seconds(job.timings.processingMs)}` : ''}{job.attempts>1 ? ` · 第 ${job.attempts} 次` : ''}</Text></View>
            {['running','queued'].includes(job.status) && <ActivityIndicator color={theme.accent}/>}
          </View>
          <TimingDetails timings={job.timings} color={theme.textMuted}/>
          {job.reviewState==='saved' && !job.record?.deleted && <Text style={{color:theme.text}}>当前记录 · {Math.round(job.record?.calories ?? job.result?.analysis?.totals?.calories ?? job.result?.analysis?.calories ?? 0)} 千卡</Text>}
          {!!job.message && <Text style={{color:theme.danger,lineHeight:21}}>{job.message}</Text>}
          <View style={styles.row}>
            {job.reviewState==='saved' && !job.record?.deleted && <Pressable accessibilityRole='button' accessibilityLabel={`编辑已保存记录：${job.context.description || '照片记录'}`} onPress={()=>onOpen(job)} style={styles.action}><Ionicons name='create-outline' size={19} color={theme.accent}/><Text style={{color:theme.accent}}>编辑记录</Text></Pressable>}
            {job.status==='completed' && job.reviewState==='pending' && <>
              <Pressable disabled={Boolean(saving)} accessibilityRole='button' accessibilityLabel={`直接保存：${job.context.description || '照片记录'}`} onPress={()=>{setSaving(job.id);void onSave(job).finally(()=>setSaving(null));}} style={styles.action}>{saving===job.id?<ActivityIndicator color={theme.accent}/>:<Ionicons name='checkmark-outline' size={19} color={theme.accent}/>}<Text style={{color:theme.accent}}>直接保存</Text></Pressable>
              <Pressable disabled={Boolean(saving)} accessibilityRole='button' accessibilityLabel={`编辑：${job.context.description || '照片记录'}`} onPress={()=>onOpen(job)} style={styles.action}><Ionicons name='create-outline' size={19} color={theme.accent}/><Text style={{color:theme.accent}}>编辑</Text></Pressable>
            </>}
            {job.retryable && <Pressable accessibilityRole='button' accessibilityLabel={`重试：${job.context.description || '照片记录'}`} onPress={()=>onRetry(job)} style={styles.action}><Ionicons name='refresh-outline' size={19} color={theme.accent}/><Text style={{color:theme.accent}}>重新识别</Text></Pressable>}
            {job.status!=='running' && job.reviewState!=='saved' && <Pressable disabled={Boolean(saving)} accessibilityLabel={`放弃任务：${job.context.description || '照片记录'}`} onPress={()=>onDiscard(job)} style={[styles.icon,{marginLeft:'auto'}]}><Ionicons name='trash-outline' size={20} color={theme.danger}/></Pressable>}
          </View>
        </View>)}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
const styles=StyleSheet.create({
  header:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,minHeight:60,borderBottomWidth:1},icon:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  filters:{flexDirection:'row',paddingHorizontal:12},filter:{flex:1,minHeight:46,alignItems:'center',justifyContent:'center',borderBottomWidth:2},
  content:{width:'100%',maxWidth:640,alignSelf:'center',padding:16,gap:12},item:{borderBottomWidth:1,paddingVertical:12,gap:10},row:{flexDirection:'row',alignItems:'center',gap:10},action:{minHeight:44,flexDirection:'row',alignItems:'center',gap:7,paddingHorizontal:6},
});
