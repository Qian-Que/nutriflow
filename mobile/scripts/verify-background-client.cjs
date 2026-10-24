const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const cache=new Map(),drafts=new Map(),jobs=new Map();let posts=0,drop=false;
const storage={readCache:async(t,k)=>structuredClone(cache.get(t+k)??null),writeCache:async(t,k,v)=>cache.set(t+k,structuredClone(v)),updateCache:async(t,k,fn)=>{const v=fn(cache.get(t+k)??null);cache.set(t+k,structuredClone(v));return v;},readDraft:async t=>drafts.get(t),writeDraft:async(t,v)=>drafts.set(t,v)};
function moduleInstance(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../backgroundRecognition.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>storage,Date,Map,Promise,Math});return exports;}
const transport=async(p,init,token)=>{
  if(init?.method==='PATCH')return {ok:true};
  const ticket=JSON.parse(init.body),key=token+ticket.requestId;
  if(!jobs.has(key)){posts++;jobs.set(key,{id:'job-'+posts,requestId:ticket.requestId,status:'queued',reviewState:'pending',context:ticket.context,timings:{uploadMs:null,queueMs:0,classificationMs:0,recognitionMs:0,fallbackMs:0,processingMs:null}});}
  if(drop){drop=false;throw Error('lost response');}return jobs.get(key);
};
async function main(){
  let api=moduleInstance();const input={mode:'FOOD',description:'milk',mimeType:'image/jpeg'},context={loggedAt:'2026-10-23T00:00:00Z',mealType:'BREAKFAST',visibility:'PRIVATE'};
  drafts.set('a',{text:'milk',imageBase64:null,mimeType:'image/jpeg',date:'2026-10-23'});
  const ticket=await api.prepareUpload('a',input,context);drop=true;await assert.rejects(api.uploadRecognition(transport,'a',ticket));
  assert.equal(drafts.get('a').text,'milk');assert(await storage.readCache('a',api.UPLOAD_CACHE));
  await assert.rejects(api.prepareUpload('a',{...input,description:'different'},context));
  api=moduleInstance();const recovered=await api.recoverUpload(transport,'a',[]);assert.equal(recovered.ticket.requestId,ticket.requestId);assert.equal(posts,1);assert.equal(drafts.get('a').text,'');assert.equal(await storage.readCache('a',api.UPLOAD_CACHE),null);
  const next=await api.prepareUpload('a',input,context);assert.notEqual(next.requestId,ticket.requestId);
  drafts.set('a',{text:'next meal in progress',imageBase64:null,mimeType:'image/jpeg'});
  await Promise.all([api.uploadRecognition(transport,'a',next),api.uploadRecognition(transport,'a',next)]);assert.equal(posts,2);assert.equal(drafts.get('a').text,'next meal in progress');
  assert.equal((await storage.readCache('a',api.JOBS_CACHE)).length,2);
  const other=await api.prepareUpload('b',input,context);await api.uploadRecognition(transport,'b',other);assert.equal((await storage.readCache('a',api.JOBS_CACHE)).length,2);assert.equal((await storage.readCache('b',api.JOBS_CACHE)).length,1);
  const list=await api.mergeJobList('a',[{...jobs.get('a'+next.requestId),timings:{uploadMs:null,queueMs:200}}]);assert.notEqual(list[0].timings.uploadMs,null);assert.equal(list[0].timings.queueMs,200);
  console.log('PASS: persisted upload ticket, lost-response and restart recovery, no duplicate uploads, safe composer clearing, multiple tasks and account isolation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
