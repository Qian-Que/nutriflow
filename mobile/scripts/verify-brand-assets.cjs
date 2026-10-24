const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const sharp=require('sharp');
async function main(){
  const root=path.join(__dirname,'..');
  const config=require('../app.json').expo;
  assert.equal(config.android.package,'com.qianque1.nutritionassistantcn');
  assert.equal(config.splash.backgroundColor,'#F6F6F8');
  for(const name of ['icon','adaptive-icon','splash-icon','favicon']){
    const image=sharp(path.join(root,'assets',name+'.png'));
    const metadata=await image.metadata();assert.equal(metadata.width,name==='favicon'?64:1024);assert.equal(metadata.height,metadata.width);
    const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});let visible=0,green=0;
    for(let i=0;i<data.length;i+=info.channels){const[r,g,b,a]=data.subarray(i,i+4);if(a>128&&Math.max(r,g,b)-Math.min(r,g,b)>30){visible++;if(g>r&&g>b)green++;}}
    assert.ok(visible>metadata.width*metadata.height*.05,'mark must not be blank');assert.equal(green,0,'brand has no green');
    if(name==='adaptive-icon'||name==='splash-icon')assert.equal(data[3],0,'transparent foreground');
  }
  const source=fs.readFileSync(path.join(root,'App.tsx'),'utf8');
  assert.ok(!source.includes('openLogMoreActions'));assert.ok(!source.includes('openExerciseMoreActions'));
  for(const green of ['#26734f','#65b98b','#284c38','#164f36','#56b880','#65c68b'])assert.ok(!source.includes(green));
  console.log('PASS: brand dimensions, visible pixels, transparent foregrounds, no green and unchanged package identity');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
