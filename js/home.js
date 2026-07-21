// 홈 화면에 사용자가 파일을 업로드하면 업로드한 파일을 읽어서 검증하고 대시보드를 만드는 로직입니다.

// Home page logic (upload + validation + create survey)
// Depends on api-client.js for: persistSurveyFiles, loadSurveys, saveSurveys

// 업로드한 CSV 파일을 읽기 위한 파일 처리 유틸리티입니다.
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file, 'UTF-8');
  });
}

// 업로드 파일의 형식과 필수 컬럼을 점검하는 검증 로직입니다.
function parseCSV(text, maxRows) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        if (maxRows && rows.length >= maxRows) break;
      } else if (c !== '\r') {
        field += c;
      }
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readTabularFile(file, maxRows = 50) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'csv') {
    const text = await readAsText(file);
    return { rows: parseCSV(text, maxRows), raw: text, type: 'csv' };
  }
  throw new Error('unsupported');
}

function readRowsFromStoredFile(fileRec) {
  if (!fileRec) return [];
  if (fileRec.contentType === 'csv-text') {
    return parseCSV(fileRec.content);
  }
  return [];
}

const REQUIRED_CODEBOOK = ['question_no', 'question_label', 'response_type', 'data_column_role', 'value_code_map'];
const REQUIRED_RESPONSE = ['survey_year', 'respondent_no'];

function normalizeHeader(s) {
  return String(s || '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function isFreeTextHeaderName(headerName) {
  const normalized = normalizeHeader(headerName);
  return normalized.includes('기타_텍스트')
    || normalized.includes('기타 텍스트')
    || normalized.includes('other_text')
    || normalized.endsWith('__기타')
    || normalized.endsWith('__other');
}

function checkColumns(headerRow, required) {
  const headerSet = new Set(headerRow.map(normalizeHeader));
  const missing = required.filter(c => !headerSet.has(c.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

function validateFileForKey(key, rows) {
  if (!rows || rows.length === 0) {
    return { ok: false, error: '파일이 비어 있습니다.' };
  }

  const header = rows[0] || [];

  if (key === 'codebook') {
    const chk = checkColumns(header, REQUIRED_CODEBOOK);
    if (!chk.ok) {
      return { ok: false, error: `문항 코드북 형식이 올바르지 않습니다. 누락된 컬럼: ${chk.missing.join(', ')}` };
    }
    return { ok: true };
  }

  if (key === 'value' || key === 'label') {
    if (normalizeHeader(header[0]) !== 'survey_year') {
      return { ok: false, error: '응답 데이터셋 형식이 올바르지 않습니다.\n첫 번째 열이 survey_year이어야 합니다.' };
    }
    if (normalizeHeader(header[1]) !== 'respondent_no') {
      return { ok: false, error: '응답 데이터셋 형식이 올바르지 않습니다.\n두 번째 열이 respondent_no이어야 합니다.' };
    }

    if (rows.length >= 2) {
      const firstDataRow = rows[1] || [];
      const yearVal = cleanCell(firstDataRow[0]);
      if (!/^\d{4}$/.test(yearVal)) {
        return { ok: false, error: '응답 데이터셋 형식이 올바르지 않습니다.\nsurvey_year 값이 올바른 연도 형식(예: 2024)이 아닙니다.' };
      }
    }

    return { ok: true };
  }

  return { ok: true };
}

function cleanCell(v) {
  return String(v == null ? '' : v).replace(/^\uFEFF/, '').trim();
}

function getCodebookQuestionLabels(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(normalizeHeader);
  const iLabel = header.indexOf('question_label');
  if (iLabel < 0) return [];
  const labels = [];
  for (let r = 1; r < rows.length; r++) {
    const label = cleanCell((rows[r] || [])[iLabel]);
    if (label) labels.push(label);
  }
  return labels;
}

function getResponseQuestionHeaders(rows) {
  if (!rows || rows.length === 0) return [];
  return (rows[0] || []).slice(2).map(cleanCell);
}

function arraysEqualNormalized(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (cleanCell(a[i]) !== cleanCell(b[i])) return false;
  }
  return true;
}

function findFirstHeaderMismatch(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (cleanCell(a[i]) !== cleanCell(b[i])) {
      return { index: i, left: cleanCell(a[i]), right: cleanCell(b[i]) };
    }
  }
  return null;
}

function validateCodebookAgainstResponse(codebookRows, responseRows, responseLabel) {
  const codebookLabels = getCodebookQuestionLabels(codebookRows);
  const responseHeaders = getResponseQuestionHeaders(responseRows);
  if (codebookLabels.length === 0 || responseHeaders.length === 0) return { ok: true };
  if (arraysEqualNormalized(codebookLabels, responseHeaders)) return { ok: true };

  if (codebookLabels.length !== responseHeaders.length) {
    return {
      ok: false,
      error: `문항 코드북과 ${responseLabel}의 문항 수가 다릅니다. 코드북 ${codebookLabels.length}개, 데이터셋 ${responseHeaders.length}개입니다.`
    };
  }

  const mismatch = findFirstHeaderMismatch(codebookLabels, responseHeaders);
  if (mismatch) {
    return {
      ok: false,
      error: `문항 코드북과 ${responseLabel}의 문항 순서 또는 이름이 다릅니다. ${mismatch.index + 3}번째 응답 데이터 컬럼을 확인해 주세요.`
    };
  }

  return { ok: true };
}

function validateResponsePair(valueRows, labelRows) {
  if (!valueRows || !labelRows) return { ok: true };
  const valueHeader = (valueRows[0] || []).map(cleanCell);
  const labelHeader = (labelRows[0] || []).map(cleanCell);

  if (!arraysEqualNormalized(valueHeader, labelHeader)) {
    return { ok: false, error: '응답 데이터셋 숫자형과 텍스트형의 가로 첫행 구조가 서로 다릅니다.' };
  }

  if (valueRows.length !== labelRows.length) {
    return { ok: false, error: `응답 데이터셋 숫자형과 텍스트형의 행 수가 다릅니다. 숫자형 ${valueRows.length - 1}행, 텍스트형 ${labelRows.length - 1}행입니다.` };
  }

  for (let r = 1; r < valueRows.length; r++) {
    const vRow = valueRows[r] || [];
    const lRow = labelRows[r] || [];
    if (cleanCell(vRow[0]) !== cleanCell(lRow[0]) || cleanCell(vRow[1]) !== cleanCell(lRow[1])) {
      return { ok: false, error: `응답 데이터셋 숫자형과 텍스트형의 세로 첫행 기준값이 ${r + 1}번째 행에서 다릅니다.` };
    }
    const maxCols = Math.max(vRow.length, lRow.length);
    for (let c = 2; c < maxCols; c++) {
      const vFilled = cleanCell(vRow[c]) !== '';
      const lFilled = cleanCell(lRow[c]) !== '';
      if (vFilled !== lFilled) {
        const headerName = valueHeader[c] || `${c + 1}번째 컬럼`;
        return { ok: false, error: `응답 데이터셋 숫자형과 텍스트형의 값 위치 구조가 다릅니다. ${r + 1}번째 행 / ${headerName} 컬럼을 확인해 주세요.` };
      }
    }
  }

  return { ok: true };
}

function detectValueLabelSwap(codebookRows, valueRows, labelRows) {
  if (!codebookRows || codebookRows.length < 2) return { ok: true };

  const header = (codebookRows[0] || []).map(normalizeHeader);
  const iLabel = header.indexOf('question_label');
  const iType = header.indexOf('response_type');
  const iRole = header.indexOf('data_column_role');
  const iMap = header.indexOf('value_code_map');
  if (iLabel < 0 || iType < 0 || iRole < 0 || iMap < 0) return { ok: true };

  const targetTypes = new Set(['객관식 단일', '객관식 중복', '객관식 순위']);

  const candidates = [];
  for (let r = 1; r < codebookRows.length; r++) {
    const row = codebookRows[r] || [];
    const rType = cleanCell(row[iType]);
    const rRole = cleanCell(row[iRole]);
    const rMap = cleanCell(row[iMap]);
    const rLabel = cleanCell(row[iLabel]);
    if (!targetTypes.has(rType) || rRole !== 'raw' || !rMap || !rLabel) continue;

    const pairs = rMap.split('|').map(p => p.trim()).filter(Boolean);
    const codes = [];
    const labels = [];
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx < 0) continue;
      const code = pair.slice(0, eqIdx).trim();
      const lbl = pair.slice(eqIdx + 1).trim();
      if (/^-?\d+(\.\d+)?$/.test(code)) {
        codes.push(code);
        if (lbl) labels.push(lbl);
      }
    }
    if (codes.length > 0 && labels.length > 0) {
      candidates.push({ questionLabel: rLabel, codes, labels });
    }
    if (candidates.length >= 3) break;
  }

  if (candidates.length === 0) return { ok: true };

  function scoreRows(rows) {
    if (!rows || rows.length < 2) return null;
    const respHeader = (rows[0] || []).map(cleanCell);
    let codeHits = 0, labelHits = 0;

    for (const { questionLabel, codes, labels } of candidates) {
      const colIdx = respHeader.indexOf(questionLabel);
      if (colIdx < 0) continue;

      for (let r = 1; r < Math.min(rows.length, 11); r++) {
        const v = cleanCell((rows[r] || [])[colIdx]);
        if (!v) continue;
        if (codes.includes(v)) codeHits++;
        else if (labels.includes(v)) labelHits++;
      }
    }
    return { codeHits, labelHits };
  }

  const valueScore = valueRows ? scoreRows(valueRows) : null;
  const labelScore = labelRows ? scoreRows(labelRows) : null;

  if (valueScore && valueScore.labelHits > 0 && valueScore.codeHits === 0) {
    return { ok: false, error: '응답 데이터셋_숫자형 카드에 텍스트형 파일이 업로드된 것 같습니다.\n숫자 코드가 담긴 숫자형 파일을 업로드해 주세요.' };
  }
  if (labelScore && labelScore.codeHits > 0 && labelScore.labelHits === 0) {
    return { ok: false, error: '응답 데이터셋_텍스트형 카드에 숫자형 파일이 업로드된 것 같습니다.\n텍스트 응답이 담긴 텍스트형 파일을 업로드해 주세요.' };
  }

  return { ok: true };
}

function validateBundleConsistency(rowsByKey) {
  const { codebook, value, label } = rowsByKey;

  if (codebook && (value || label)) {
    const swapResult = detectValueLabelSwap(codebook, value, label);
    if (!swapResult.ok) return swapResult;
  }

  if (codebook && value) {
    const result = validateCodebookAgainstResponse(codebook, value, '응답 데이터셋_숫자형');
    if (!result.ok) return result;
  }
  if (codebook && label) {
    const result = validateCodebookAgainstResponse(codebook, label, '응답 데이터셋_텍스트형');
    if (!result.ok) return result;
  }
  if (value && label) {
    const result = validateResponsePair(value, label);
    if (!result.ok) return result;
  }
  return { ok: true };
}

(function () {
  const ALLOWED_EXT = ['csv'];

  const titleInput = document.getElementById('survey-title');
  const titleError = document.getElementById('title-error');
  const categoryError = document.getElementById('category-error');
  const startBtn = document.getElementById('start-btn');
  const uploadErr = document.getElementById('upload-error');

  const fileInputs = {
    codebook: document.getElementById('file-codebook'),
    value: document.getElementById('file-value'),
    label: document.getElementById('file-label')
  };

  const state = { codebook: null, value: null, label: null, category: null };
  const parsedState = { codebook: null, value: null, label: null };

  document.querySelectorAll('#category-pill-group [data-category]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        document.querySelectorAll('#category-pill-group [data-category]').forEach(other => {
          if (other !== cb) other.checked = false;
        });
        state.category = cb.dataset.category;
      } else {
        state.category = null;
      }
      categoryError.classList.remove('show');
      updateStart();
    });
  });

  titleInput.addEventListener('input', () => {
    if (titleInput.value.trim()) {
      titleInput.classList.remove('error');
      titleError.classList.remove('show');
    }
    updateStart();
  });

  document.querySelectorAll('.drop-zone').forEach(zone => {
    const key = zone.dataset.key;
    const input = fileInputs[key];

    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleFile(zone, key, file);
    });

    ['dragenter', 'dragover'].forEach(ev => {
      zone.addEventListener(ev, e => {
        e.preventDefault();
        zone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(ev => {
      zone.addEventListener(ev, e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
      });
    });

    zone.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (file) handleFile(zone, key, file);
    });
  });

  document.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      fileInputs[btn.dataset.pick].click();
    });
  });

  document.querySelectorAll('[data-reselect]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.reselect;
      fileInputs[key].value = '';
      fileInputs[key].click();
    });
  });

  function resetZone(zone) {
    zone.classList.remove('done', 'has-error');
    zone.parentElement.classList.remove('has-error');
    zone.parentElement.querySelector('.dz-error-msg').textContent = '';
    zone.querySelector('.done-filename').textContent = '';
  }

  function setZoneError(zone, msg) {
    zone.classList.remove('done');
    zone.classList.add('has-error');
    zone.parentElement.classList.add('has-error');
    zone.parentElement.querySelector('.dz-error-msg').textContent = msg.replace(/\\. /g, '.\\n');
  }

  function setZoneDone(zone, filename) {
    zone.parentElement.classList.remove('has-error');
    zone.classList.remove('has-error');
    zone.classList.add('done');
    zone.parentElement.querySelector('.dz-error-msg').textContent = '';
    zone.querySelector('.done-filename').textContent = filename;
  }

  async function handleFile(zone, key, file) {
    uploadErr.classList.remove('show');
    resetZone(zone);

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      setZoneError(zone, '지원하지 않는 파일 형식입니다. .csv 파일만 업로드할 수 있습니다.');
      state[key] = null;
      updateStart();
      return;
    }

    let parsed;
    try {
      const maxRows = key === 'codebook' ? null : 50;
      parsed = await readTabularFile(file, maxRows);
    } catch (_) {
      setZoneError(zone, '파일을 읽는 중 오류가 발생했습니다.');
      state[key] = null;
      updateStart();
      return;
    }

    const result = validateFileForKey(key, parsed.rows);
    if (!result.ok) {
      setZoneError(zone, result.error);
      state[key] = null;
      parsedState[key] = null;
      updateStart();
      return;
    }

    state[key] = { name: file.name, content: parsed.raw, contentType: 'csv-text' };
    parsedState[key] = parsed.rows;
    setZoneDone(zone, file.name);
    updateStart();
  }

  function updateStart() {
    const ready = titleInput.value.trim() && state.codebook && state.value && state.label;
    startBtn.disabled = !ready;
  }

  startBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.classList.add('error');
      titleError.classList.add('show');
      titleInput.focus();
      return;
    }

    if (!state.category) {
      categoryError.classList.add('show');
      return;
    }

    uploadErr.classList.remove('show');
    const bundleResult = validateBundleConsistency({
      codebook: readRowsFromStoredFile(state.codebook),
      value: readRowsFromStoredFile(state.value),
      label: readRowsFromStoredFile(state.label)
    });
    if (!bundleResult.ok) {
      uploadErr.textContent = bundleResult.error.replace(/\\. /g, '.\\n');
      uploadErr.classList.add('show');
      return;
    }

    startBtn.disabled = true;
    startBtn.textContent = '업로드 중...';

    const id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    let files;
    try {
      files = await persistSurveyFiles(id, {
        codebook: state.codebook,
        value: state.value,
        label: state.label
      });
    } catch (e) {
      alert('파일 업로드에 실패했습니다. 네트워크 상태를 확인해 주세요.\\n' + ((e && e.message) || ''));
      startBtn.disabled = false;
      startBtn.textContent = '대시보드 만들기';
      return;
    }

    const surveys = loadSurveys();
    const entry = {
      id,
      title,
      category: state.category,
      createdAt: new Date().toISOString(),
      shareToken: crypto.randomUUID(),
      files
    };

    surveys.unshift(entry);
    const saved = await saveSurveys(surveys);

    try {
      sessionStorage.setItem('survey.currentId', saved ? id : '');
      sessionStorage.setItem('survey.title', title);
    } catch (_) {}

    window.location.href = 'dashboard.html';
  });

  // Shared modal (DOM injected + open/close + badge update)
  try {
    window.initSavedListModal && window.initSavedListModal({
      openButtonIds: ['open-list-btn'],
      countBadgeIds: ['saved-count']
    });
  } catch (_) {}
})();

