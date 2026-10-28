import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

type Theme={surface:string;accent:string;accentSoft:string;text:string;textMuted:string;button:string;border:string;danger:string};
function Sheet({title,theme,onClose,children,busy=false}:{title:string;theme:Theme;onClose:()=>void;children:React.ReactNode;busy?:boolean}) {
  return <Modal visible transparent animationType='fade' onRequestClose={()=>{if(!busy)onClose();}}>
    <View style={{flex:1,justifyContent:'flex-end',alignItems:'center',backgroundColor:'rgba(0,0,0,0.38)'}}>
      <Pressable accessibilityLabel='关闭选择遮罩' disabled={busy} onPress={onClose} style={{position:'absolute',top:0,left:0,bottom:0,right:0}}/>
      <SafeAreaView edges={['bottom']} style={{width:'100%',maxWidth:520,backgroundColor:theme.surface,borderTopLeftRadius:8,borderTopRightRadius:8,padding:16,gap:12}}>
        <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Text style={{flex:1,color:theme.text,fontSize:18,fontWeight:'600'}}>{title}</Text><Pressable accessibilityLabel='关闭选择' disabled={busy} onPress={onClose} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name='close-outline' size={24} color={theme.text}/></Pressable></View>
        {children}
      </SafeAreaView>
    </View>
  </Modal>;
}
export function QuickFoodSheet({title,calories,date,visibility,theme,onClose,onSave}:{title:string;calories:number;date:string;visibility:string;theme:Theme;onClose:()=>void;onSave:(factor:number)=>Promise<void>}) {
  const [factor,setFactor]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState(''),[submitted,setSubmitted]=useState(false);
  const lock=useRef(false);
  return <Sheet title={title} theme={theme} onClose={()=>{if(!lock.current)onClose();}} busy={busy}>
    <Text style={{color:theme.textMuted}}>{date} · {visibility}</Text>
    <View style={{flexDirection:'row',gap:8}}>{([0.5,1,2] as const).map(value=><Pressable key={value} accessibilityRole='radio' accessibilityLabel={`${value}份`} accessibilityState={{checked:factor===value}} aria-checked={factor===value} disabled={busy||submitted} onPress={()=>setFactor(value)} style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',backgroundColor:factor===value?theme.accentSoft:theme.surface,borderWidth:1,borderColor:factor===value?theme.accent:theme.border,borderRadius:6}}><Text style={{color:theme.text}}>{value===0.5?'半份':value===1?'一份':'两份'}</Text></Pressable>)}</View>
    <Text style={{color:theme.text,fontSize:22,fontWeight:'600'}}>{Math.round(calories*factor*10)/10} kcal</Text>
    {!!error&&<Text accessibilityLiveRegion='polite' style={{color:theme.danger}}>{error}</Text>}
    <Pressable accessibilityRole='button' accessibilityLabel='记入常用餐食' disabled={busy} onPress={()=>{if(lock.current)return;lock.current=true;setSubmitted(true);setBusy(true);setError('');void onSave(factor).then(onClose).catch(e=>{lock.current=false;setBusy(false);setError(e instanceof Error?e.message:'暂未保存');});}} style={{minHeight:48,borderRadius:6,backgroundColor:theme.button,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8}}>{busy?<ActivityIndicator color='#ffffff'/>:<Ionicons name='add-outline' size={22} color='#ffffff'/>}<Text style={{color:'#ffffff'}}>记入这一餐</Text></Pressable>
  </Sheet>;
}
export function VisibilitySheet({value,options,theme,onChange,onClose}:{value:string;options:readonly {value:string;label:string}[];theme:Theme;onChange:(value:string)=>void;onClose:()=>void}) {
  return <Sheet title='可见范围' theme={theme} onClose={onClose}>{options.map(option=><Pressable key={option.value} accessibilityRole='radio' accessibilityLabel={`记录可见范围：${option.label}`} accessibilityState={{checked:value===option.value}} aria-checked={value===option.value} onPress={()=>{onChange(option.value);onClose();}} style={{minHeight:48,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:10,borderRadius:6,backgroundColor:value===option.value?theme.accentSoft:theme.surface}}><Ionicons name={option.value==='PRIVATE'?'lock-closed-outline':option.value==='FRIENDS'?'people-outline':'globe-outline'} size={20} color={theme.accent}/><Text style={{flex:1,color:theme.text}}>{option.label}</Text>{value===option.value&&<Ionicons name='checkmark' size={20} color={theme.accent}/>}</Pressable>)}</Sheet>;
}
