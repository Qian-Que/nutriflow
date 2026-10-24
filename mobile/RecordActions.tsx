import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

type Theme = {surface:string;background:string;border:string;text:string;textMuted:string;accent:string;button:string;accentSoft:string;danger:string};
export function RecordActions({title,pending,theme,date,favorite,onClose,onEdit,onDelete,onRepeat,onFavorite}: {
  title:string;pending:boolean;theme:Theme;date:string;favorite?:boolean;onClose:()=>void;onEdit:()=>void;
  onDelete:()=>Promise<void>;onRepeat?:()=>Promise<void>;onFavorite?:()=>Promise<void>;
}) {
  const [confirm,setConfirm] = useState<'delete'|'repeat'|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const running=useRef(false);
  const close=()=>{if(!running.current)onClose();};
  const run=async(action:()=>Promise<void>)=>{
    if(running.current)return;
    running.current=true;setBusy(true);setError('');
    try { await action();onClose(); }
    catch(error) {running.current=false;setBusy(false);setError(error instanceof Error?error.message:'操作未完成，请重试');}
  };
  const row=(label:string,icon:React.ComponentProps<typeof Ionicons>['name'],action:()=>void,danger=false)=>
    <Pressable accessibilityRole='button' accessibilityLabel={label} disabled={busy || pending} onPress={action} style={({pressed})=>[styles.action,{opacity:pending ? 0.4 : 1,backgroundColor:pressed?theme.accentSoft:'transparent',borderColor:theme.border}]}>
      <Ionicons name={icon} size={21} color={danger?theme.danger:theme.accent}/><Text style={{flex:1,color:danger?theme.danger:theme.text,fontSize:16}}>{label}</Text>
    </Pressable>;
  return <Modal visible transparent animationType='fade' onRequestClose={()=>{if(!running.current){if(confirm){setConfirm(null);setError('');}else onClose();}}}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel='关闭记录操作遮罩' style={StyleSheet.absoluteFill} onPress={close}/>
      <SafeAreaView edges={['bottom']} style={[styles.sheet,{backgroundColor:theme.surface}]}>
        <View style={[styles.header,{borderColor:theme.border}]}>
          <View style={{flex:1,gap:4}}><Text style={{color:theme.text,fontSize:18,fontWeight:'700'}}>{confirm==='delete'?'删除记录':confirm==='repeat'?'再记一次':'记录操作'}</Text><Text numberOfLines={2} style={{color:theme.textMuted,fontSize:13}}>{title}</Text></View>
          <Pressable accessibilityRole='button' accessibilityLabel='关闭记录操作' disabled={busy} onPress={close} style={styles.close}><Ionicons name='close' size={23} color={theme.text}/></Pressable>
        </View>
        <ScrollView contentContainerStyle={{padding:16,gap:8}}>
          {pending && <Text style={{color:theme.textMuted}}>这条记录正在同步，完成后可操作。</Text>}
          {confirm ? <>
            <Text style={{color:theme.text,lineHeight:24}}>{confirm==='delete'?'删除后无法恢复。确认删除这条记录？':`将这份餐食记到 ${date}，沿用原份量，不调用 AI。`}</Text>
            <View style={styles.buttons}>
              <Pressable accessibilityRole='button' disabled={busy} onPress={()=>{setConfirm(null);setError('');}} style={[styles.button,{borderColor:theme.border,borderWidth:1}]}><Text style={{color:theme.text}}>返回</Text></Pressable>
              <Pressable accessibilityRole='button' accessibilityLabel={confirm==='delete'?'确认删除记录':'确认再记一次'} disabled={busy} onPress={()=>void run(confirm==='delete'?onDelete:onRepeat!)} style={[styles.button,{backgroundColor:confirm==='delete'?'#B93847':theme.button}]}>
                {busy?<ActivityIndicator color='#ffffff'/>:<Ionicons name={confirm==='delete'?'trash-outline':'copy-outline'} size={18} color='#ffffff'/>}<Text style={{color:'#ffffff',fontWeight:'600'}}>{confirm==='delete'?'确认删除':'确认记录'}</Text>
              </Pressable>
            </View>
          </>:<>
            {row('编辑记录','create-outline',onEdit)}
            {onRepeat && row('再记一次','copy-outline',()=>setConfirm('repeat'))}
            {onFavorite && row(favorite?'取消常用餐食':'收藏为常用餐食',favorite?'star':'star-outline',()=>void run(onFavorite))}
            {row('删除记录','trash-outline',()=>setConfirm('delete'),true)}
          </>}
          {!!error && <Text accessibilityLiveRegion='polite' style={{color:theme.danger,lineHeight:22}}>{error}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}
const styles=StyleSheet.create({
  overlay:{flex:1,backgroundColor:'rgba(0,0,0,0.42)',justifyContent:'flex-end',alignItems:'center'},
  sheet:{width:'100%',maxWidth:520,maxHeight:'85%',borderTopLeftRadius:8,borderTopRightRadius:8},
  header:{flexDirection:'row',alignItems:'center',gap:12,padding:16,borderBottomWidth:1},close:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  action:{minHeight:52,flexDirection:'row',alignItems:'center',gap:14,paddingHorizontal:12,borderBottomWidth:StyleSheet.hairlineWidth},
  buttons:{flexDirection:'row',gap:12,marginTop:12},button:{flex:1,minHeight:48,borderRadius:6,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
});
