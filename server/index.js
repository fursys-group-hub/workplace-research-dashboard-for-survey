require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const { pool, SCHEMA } = require('./db');
const { setSessionCookie, clearSessionCookie, isAuthenticated, requireAuthMiddleware } = require('./auth');

const FILE_ROLES = ['codebook', 'value', 'label'];
const SORT_ORDER_KEY = 'surveys_sort_order';

const app = express();
app.use(express.json({ limit: '20mb' })); // csv 본문이 JSON으로 오가므로 여유있게
app.use(cookieParser());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || !process.env.ALLOWED_ORIGIN || origin === process.env.ALLOWED_ORIGIN) {
      return callback(null, true);
    }
    return callback(new Error('허용되지 않은 오리진입니다.'));
  },
  credentials: true
}));

// ── 인증 ─────────────────────────────────────────────────────

app.get('/api/session', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  setSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.use('/api/surveys', requireAuthMiddleware);
app.use('/api/surveys-order', requireAuthMiddleware);

// ── 조회 헬퍼 ─────────────────────────────────────────────────

async function fetchSurveyOrder() {
  const r = await pool.query(
    `select value from ${SCHEMA}.app_settings where key = $1`,
    [SORT_ORDER_KEY]
  );
  return r.rows.length ? r.rows[0].value : [];
}

function toFilesMap(fileRows) {
  const files = {};
  fileRows.forEach((f) => {
    files[f.file_role] = {
      name: f.original_name,
      size: Number(f.file_size) || 0,
      contentType: 'csv-text',
      contentRef: `${f.survey_id}/${f.file_role}`
    };
  });
  return files;
}

function toSurveyPayload(row, fileRows) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shareToken: row.share_token,
    category: row.category,
    files: toFilesMap(fileRows)
  };
}

function applySortOrder(surveys, order) {
  if (!Array.isArray(order) || order.length === 0) return surveys;
  const orderMap = new Map(order.map((id, i) => [id, i]));
  return surveys.slice().sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
    return ai !== bi ? ai - bi : 0;
  });
}

// ── 설문 목록 / 공유 링크 ───────────────────────────────────────

app.get('/api/surveys', async (req, res) => {
  try {
    const surveysRes = await pool.query(
      `select * from ${SCHEMA}.surveys order by created_at desc`
    );
    const filesRes = await pool.query(
      `select survey_id, file_role, original_name, file_size from ${SCHEMA}.survey_files`
    );
    const filesBySurvey = new Map();
    filesRes.rows.forEach((f) => {
      if (!filesBySurvey.has(f.survey_id)) filesBySurvey.set(f.survey_id, []);
      filesBySurvey.get(f.survey_id).push(f);
    });
    const surveys = surveysRes.rows.map((row) =>
      toSurveyPayload(row, filesBySurvey.get(row.id) || [])
    );
    const order = await fetchSurveyOrder();
    res.json(applySortOrder(surveys, order));
  } catch (e) {
    console.error('[GET /api/surveys]', e);
    res.status(500).json({ error: '설문 목록을 불러오지 못했습니다.' });
  }
});

app.get('/api/surveys/shared/:token', async (req, res) => {
  try {
    const surveyRes = await pool.query(
      `select * from ${SCHEMA}.surveys where share_token = $1`,
      [req.params.token]
    );
    if (!surveyRes.rows.length) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
    const row = surveyRes.rows[0];
    const filesRes = await pool.query(
      `select survey_id, file_role, original_name, file_size from ${SCHEMA}.survey_files where survey_id = $1`,
      [row.id]
    );
    res.json(toSurveyPayload(row, filesRes.rows));
  } catch (e) {
    console.error('[GET /api/surveys/shared/:token]', e);
    res.status(500).json({ error: '설문을 불러오지 못했습니다.' });
  }
});

// ── 설문 생성 / 수정 / 삭제 ─────────────────────────────────────

app.post('/api/surveys', async (req, res) => {
  const { id, title, createdAt, updatedAt, shareToken, category, files } = req.body || {};
  if (!id || !title) return res.status(400).json({ error: 'id와 title은 필수입니다.' });

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into ${SCHEMA}.surveys (id, title, created_at, updated_at, share_token, category)
       values ($1, $2, coalesce($3, now()), coalesce($4, now()), $5, $6)`,
      [id, title, createdAt || null, updatedAt || createdAt || null, shareToken || crypto.randomUUID(), category || null]
    );
    for (const role of FILE_ROLES) {
      const f = files && files[role];
      if (!f) continue;
      await client.query(
        `insert into ${SCHEMA}.survey_files (survey_id, file_role, content, original_name, file_size)
         values ($1, $2, $3, $4, $5)`,
        [id, role, f.content || '', f.name || `${role}.csv`, f.size || 0]
      );
    }
    await client.query('commit');
    res.status(201).json({ ok: true, id });
  } catch (e) {
    await client.query('rollback');
    console.error('[POST /api/surveys]', e);
    res.status(500).json({ error: '설문을 생성하지 못했습니다.' });
  } finally {
    client.release();
  }
});

app.put('/api/surveys/:id', async (req, res) => {
  const { title, updatedAt, category } = req.body || {};
  try {
    await pool.query(
      `update ${SCHEMA}.surveys set title = coalesce($1, title), updated_at = coalesce($2, now()), category = coalesce($3, category) where id = $4`,
      [title || null, updatedAt || null, category || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[PUT /api/surveys/:id]', e);
    res.status(500).json({ error: '설문을 수정하지 못했습니다.' });
  }
});

app.delete('/api/surveys/:id', async (req, res) => {
  try {
    await pool.query(`delete from ${SCHEMA}.surveys where id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/surveys/:id]', e);
    res.status(500).json({ error: '설문을 삭제하지 못했습니다.' });
  }
});

// ── 파일 개별 조회 / 교체 ───────────────────────────────────────

app.get('/api/surveys/:id/files/:role', async (req, res) => {
  const { id, role } = req.params;
  if (!FILE_ROLES.includes(role)) return res.status(400).json({ error: '알 수 없는 파일 종류입니다.' });
  try {
    const r = await pool.query(
      `select content, original_name, file_size from ${SCHEMA}.survey_files where survey_id = $1 and file_role = $2`,
      [id, role]
    );
    if (!r.rows.length) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    const row = r.rows[0];
    res.json({
      name: row.original_name,
      size: Number(row.file_size) || 0,
      contentType: 'csv-text',
      content: row.content
    });
  } catch (e) {
    console.error('[GET /api/surveys/:id/files/:role]', e);
    res.status(500).json({ error: '파일을 불러오지 못했습니다.' });
  }
});

app.put('/api/surveys/:id/files/:role', async (req, res) => {
  const { id, role } = req.params;
  if (!FILE_ROLES.includes(role)) return res.status(400).json({ error: '알 수 없는 파일 종류입니다.' });
  const { name, size, content } = req.body || {};
  try {
    await pool.query(
      `insert into ${SCHEMA}.survey_files (survey_id, file_role, content, original_name, file_size)
       values ($1, $2, $3, $4, $5)
       on conflict (survey_id, file_role)
       do update set content = excluded.content, original_name = excluded.original_name, file_size = excluded.file_size`,
      [id, role, content || '', name || `${role}.csv`, size || 0]
    );
    res.json({ name: name || `${role}.csv`, size: size || 0, contentType: 'csv-text', contentRef: `${id}/${role}` });
  } catch (e) {
    console.error('[PUT /api/surveys/:id/files/:role]', e);
    res.status(500).json({ error: '파일을 저장하지 못했습니다.' });
  }
});

// ── 정렬 순서 ────────────────────────────────────────────────

app.put('/api/surveys-order', async (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order는 배열이어야 합니다.' });
  try {
    await pool.query(
      `insert into ${SCHEMA}.app_settings (key, value)
       values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [SORT_ORDER_KEY, JSON.stringify(order)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[PUT /api/surveys-order]', e);
    res.status(500).json({ error: '정렬 순서를 저장하지 못했습니다.' });
  }
});

// 정적 프론트(HTML/JS/CSS)도 같은 오리진에서 서빙합니다.
// 프론트를 별도 호스팅으로 분리하게 되면 이 부분은 지우고 ALLOWED_ORIGIN만 설정하면 됩니다.
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`설문 대시보드 백엔드가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
