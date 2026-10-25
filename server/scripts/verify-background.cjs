const assert = require('node:assert/strict');
Object.assign(process.env,{SQLITE_PATH:':memory:',JWT_SECRET:'background-test-only',RECOGNITION_TIMEOUT_MS:'10000',AI_PROVIDER:'gemini',AI_BASE_URL:'https://example.invalid/v1beta',AI_MODEL:'background-test',AI_API_KEY:'test-only',AI_BACKUP_BASE_URL:'',AI_BACKUP_MODEL:'',AI_BACKUP_API_KEY:''});
const {db}=require('../dist/lib/db');
const {createToken}=require('../dist/middleware/auth');
const express=require('express');
const originalFetch=global.fetch;
let calls=0, mode='success', inFlight=0, peak=0;
global.fetch=async(url,init)=>{
  if(!String(url).startsWith('https://example.invalid/'))return originalFetch(url,init);
  calls++;inFlight++;peak=Math.max(peak,inFlight);
  await new Promise(r=>setTimeout(r,100));inFlight--;
  if(mode==='fail')return new Response('upstream failure',{status:500});
  const analysis={kind:'FOOD',confidence:0.6,items:[{name:'milk',estimatedWeightGram:200,calories:150,proteinGram:8,carbsGram:12,fatGram:8}],totals:{calories:150,proteinGram:8,carbsGram:12,fatGram:8},notes:'fixture'};
  return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(analysis)}]}}]}));
};
async function main(){
  for(const id of ['owner','other','queue'])db.prepare('INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,id+'@example.test','unused',id,new Date().toISOString(),new Date().toISOString());
  const app=express();app.use(express.json({limit:'10mb'}));app.use('/api/recognition',require('../dist/routes/recognition').recognitionRouter);app.use('/api/logs',require('../dist/routes/logs').logsRouter);app.use(require('../dist/middleware/error').errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const headers=user=>({'Content-Type':'application/json',...(user?{Authorization:'Bearer '+createToken({sub:user,email:user+'@example.test',displayName:user})}:{})});
  async function api(path,method='GET',body,user='owner'){const r=await originalFetch(base+'/api/recognition'+path,{method,headers:headers(user),...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
  const context={loggedAt:'2026-10-23T04:00:00Z',mealType:'LUNCH',visibility:'PRIVATE',autoSave:false,imageThumbnail:'data:image/png;base64,iVBORw0KGgo='};
  const body=(id,image=true)=>({requestId:id,operation:'entry',input:{mode:'AUTO',description:'milk',...(image?{imageBase64:'iVBORw0KGgo=',mimeType:'image/png'}:{})},context});
  const wait=async(id,user='owner')=>{for(let i=0;i<200;i++){const r=await api('/jobs/'+id,'GET',undefined,user);if(['completed','failed'].includes(r.data.status))return r.data;await new Promise(r=>setTimeout(r,20));}throw Error('timeout');};
  try{
    const submitted=await api('/jobs','POST',body('background-001'));assert.equal(submitted.status,202);
    assert.equal(db.prepare('SELECT count(*) AS n FROM food_logs').get().n,0);
    const job=await wait(submitted.data.id);assert.equal(job.status,'completed');assert.equal(job.context.loggedAt,context.loggedAt);
    assert(job.timings.classificationMs>=80 && job.timings.recognitionMs>=80);assert(job.timings.queueMs>=0);
    assert(db.prepare('SELECT input FROM recognition_jobs WHERE id=?').get(job.id).input);
    const listed=await api('/jobs');assert.equal(listed.data.jobs.length,1);assert(!JSON.stringify(listed.data).includes('base64'));
    assert.equal((await api('/jobs','GET',undefined,'other')).data.jobs.length,0);
    assert.equal((await api('/jobs/'+job.id,'GET',undefined,'other')).status,404);
    assert.equal((await api('/jobs','GET',undefined,null)).status,401);
    const image=await originalFetch(base+'/api/recognition/jobs/'+job.id+'/image?size=thumb',{headers:headers('owner')});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
    assert.equal((await api('/jobs/'+job.id+'/image','GET',undefined,'other')).status,404);
    await api('/jobs/'+job.id+'/timing','PATCH',{uploadMs:200});await api('/jobs/'+job.id+'/timing','PATCH',{uploadMs:300});assert.equal((await api('/jobs/'+job.id)).data.timings.uploadMs,200);
    const confirm={loggedAt:context.loggedAt,mealType:'LUNCH',visibility:'PRIVATE',calories:75,proteinGram:4,carbsGram:6,fatGram:4,items:[{name:'corrected',estimatedWeightGram:100,calories:75,proteinGram:4,carbsGram:6,fatGram:4}],acknowledged:true};
    assert.equal((await api('/jobs/'+job.id+'/confirm','POST',{...confirm,acknowledged:false})).status,400);
    assert.equal((await api('/jobs/'+job.id+'/confirm','POST',{...confirm,calories:-1})).status,400);
    assert.equal((await api('/jobs/'+job.id)).data.reviewState,'pending');
    const saved=await api('/jobs/'+job.id+'/confirm','POST',confirm);assert.equal(saved.status,201);assert.equal(saved.data.log.clientRequestId,'recognition-'+job.id);assert(saved.data.log.imageUri.startsWith('/api/logs/'));
    const twice=await api('/jobs/'+job.id+'/confirm','POST',{...confirm,calories:999});assert.equal(twice.status,200);assert.equal(twice.data.log.calories,75);
    assert.equal(db.prepare('SELECT count(*) AS n FROM food_logs').get().n,1);assert.equal((await api('/jobs')).data.jobs.length,0);assert.equal(db.prepare('SELECT input FROM recognition_jobs WHERE id=?').get(job.id).input,null);
    assert.equal((await api('/jobs/'+job.id+'/image')).status,404);
    assert.equal((await api('/jobs','POST',body('background-001'))).data.reviewState,'saved');
    const beforeCancel=calls;
    assert.equal((await api('/uploads/cancel-before-arrival','DELETE')).status,200);
    const cancelled=await api('/jobs','POST',body('cancel-before-arrival'));assert.equal(cancelled.data.reviewState,'dismissed');assert.equal(calls,beforeCancel);
    const old={...body('legacy-ticket-001',false)};delete old.context;
    const legacy=await api('/jobs','POST',old);await wait(legacy.data.id);const count=calls;
    const adopted=await api('/jobs','POST',{...old,context});assert.equal(adopted.data.id,legacy.data.id);assert.equal(adopted.data.reviewState,'pending');assert.equal(calls,count);
    await api('/jobs/'+legacy.data.id,'DELETE');assert.equal((await api('/jobs/'+legacy.data.id+'/confirm','POST',confirm)).status,409);
    mode='fail';const failed=await api('/jobs','POST',body('background-fail-01',false));const failure=await wait(failed.data.id);assert.equal(failure.status,'failed');assert.equal(failure.retryable,true);
    mode='success';await api('/jobs/'+failure.id+'/retry','POST',{expectedAttempt:failure.attempts});await api('/jobs/'+failure.id+'/retry','POST',{expectedAttempt:failure.attempts});const retried=await wait(failure.id);assert.equal(retried.attempts,2);
    const before=calls;await api('/jobs/'+failure.id+'/retry','POST',{expectedAttempt:failure.attempts});assert.equal(calls,before);
    const queued=[];peak=0;
    for(let i=0;i<5;i++){const r=await api('/jobs','POST',body('queue-ticket-'+i,false),'queue');assert.equal(r.status,202);queued.push(r.data.id);}
    assert.equal((await api('/jobs','POST',body('queue-ticket-6',false),'queue')).status,429);
    for(const id of queued)await wait(id,'queue');assert.equal(peak,1);
    for(const [id,status,attempts] of [['restart-queued','queued',0],['restart-running','running',1],['restart-exhausted','running',2]])db.prepare("INSERT INTO recognition_jobs (id,user_id,request_id,fingerprint,operation,input,status,phase,created_at,context,review_state,attempts) VALUES (?,'owner',?,'hash','entry','{}',?,'fixture',?,'{}','pending',?)").run(id,id,status,Date.now(),attempts);
    require('../dist/lib/recognitionJobs').recoverRecognitionJobs();
    assert.equal(db.prepare('SELECT status FROM recognition_jobs WHERE id=?').get('restart-queued').status,'queued');assert.equal(db.prepare('SELECT status FROM recognition_jobs WHERE id=?').get('restart-running').status,'queued');assert.equal(db.prepare('SELECT status FROM recognition_jobs WHERE id=?').get('restart-exhausted').status,'failed');
    console.log('PASS: background persistence, pending list and photo ACL, stage timing, atomic confirmation, stable IDs, legacy adoption, idempotent retry, bounded fair queue and restart recovery');
  }finally{global.fetch=originalFetch;await new Promise(r=>server.close(r));db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
