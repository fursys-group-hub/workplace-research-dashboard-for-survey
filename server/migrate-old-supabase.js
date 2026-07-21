// 일회성 마이그레이션 스크립트: 개인 Supabase Storage에 남아있던 설문 파일 +
// Table Editor 스크린샷으로 확인한 메타데이터를 회사 Postgres(app_260712_tosb)로 옮깁니다.
// 사용법: server 디렉터리에서 `node migrate-old-supabase.js`
require('dotenv').config();

const crypto = require('crypto');
const { pool, SCHEMA } = require('./db');

const OLD_SUPABASE_URL = 'https://anryotqsnrhsonpsrdbw.supabase.co';
const OLD_BUCKET = 'survey-files';

// Table Editor 스크린샷에서 그대로 옮긴 메타데이터 (중복/고아 폴더 kop2vm, 7g978b, ku9ixa 제외)
const SURVEYS = [
  { id: 's_1777564881153_bb4pva', title: '2024-2025 인식 DB', createdAt: '2026-04-30T16:01:22.013+00:00', updatedAt: '2026-05-19T09:49:25.681+00:00' },
  { id: 's_1777565042612_g2qddu', title: '2023 인식 DB', createdAt: '2026-04-30T16:04:04.032+00:00', updatedAt: '2026-05-04T18:31:19.916+00:00' },
  { id: 's_1777565159143_u5xlxl', title: '2025 전기공사공제조합', createdAt: '2026-04-30T16:06:00.274+00:00', updatedAt: '2026-04-30T16:06:17.484+00:00' },
  { id: 's_1778262001561_9y1c69', title: '2022 인식 DB', createdAt: '2026-05-08T17:40:03.041+00:00', updatedAt: '2026-05-09T09:34:05.208+00:00' },
  { id: 's_1778503319726_1h9ax0', title: '2021 인식 DB', createdAt: '2026-05-11T12:42:00.787+00:00', updatedAt: '2026-05-12T09:48:08.018+00:00' },
  { id: 's_1778577670487_giqdp1', title: '2020 인식 DB', createdAt: '2026-05-12T09:21:11.376+00:00', updatedAt: '2026-05-12T09:48:38.636+00:00' },
  { id: 's_1780663152730_w6zny5', title: '2026 현대자동차 울산공장 신축 본관 컨설팅', createdAt: '2026-06-05T12:39:13.703+00:00', updatedAt: '2026-06-12T03:16:38.222+00:00' }
];

const FILE_ROLES = ['codebook', 'value', 'label'];

async function fetchOldFile(surveyId, role) {
  const url = `${OLD_SUPABASE_URL}/storage/v1/object/public/${OLD_BUCKET}/shared/${surveyId}/${role}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${role}.csv 다운로드 실패 (${res.status})`);
  return res.text();
}

async function migrateSurvey(client, survey) {
  const existing = await client.query(`select 1 from ${SCHEMA}.surveys where id = $1`, [survey.id]);
  if (existing.rows.length) {
    console.log(`[스킵] ${survey.id} (${survey.title}) - 이미 존재함`);
    return;
  }

  const files = {};
  for (const role of FILE_ROLES) {
    const content = await fetchOldFile(survey.id, role);
    files[role] = { content, size: Buffer.byteLength(content, 'utf8') };
  }

  await client.query('begin');
  try {
    await client.query(
      `insert into ${SCHEMA}.surveys (id, title, created_at, updated_at, share_token)
       values ($1, $2, $3, $4, $5)`,
      [survey.id, survey.title, survey.createdAt, survey.updatedAt, crypto.randomUUID()]
    );
    for (const role of FILE_ROLES) {
      const f = files[role];
      await client.query(
        `insert into ${SCHEMA}.survey_files (survey_id, file_role, content, original_name, file_size)
         values ($1, $2, $3, $4, $5)`,
        [survey.id, role, f.content, `${role}.csv`, f.size]
      );
    }
    await client.query('commit');
    console.log(`[완료] ${survey.id} (${survey.title}) - codebook ${files.codebook.size}b, value ${files.value.size}b, label ${files.label.size}b`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

(async () => {
  const client = await pool.connect();
  try {
    for (const survey of SURVEYS) {
      await migrateSurvey(client, survey);
    }
    console.log('마이그레이션 완료.');
  } catch (e) {
    console.error('마이그레이션 오류:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
