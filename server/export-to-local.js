// 일회성 스크립트: 새 DB(app_260712_tosb)에 있는 설문 파일들을 로컬 폴더로 내려받습니다.
// 사용법: server 디렉터리에서 `node export-to-local.js`
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool, SCHEMA } = require('./db');

const OUTPUT_DIR = 'C:\\Users\\anjel\\Documents\\Claude\\Projects\\! 설문데이터모음';

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

(async () => {
  try {
    const surveysRes = await pool.query(`select id, title from ${SCHEMA}.surveys order by created_at`);
    const filesRes = await pool.query(`select survey_id, file_role, content from ${SCHEMA}.survey_files`);

    const filesBySurvey = new Map();
    filesRes.rows.forEach((f) => {
      if (!filesBySurvey.has(f.survey_id)) filesBySurvey.set(f.survey_id, {});
      filesBySurvey.get(f.survey_id)[f.file_role] = f.content;
    });

    for (const survey of surveysRes.rows) {
      const folderName = sanitize(survey.title) || survey.id;
      const dir = path.join(OUTPUT_DIR, folderName);
      fs.mkdirSync(dir, { recursive: true });

      const files = filesBySurvey.get(survey.id) || {};
      for (const role of ['codebook', 'value', 'label']) {
        if (files[role] == null) continue;
        fs.writeFileSync(path.join(dir, `${role}.csv`), files[role], 'utf8');
      }
      console.log(`[완료] ${survey.title} -> ${dir}`);
    }
    console.log('내보내기 완료.');
  } catch (e) {
    console.error('오류:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
