const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const path=require('node:path');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../RecordActions.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(props){
  const states=[],refs=[];let index=0;
  const module={exports:{}};
  const hooks={useState(initial){const i=index++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){const i=index++;return refs[i]??=( {current:initial} );}};
  vm.runInNewContext(code,{exports:module.exports,module,require(name){
    if(name==='react')return hooks;
    if(name==='react-native')return new Proxy({StyleSheet:{create:x=>x,absoluteFill:{},hairlineWidth:1}},{get:(o,k)=>o[k]??k});
    if(name==='react-native-safe-area-context')return{SafeAreaView:'SafeAreaView'};
    if(name==='@expo/vector-icons')return{Ionicons:'Ionicons'};
    return require(name);
  }});
  let tree;
  function render(){index=0;tree=module.exports.RecordActions(props);return tree;}
  function all(node,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){node.forEach(n=>all(n,result));return result;}result.push(node);all(node.props?.children,result);return result;}
  const button=label=>{render();const n=all(tree).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);assert.ok(n,label);return n.props;};
  return{render,button};
}
const theme={surface:'#fff',background:'#fff',border:'#ddd',text:'#222',textMuted:'#555',accent:'#315AD9',button:'#315AD9',accentSoft:'#eee',danger:'#B93847'};
const props={title:'Test meal',date:'2026-10-24',pending:false,theme,onClose(){},onEdit(){},async onDelete(){}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function main(){
  let calls=0,closes=0,finish;
  const h=harness({...props,onClose:()=>closes++,onDelete:()=>{calls++;return new Promise(r=>finish=r);}});
  h.button('删除记录').onPress();assert.equal(calls,0);
  const confirm=h.button('确认删除记录');confirm.onPress();confirm.onPress();assert.equal(calls,1);
  assert.equal(h.button('关闭记录操作').disabled,true);h.render().props.onRequestClose();assert.equal(closes,0);
  finish();await tick();assert.equal(closes,1);confirm.onPress();assert.equal(calls,1);
  let failures=0;
  const retry=harness({...props,onDelete:async()=>{if(++failures===1)throw Error('offline');}});
  retry.button('删除记录').onPress();retry.button('确认删除记录').onPress();await tick();
  assert.equal(retry.button('确认删除记录').disabled,false);retry.button('确认删除记录').onPress();await tick();assert.equal(failures,2);
  let repeats=0;
  const repeat=harness({...props,onRepeat:async()=>{repeats++;}});
  repeat.button('再记一次').onPress();assert.equal(repeats,0);repeat.button('确认再记一次').onPress();await tick();assert.equal(repeats,1);
  const pending=harness({...props,pending:true,onRepeat:async()=>{},onFavorite:async()=>{}});
  for(const label of ['编辑记录','删除记录','再记一次','收藏为常用餐食'])assert.equal(pending.button(label).disabled,true);
  const back=harness(props);back.button('删除记录').onPress();back.render().props.onRequestClose();assert.equal(back.button('编辑记录').disabled,false);
  console.log('PASS: one action entry, confirmation, double-click guard, busy/back lock, error retry, repeat confirmation and pending restrictions');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
