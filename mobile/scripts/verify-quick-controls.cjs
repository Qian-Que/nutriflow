const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const states=[],refs=[];let index=0,calls=0,closed=0,finish;
const hooks={useState(initial){const i=index++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){const i=index++;return refs[i]??={current:initial};}};
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../QuickRecordControls.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:exportsObject,require(name){if(name==='react')return hooks;if(name==='react-native')return{ActivityIndicator:'ActivityIndicator',Modal:'Modal',Pressable:'Pressable',Text:'Text',View:'View'};if(name==='react-native-safe-area-context')return{SafeAreaView:'SafeAreaView'};if(name==='@expo/vector-icons')return{Ionicons:'Ionicons'};return require(name);}});
const props={title:'milk',calories:100,date:'2026-10-28',visibility:'private',theme:{},onClose:()=>closed++,onSave:async factor=>{calls++;assert.equal(factor,0.5);await new Promise(r=>finish=r);}};
function render(){index=0;return exportsObject.QuickFoodSheet(props);}
function find(node,label){if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const item of node){const found=find(item,label);if(found)return found;}return;}if(node.props?.accessibilityLabel===label)return node;return find(node.props?.children,label);}
async function main(){
  find(render(),'0.5份').props.onPress();let tree=render();const save=find(tree,'记入常用餐食');save.props.onPress();save.props.onPress();tree.props.onClose();assert.equal(calls,1);assert.equal(closed,0);
  assert.equal(find(render(),'1份').props.disabled,true);finish();await new Promise(r=>setImmediate(r));assert.equal(closed,1);
  console.log('PASS: portion selection, same-frame double-tap lock, back/overlay lock while saving and close after success');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
