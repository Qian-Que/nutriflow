// Before downgrading below 1.3.0: back up the database, stop writes, then run this script.
const {db}=require('../dist/lib/db');
const {inlineImage}=require('../dist/lib/logImages');
let count=0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of db.prepare("SELECT id,image_uri FROM food_logs WHERE image_uri LIKE '/api/logs/%/image'").all()) {
    const data=inlineImage(row.image_uri);
    if (!data) throw new Error('Image data missing for '+row.id);
    db.prepare('UPDATE food_logs SET image_uri=? WHERE id=?').run(data,row.id); count++;
  }
  db.exec('COMMIT'); console.log('Restored inline images:',count);
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
