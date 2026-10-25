const assert = require('node:assert/strict');
Object.assign(process.env,{SQLITE_PATH:':memory:',JWT_SECRET:'autosave-test-only'});
const {db} = require('../dist/lib/db');
const {createToken} = require('../dist/middleware/auth');
const nutrition = require('../dist/services/aiNutrition');
const exercise = require('../dist/services/aiExercise');
const classifier = require('../dist/services/aiClassifier');
let calls=0, fail=false, imageFail=false, invalid=false;
const food={items:[{name:'milk',estimatedWeightGram:250,calories:150,proteinGram:8,carbsGram:12,fatGram:8}],totals:{calories:150,proteinGram:8,carbsGram:12,fatGram:8,fiberGram:0,sodiumMg:100,calciumMg:300},confidence:0.5,notes:'fixture',ai:{provider:'fixture',model:'test-model',route:'primary'}};
nutrition.analyzeFoodText=async()=>{calls++;if(fail)throw Error('fixture failure');return invalid?{...food,totals:{...food.totals,calories:-1}}:food;};
nutrition.analyzeFoodImage=async()=>{if(imageFail)throw Error('fixture image failure');return nutrition.analyzeFoodText();};
exercise.analyzeExerciseText=async()=>({exerciseType:'running',durationMin:30,intensity:'MODERATE',met:6,calories:200,confidence:0.4,notes:'fixture',ai:food.ai});
classifier.classifyEntry=async()=>({kind:'FOOD'});
const {recognitionRouter,recoverAutomaticSaves}=require('../dist/routes/recognition');
const express=require('express');
async function main(){
  for(const id of ['owner','other'])db.prepare('INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,id+'@example.test','unused',id,new Date().toISOString(),new Date().toISOString());
  const app=express();app.use(express.json());app.use('/jobs',recognitionRouter);app.use(require('../dist/middleware/error').errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/jobs';
  async function api(path,method='GET',body,user='owner'){
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+createToken({sub:user,email:user+'@example.test',displayName:user})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
  }
  const context={loggedAt:'2026-10-25T00:00:00Z',mealType:'BREAKFAST',visibility:'FRIENDS'};
  const request=(id,extra={})=>({requestId:id,operation:'entry',input:{mode:'FOOD',description:'milk',mimeType:'image/png'},context,...extra});
  async function submit(body){const r=await api('/jobs','POST',body);assert.equal(r.status,202);for(let i=0;i<100;i++){const job=(await api('/jobs/'+r.data.id)).data;if(['completed','failed'].includes(job.status))return job;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}
  try {
    const image='iVBORw0KGgo=';
    const body=request('automatic-photo',{input:{mode:'FOOD',description:'milk',imageBase64:image,mimeType:'image/png'},context:{...context,imageThumbnail:'data:image/png;base64,'+image}});
    const job=await submit(body);assert.equal(job.reviewState,'saved');assert.equal(job.phase,'已保存');
    const row=db.prepare('SELECT * FROM food_logs WHERE client_request_id=?').get('recognition-'+job.id);
    assert.equal(row.calories,150);assert.equal(row.visibility,'FRIENDS');assert.equal(row.logged_at,'2026-10-25T00:00:00.000Z');assert.equal(row.meal_type,'BREAKFAST');
    assert.equal(JSON.parse(row.nutrients_json).calciumMg,300);assert.equal(row.ai_model,'test-model');assert(row.note.includes('AI 估算'));assert(row.image_uri);
    assert.equal(db.prepare('SELECT input FROM recognition_jobs WHERE id=?').get(job.id).input,null);
    assert.equal((await api('/jobs')).data.jobs.length,0);
    assert.equal((await api('/jobs?includeSaved=1')).data.jobs[0].reviewState,'saved');
    assert.equal((await api('/jobs?includeSaved=1','GET',undefined,'other')).data.jobs.length,0);
    assert.equal((await api('/jobs/'+job.id+'/save-result','POST',{},'other')).status,404);
    const before=calls;assert.equal((await api('/jobs','POST',body)).data.reviewState,'saved');assert.equal(calls,before);
    assert.equal((await api('/jobs/'+job.id+'/save-result','POST')).status,200);assert.equal(db.prepare('SELECT count(*) n FROM food_logs').get().n,1);
    const sport=await submit(request('automatic-sport',{input:{mode:'EXERCISE',description:'running',mimeType:'image/jpeg'}}));assert.equal(sport.reviewState,'saved');assert.equal(db.prepare('SELECT calories FROM exercise_logs').get().calories,200);
    imageFail=true;const fallback=await submit({...body,requestId:'automatic-fallback'});imageFail=false;assert.equal(fallback.reviewState,'saved');assert.equal(fallback.result.fallback,'TEXT_ONLY');assert(db.prepare('SELECT note FROM food_logs WHERE client_request_id=?').get('recognition-'+fallback.id).note.includes('图片未成功解析'));
    const legacy=await submit(request('manual-legacy',{context:{...context,autoSave:false}}));assert.equal(legacy.reviewState,'pending');
    recoverAutomaticSaves();assert.equal((await api('/jobs/'+legacy.id)).data.reviewState,'pending');
    assert.equal((await api('/jobs/'+legacy.id+'/save-result','POST')).status,201);assert.equal((await api('/jobs/'+legacy.id+'/save-result','POST')).status,200);
    invalid=true;const broken=await submit(request('automatic-invalid'));invalid=false;assert.equal(broken.status,'completed');assert.equal(broken.reviewState,'pending');assert.equal(broken.phase,'保存未完成');assert(broken.message.includes('识别已完成'));
    assert(!db.prepare('SELECT id FROM food_logs WHERE client_request_id=?').get('recognition-'+broken.id));
    db.prepare('UPDATE recognition_jobs SET result=? WHERE id=?').run(JSON.stringify({kind:'FOOD',analysis:food}),broken.id);
    const callsBeforeRecovery=calls;recoverAutomaticSaves();assert.equal((await api('/jobs/'+broken.id)).data.reviewState,'saved');assert.equal(calls,callsBeforeRecovery);
    fail=true;const failed=await submit(request('automatic-failed'));fail=false;assert.equal(failed.status,'failed');assert.equal(failed.retryable,true);
    await api('/jobs/'+failed.id+'/retry','POST',{expectedAttempt:failed.attempts});
    for(let i=0;i<100;i++){if((await api('/jobs/'+failed.id)).data.reviewState==='saved')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal((await api('/jobs/'+failed.id)).data.reviewState,'saved');
    db.prepare('DELETE FROM food_logs WHERE id=?').run(row.id);assert.equal((await api('/jobs/'+job.id+'/save-result','POST')).status,409);
    assert(!db.prepare('SELECT id FROM food_logs WHERE id=?').get(row.id));
    console.log('PASS: unattended food/photo/exercise save, low confidence and fallback, nutrients and privacy, idempotency, no resurrection, old reviews, failed-save recovery without AI, failure/retry and account isolation');
  } finally {await new Promise(r=>server.close(r));db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
