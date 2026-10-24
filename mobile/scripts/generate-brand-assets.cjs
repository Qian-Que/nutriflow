const fs=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..');
async function main(){
  const svg=await fs.readFile(path.join(root,'assets/brand-mark.svg'));
  const mark=await sharp(svg).png().toBuffer();
  await sharp(mark).flatten({background:'#F6F6F8'}).toFile(path.join(root,'assets/icon.png'));
  await sharp(mark).toFile(path.join(root,'assets/adaptive-icon.png'));
  await sharp(mark).toFile(path.join(root,'assets/splash-icon.png'));
  await sharp(mark).resize(64,64).flatten({background:'#F6F6F8'}).toFile(path.join(root,'assets/favicon.png'));
  // Expo prebuild owns platform-specific density, masking and splash resources.
  console.log('Generated NutriFlow icon, adaptive foreground, splash and favicon');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
