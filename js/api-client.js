// 백엔드 API 클라이언트 및 공용 스토리지 레이어
// 회사 Postgres(app_260712_tosb 스키마)를 직접 쓰는 자체 백엔드(server/)와 통신합니다.
// 예전 js/supabase-client.js가 내보내던 함수들과 이름/시그니처를 그대로 유지해
// home.js / visualizations.js / saved-list-modal.js는 수정할 필요가 없습니다.

const _API_BASE = '/api'; // 배포 위치가 바뀌면 이 값만 수정하면 됩니다.

async function _apiFetch(path, options) {
  const opts = Object.assign({ credentials: 'include' }, options);
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers);
  }
  const res = await fetch(_API_BASE + path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// 세션 없거나 24시간 경과 시 로그인 페이지로 이동
async function requireAuth() {
  try {
    const { authenticated } = await _apiFetch('/session');
    if (!authenticated) {
      window.location.replace('./login.html');
    }
  } catch (_) {
    window.location.replace('./login.html');
  }
}

// ── 인메모리 캐시 ─────────────────────────────────────────────

var _surveysCache = [];

// 서버에서 전체 설문 목록을 불러와 캐시에 저장합니다.
async function loadSurveysFromServer(shareToken) {
  try {
    _surveysCache = await _apiFetch('/surveys');
  } catch (e) {
    console.error('[loadSurveysFromServer] 목록 오류:', e);
    _surveysCache = [];
  }

  if (shareToken) {
    try {
      var shared = await _apiFetch('/surveys/shared/' + encodeURIComponent(shareToken));
      if (shared && !_surveysCache.find(function(x) { return x.id === shared.id; })) {
        _surveysCache.unshift(shared);
      }
      if (shared) {
        try {
          sessionStorage.setItem('survey.currentId', shared.id);
          sessionStorage.setItem('survey.title', shared.title);
        } catch (_) {}
      }
    } catch (e) {
      console.error('[loadSurveysFromServer] 공유 링크 오류:', e);
    }
  }
}

// ── 설문 CRUD ─────────────────────────────────────────────────

function loadSurveys() {
  return _surveysCache.slice();
}

async function saveSurveys(newList) {
  var oldCache = _surveysCache.slice();
  _surveysCache = Array.isArray(newList) ? newList : [];

  // 정렬 순서 저장 (fire-and-forget)
  try {
    _apiFetch('/surveys-order', {
      method: 'PUT',
      body: { order: _surveysCache.map(function(s) { return s.id; }) }
    }).catch(function() {});
  } catch (_) {}

  try {
    var oldMap = new Map(oldCache.map(function(s) { return [s.id, s]; }));

    // 삭제된 설문
    for (var i = 0; i < oldCache.length; i++) {
      var old = oldCache[i];
      if (!_surveysCache.find(function(s) { return s.id === old.id; })) {
        await _apiFetch('/surveys/' + encodeURIComponent(old.id), { method: 'DELETE' });
      }
    }

    // 새로 추가된 설문
    for (var j = 0; j < _surveysCache.length; j++) {
      var s = _surveysCache[j];
      if (oldMap.has(s.id)) continue;
      await _apiFetch('/surveys', {
        method: 'POST',
        body: {
          id: s.id,
          title: s.title,
          createdAt: s.createdAt || new Date().toISOString(),
          updatedAt: s.updatedAt || s.createdAt || new Date().toISOString(),
          shareToken: s.shareToken || crypto.randomUUID(),
          category: s.category || null,
          files: s.files || {}
        }
      });
    }

    // 제목/날짜/분류 변경된 설문
    for (var m = 0; m < _surveysCache.length; m++) {
      var cur = _surveysCache[m];
      if (!oldMap.has(cur.id)) continue;
      var prev = oldMap.get(cur.id);
      if (prev.title !== cur.title || prev.category !== cur.category || (cur.updatedAt && prev.updatedAt !== cur.updatedAt)) {
        await _apiFetch('/surveys/' + encodeURIComponent(cur.id), {
          method: 'PUT',
          body: { title: cur.title, updatedAt: cur.updatedAt || new Date().toISOString(), category: cur.category || null }
        });
      }
    }

    return true;
  } catch (e) {
    console.error('saveSurveys:', e);
    return false;
  }
}

// ── 파일 저장 ─────────────────────────────────────────────────

// 파일 내용을 가져옵니다. content가 이미 있으면 그대로, 없으면 서버에서 내려받습니다.
async function getStoredFilePayload(fileRec) {
  if (!fileRec) return null;
  if (fileRec.content) return fileRec;
  if (!fileRec.contentRef) return null;
  try {
    var parts = fileRec.contentRef.split('/');
    var surveyId = parts[0], role = parts[1];
    return await _apiFetch('/surveys/' + encodeURIComponent(surveyId) + '/files/' + encodeURIComponent(role));
  } catch (e) {
    console.error('[getStoredFilePayload] 오류:', e, '| contentRef:', fileRec.contentRef);
    return null;
  }
}

// 파일 1개를 서버에 저장합니다 (기존 설문의 데이터 교체 용).
async function persistStoredFile(surveyId, key, fileRec) {
  if (!fileRec) return null;
  return _apiFetch('/surveys/' + encodeURIComponent(surveyId) + '/files/' + encodeURIComponent(key), {
    method: 'PUT',
    body: { name: fileRec.name || (key + '.csv'), size: fileRec.size || 0, content: fileRec.content || '' }
  });
}

// 새 설문 생성 시 파일 3개를 준비합니다. 실제 DB 반영은 saveSurveys()가 담당합니다
// (설문 행이 먼저 생겨야 파일이 참조할 수 있어서, 여기서는 그대로 넘겨주기만 합니다).
async function persistSurveyFiles(surveyId, files) {
  var stored = {};
  var keys = ['codebook', 'value', 'label'];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var f = files && files[key];
    if (!f) continue;
    stored[key] = { name: f.name, size: f.size || 0, contentType: 'csv-text', content: f.content || '' };
  }
  return stored;
}

async function deleteSurveyFiles(surveyId, files, surveys) {}
async function migrateLegacySurveyStorage() {}

// ── 날짜 포맷 유틸 ────────────────────────────────────────────

function formatDate(iso) {
  try {
    var d = new Date(iso);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  } catch (_) { return iso; }
}
