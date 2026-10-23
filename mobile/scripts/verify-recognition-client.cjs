const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const cache=new Map();
const exportsObject={};
const source=fs.readFileSync(path.join(__dirname,'../recognitionClient.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:exportsObject,require:()=>({readCache:async(t,k)=>cache.get(t+k),writeCache:async(t,k,v)=>cache.set(t+k,structuredClone(v))}),setTimeout:resolve=>{resolve();},console,
});
async function main(){
  const {runRecognition,clearRecognition,RecognitionPendingError}=exportsObject;
  const jobs=new Map();let fail=true,calls=0;const ids=[];
  const transport=async(p,init)=>{
    if(init?.method==='POST'){
      const body=JSON.parse(init.body);ids.push(body.requestId);
      if(!jobs.has(body.requestId)){jobs.set(body.requestId,{id:body.requestId,status:'completed',phase:'完成',result:{analysis:{calories:100}}});calls++;}
      if(fail){fail=false;throw Error('response lost');}
      return jobs.get(body.requestId);
    }
    return jobs.get(p.split('/').at(-1));
  };
  const input={description:'milk',mode:'FOOD'};
  await assert.rejects(runRecognition(transport,'a','entry',input),e=>e instanceof RecognitionPendingError);
  assert.equal((await runRecognition(transport,'a','entry',input)).analysis.calories,100);
  assert.equal(ids[0],ids[1]);assert.equal(calls,1);
  await runRecognition(transport,'a','entry',input);assert.equal(calls,1);
  await clearRecognition('a','entry');await runRecognition(transport,'a','entry',input);assert.equal(calls,2);
  await runRecognition(transport,'b','entry',input);assert.equal(calls,3);
  console.log('PASS: lost-response recovery, stable request IDs, reuse completed results until saved, explicit new requests and account separation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
