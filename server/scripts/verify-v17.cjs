const assert=require('node:assert/strict');
Object.assign(process.env,{SQLITE_PATH:':memory:',JWT_SECRET:'v17-test-only',AI_PROVIDER:'gemini',AI_BASE_URL:'https://example.invalid/v1beta',AI_API_KEY:'test-only',AI_MODEL:'fixture'});
const {db}=require('../dist/lib/db');
const {createToken}=require('../dist/middleware/auth');
const ai=require('../dist/lib/aiSettings');
const food={items:[{name:'milk',calories:100,proteinGram:5,carbsGram:10,fatGram:4}],totals:{calories:100,proteinGram:5,carbsGram:10,fatGram:4},confidence:0.5,notes:'test',ai:{provider:'fixture',model:'fixture',route:'primary'}};
let images=0,lastImageRoute='';
const nutrition=require('../dist/services/aiNutrition');
nutrition.analyzeFoodText=async()=>{await new Promise(r=>setTimeout(r,250));return food;};
nutrition.analyzeFoodImage=async(base64,mime)=>{images++;lastImageRoute=ai.getAIConfig().aiBaseUrl;assert.equal(mime,'image/png');assert(base64);return food;};
require('../dist/services/aiExercise').analyzeExerciseText=async()=>({exerciseType:'running',durationMin:30,intensity:'MODERATE',met:6,calories:200,confidence:0.8,notes:'test'});
const express=require('express');
async function main(){
  for(const user of ['owner','other'])db.prepare('INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(user,user+'@example.test','unused',user,new Date().toISOString(),new Date().toISOString());
  db.prepare('INSERT INTO app_admins(user_id) VALUES(?)').run('owner');
  const app=express();app.use(express.json());app.use('/recognition',require('../dist/routes/recognition').recognitionRouter);app.use('/logs',require('../dist/routes/logs').logsRouter);app.use('/exercises',require('../dist/routes/exercises').exercisesRouter);app.use('/admin',require('../dist/routes/admin').adminRouter);app.use(require('../dist/middleware/error').errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const headers=user=>({'Content-Type':'application/json',Authorization:'Bearer '+createToken({sub:user,email:user+'@example.test',displayName:user})});
  async function api(path,method='GET',body,user='owner'){const r=await fetch(base+path,{method,headers:headers(user),...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};}
  const body=id=>({requestId:id,operation:'entry',input:{mode:'FOOD',description:'milk'},context:{loggedAt:'2026-10-28T03:00:00Z',mealType:'LUNCH',visibility:'PRIVATE'}});
  async function wait(id){for(let i=0;i<100;i++){const {data}=await api('/recognition/jobs/'+id);if(data.reviewState==='saved')return data;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}
  try{
    const original=ai.getAIConfig();
    const submitted=await api('/recognition/jobs','POST',body('v17-first'));
    const snapshot=(await api('/recognition/jobs?includeSaved=1')).data;
    const started=Date.now();
    const changed=await api('/recognition/changes?version='+snapshot.version);assert.equal(changed.data.changed,true);assert(Date.now()-started<3000);
    const job=await wait(submitted.data.id);assert(job.record.id);assert.equal(job.record.calories,100);
    assert.equal((await api('/recognition/jobs/'+job.id+'/record','GET',undefined,'other')).status,404);
    const record=(await api('/recognition/jobs/'+job.id+'/record')).data.log;
    const before=(await api('/recognition/jobs?includeSaved=1')).data;
    const editedEvent=api('/recognition/changes?version='+before.version);
    await new Promise(r=>setTimeout(r,40));
    const editedBody=Object.fromEntries(Object.entries({...record,calories:135}).filter(([,value])=>value!=null));
    assert.equal((await api('/logs/'+record.id,'PUT',editedBody)).status,200);
    assert.equal((await editedEvent).data.changed,true);
    const edited=(await api('/recognition/jobs/'+job.id)).data;
    assert.equal(edited.record.calories,135);assert.equal(edited.phase,'已编辑');
    assert.equal((await api('/recognition/jobs/'+job.id+'/undo','POST',{updatedAt:job.record.updatedAt})).status,409);
    assert.equal((await api('/recognition/jobs/'+job.id+'/undo','POST',{updatedAt:edited.record.updatedAt},'other')).status,404);
    assert.equal((await api('/recognition/jobs/'+job.id+'/undo','POST',{updatedAt:edited.record.updatedAt})).status,200);
    assert.equal((await api('/recognition/jobs/'+job.id+'/undo','POST',{updatedAt:edited.record.updatedAt})).status,200);
    const deleted=(await api('/recognition/jobs/'+job.id)).data;assert.equal(deleted.record.deleted,true);assert.equal(deleted.phase,'记录已删除');
    assert.equal((await api('/recognition/jobs/'+job.id+'/save-result','POST')).status,409);
    const sport=await api('/recognition/jobs','POST',{...body('v17-sport'),input:{mode:'EXERCISE',description:'running'}});
    const sportJob=await wait(sport.data.id);assert.equal(sportJob.record.kind,'EXERCISE');
    await api('/exercises/'+sportJob.record.id,'DELETE');assert.equal((await api('/recognition/jobs/'+sportJob.id)).data.record.deleted,true);
    const settings={aiProvider:'gemini',aiBaseUrl:'https://example.invalid/v1beta',aiModel:'fixture',aiApiKey:'test-key',aiImageDetail:'auto',aiTimeoutMs:5000,aiBackupProvider:'gemini',aiBackupBaseUrl:'https://backup.invalid/v1beta',aiBackupModel:'backup',aiBackupApiKey:'backup-key',aiBackupImageDetail:'',aiBackupTimeoutMs:5000};
    const test={settings,image:{imageBase64:'iVBORw0KGgo=',mimeType:'image/png'}};
    assert.equal((await api('/admin/ai-settings/test?kind=image','POST',test,'other')).status,403);
    assert.equal((await api('/admin/ai-settings/test?kind=image','POST',{settings})).status,400);
    const tested=await api('/admin/ai-settings/test?kind=image','POST',test);assert.equal(tested.status,200);assert.equal(tested.data.kind,'image');assert.equal(images,1);assert.equal(lastImageRoute,settings.aiBaseUrl);
    assert.equal((await api('/admin/ai-settings/test?kind=image&route=backup','POST',test)).status,200);assert.equal(lastImageRoute,settings.aiBackupBaseUrl);
    assert.deepEqual(ai.getAIConfig(),original);assert.equal(db.prepare('SELECT count(*) n FROM food_logs').get().n,0);
    const controller=new AbortController();const version=(await api('/recognition/jobs?includeSaved=1')).data.version;
    const pending=fetch(base+'/recognition/changes?version='+version,{headers:headers('owner'),signal:controller.signal}).catch(e=>e.name);
    await new Promise(r=>setTimeout(r,50));controller.abort();assert.equal(await pending,'AbortError');
    console.log('PASS: completion wakeup, live edited/deleted history, current record ACL, version-guarded/idempotent undo, exercise deletion, image test isolation and disconnect cleanup');
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
