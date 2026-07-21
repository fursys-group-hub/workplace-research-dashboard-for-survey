// 일회성 스크립트: 마이그레이션된 기존 7개 설문에 category(컨설팅/리서치)를 채웁니다.
// 사용법: server 디렉터리에서 `node backfill-category.js`
require('dotenv').config();

const { pool, SCHEMA } = require('./db');

const ASSIGNMENTS = [
  { id: 's_1777564881153_bb4pva', category: 'research' },  // 2024-2025 인식 DB
  { id: 's_1777565042612_g2qddu', category: 'research' },  // 2023 인식 DB
  { id: 's_1777565159143_u5xlxl', category: 'consulting' }, // 2025 전기공사공제조합
  { id: 's_1778262001561_9y1c69', category: 'research' },  // 2022 인식 DB
  { id: 's_1778503319726_1h9ax0', category: 'research' },  // 2021 인식 DB
  { id: 's_1778577670487_giqdp1', category: 'research' },  // 2020 인식 DB
  { id: 's_1780663152730_w6zny5', category: 'consulting' } // 2026 현대자동차 울산공장 신축 본관 컨설팅
];

(async () => {
  try {
    for (const { id, category } of ASSIGNMENTS) {
      const r = await pool.query(
        `update ${SCHEMA}.surveys set category = $1 where id = $2 returning title`,
        [category, id]
      );
      console.log(r.rows.length ? `[완료] ${r.rows[0].title} -> ${category}` : `[스킵] ${id} - 찾을 수 없음`);
    }
    console.log('백필 완료.');
  } catch (e) {
    console.error('오류:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
