// 일회성 복구 스크립트: 탭 필터 상태에서 드래그 순서 변경 시 발생한 버그로 삭제된
// 컨설팅 설문 2개를 로컬 백업(! 설문데이터모음)에서 복원합니다.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, SCHEMA } = require('./db');

const BACKUP_DIR = 'C:\\Users\\anjel\\Documents\\Claude\\Projects\\! 설문데이터모음';

const SURVEYS = [
  {
    id: 's_1777565159143_u5xlxl',
    title: '2025 전기공사공제조합',
    category: 'consulting',
    createdAt: '2026-04-30T16:06:00.274+00:00',
    updatedAt: '2026-04-30T16:06:17.484+00:00',
    folder: '2025 전기공사공제조합'
  },
  {
    id: 's_1780663152730_w6zny5',
    title: '2026 현대자동차 울산공장 신축 본관 컨설팅',
    category: 'consulting',
    createdAt: '2026-06-05T12:39:13.703+00:00',
    updatedAt: '2026-06-12T03:16:38.222+00:00',
    folder: '2026 현대자동차 울산공장 신축 본관 컨설팅'
  }
];

const FILE_ROLES = ['codebook', 'value', 'label'];

(async () => {
  const client = await pool.connect();
  try {
    for (const survey of SURVEYS) {
      const existing = await client.query(`select 1 from ${SCHEMA}.surveys where id = $1`, [survey.id]);
      if (existing.rows.length) {
        console.log(`[스킵] ${survey.title} - 이미 존재함`);
        continue;
      }

      await client.query('begin');
      await client.query(
        `insert into ${SCHEMA}.surveys (id, title, created_at, updated_at, share_token, category)
         values ($1, $2, $3, $4, $5, $6)`,
        [survey.id, survey.title, survey.createdAt, survey.updatedAt, crypto.randomUUID(), survey.category]
      );
      for (const role of FILE_ROLES) {
        const filePath = path.join(BACKUP_DIR, survey.folder, `${role}.csv`);
        const content = fs.readFileSync(filePath, 'utf8');
        await client.query(
          `insert into ${SCHEMA}.survey_files (survey_id, file_role, content, original_name, file_size)
           values ($1, $2, $3, $4, $5)`,
          [survey.id, role, content, `${role}.csv`, Buffer.byteLength(content, 'utf8')]
        );
      }
      await client.query('commit');
      console.log(`[복구 완료] ${survey.title}`);
    }
  } catch (e) {
    await client.query('rollback');
    console.error('오류:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
