const assert = require('node:assert/strict');
Object.assign(process.env, {SQLITE_PATH:':memory:',JWT_SECRET:'isolated-test-key',RECOGNITION_TIMEOUT_MS:'1000',AI_PROVIDER:'gemini',AI_BASE_URL:'https://example.invalid/v1beta',AI_MODEL:'gemini-test',AI_API_KEY:'private-test-key',AI_BACKUP_BASE_URL:'',AI_BACKUP_MODEL:'',AI_BACKUP_API_KEY:''});
const {db}=require('../dist/lib/db');
const {createToken}=require('../dist/middleware/auth');
const {publicAIError}=require('../dist/lib/aiErrors');
const {allowWindow,consumeAIQuota,authLimit}=require('../dist/middleware/limits');
const express=require('express');
const originalFetch=global.fetch;
let calls=0, mode='success';
const analysis={kind:'FOOD',confidence:1,items:[{name:'milk',calories:150,proteinGram:8,carbsGram:12,fatGram:8}],totals:{calories:150,proteinGram:8,carbsGram:12,fatGram:8},notes:'test'};
global.fetch=async (url,init)=>{
  if(!String(url).startsWith('https://example.invalid')) return originalFetch(url,init);
  calls++;
  if(mode==='slow') await new Promise((resolve,reject)=>{ const timer=setTimeout(resolve,700);init.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true}); });
  const input=JSON.parse(init.body);
  if(mode==='fallback' && input.contents[0].parts.some(part=>part.inlineData)) return new Response('private-test-key should never leak',{status:500});
  return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(analysis)}]}}]}));
};
async function main(){
  for(const id of ['owner','other']) db.prepare('INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,id+'@example.test','unused',id,new Date().toISOString(),new Date().toISOString());
  const app=express(); app.use(express.json({limit:'10mb'}));
  app.use('/api/recognition',require('../dist/routes/recognition').recognitionRouter);
  app.use('/api/logs',require('../dist/routes/logs').logsRouter);
  app.use('/api/data',require('../dist/routes/data').dataRouter);
  app.use('/limited',authLimit,(_req,res)=>res.json({ok:true}));
  app.use(require('../dist/middleware/error').errorHandler);
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const token=id=>createToken({sub:id,email:id+'@example.test',displayName:id});
  async function api(path,method='GET',body,user='owner'){
    const r=await originalFetch(base+path,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+token(user)}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json()};
  }
  const wait=async id=>{for(let i=0;i<100;i++){const r=await api('/api/recognition/jobs/'+id);if(['completed','failed'].includes(r.data.status))return r.data;await new Promise(r=>setTimeout(r,30));}throw Error('job did not finish');};
  try{
    const input={mode:'FOOD',description:'milk'};
    const body={operation:'entry',requestId:'request-0001',input};
    assert.equal((await api('/api/recognition/jobs','POST',body,null)).status,401);
    const first=await api('/api/recognition/jobs','POST',body); assert.equal(first.status,202);
    const result=await wait(first.data.id);assert.equal(result.status,'completed');assert.equal(result.result.analysis.totals.calories,150);
    const retry=await api('/api/recognition/jobs','POST',body);assert.equal(retry.data.id,first.data.id);assert.equal(calls,1);
    assert.equal((await api('/api/recognition/jobs/'+first.data.id,'GET',undefined,'other')).status,404);
    assert.equal((await api('/api/recognition/jobs','POST',{...body,input:{...input,description:'changed'}})).status,409);
    mode='fallback';
    const fallback=await api('/api/recognition/jobs','POST',{...body,requestId:'request-0002',input:{...input,imageBase64:'dGVzdA==',mimeType:'image/jpeg'}});
    assert.equal((await wait(fallback.data.id)).result.fallback,'TEXT_ONLY');
    mode='slow';
    const slow=await api('/api/recognition/jobs','POST',{...body,requestId:'request-0003',input:{mode:'AUTO',description:'milk'}});
    const rejected=await api('/api/recognition/jobs','POST',{...body,requestId:'request-0004'});assert.equal(rejected.status,429);
    const timed=await wait(slow.data.id);assert.equal(timed.status,'failed');assert.equal(timed.result.status,504);
    assert.equal(db.prepare('SELECT input FROM recognition_jobs WHERE id=?').get(slow.data.id).input,null);
    const img='data:image/png;base64,iVBORw0KGgo=';
    const saved=await api('/api/logs','POST',{clientRequestId:'image-test-001',calories:100,proteinGram:2,carbsGram:10,fatGram:3,imageUri:img});
    assert.equal(saved.status,201);
    const compact=await api('/api/logs?compact=1');assert(!JSON.stringify(compact.data).includes('base64'));
    assert(db.prepare('SELECT image_uri FROM food_logs WHERE id=?').get(saved.data.log.id).image_uri.startsWith('/api/logs/'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM food_images').get().n,1);
    assert.equal((await api('/api/data/export')).data.foodLogs[0].image_uri,img);
    const url=compact.data.logs[0].imageUri;
    const photo=await originalFetch(base+url,{headers:{Authorization:'Bearer '+token('owner')}});assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/png');
    assert.equal((await api(url,'GET',undefined,'other')).status,404);
    const edited=await api('/api/logs/'+saved.data.log.id,'PUT',{calories:110,proteinGram:2,carbsGram:10,fatGram:3,imageUri:url});assert.equal(edited.status,200);assert.equal(edited.data.log.imageUri,img);
    assert.equal((await api('/api/logs','POST',{calories:100,proteinGram:2,carbsGram:10,fatGram:3,imageUri:url},'other')).status,400);
    for(let i=0;i<3;i++)await api('/api/logs','POST',{calories:100+i,proteinGram:2,carbsGram:10,fatGram:3});
    const paged=await api('/api/logs?limit=2&compact=1');assert.equal(paged.data.logs.length,2);assert.equal(paged.data.hasMore,true);
    assert.equal((await api('/api/logs?limit=2&offset=2&compact=1')).data.logs.length,2);
    assert(!publicAIError(new Error('private-test-key')).message.includes('private-test-key'));
    assert(allowWindow('window-test',1,60000));assert(!allowWindow('window-test',1,60000));
    process.env.AI_DAILY_LIMIT='1';assert(consumeAIQuota('quota-test'));assert(!consumeAIQuota('quota-test'));
    for(let i=0;i<30;i++) assert.equal((await api('/limited/login','POST',{})).status,200);
    assert.equal((await api('/limited/login','POST',{})).status,429);
    const {spawnSync}=require('node:child_process');
    const missingSecret=spawnSync(process.execPath,['-e',"require('./dist/config')"],{env:{...process.env,NODE_ENV:'production',JWT_SECRET:''},encoding:'utf8'});
    assert.notEqual(missingSecret.status,0);assert(missingSecret.stderr.includes('Production requires'));
    console.log('PASS: durable idempotent jobs, owner isolation, content conflict, shared deadline, concurrency, text fallback, input cleanup, private images, pagination, quotas and auth limits');
  }finally{global.fetch=originalFetch;await new Promise(r=>server.close(r));db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
