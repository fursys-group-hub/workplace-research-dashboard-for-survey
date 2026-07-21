/* =====================================================================
   visualizations.js — 섹션 맵

   레거시 단일 파일 구조를 유지하되, 3개 레이어로 구획해 둠.
   각 섹션의 진입점을 줄 번호로 안내한다. (줄 번호는 정리 시점 기준이며,
   대규모 변경이 있었다면 이 맵도 갱신할 것)

   ── 1) Data / Aggregation  (L1 ~ L1674) ───────────────────────────
     L47    파일 I/O · CSV 파싱 (readAsText, parseCSV, readTabularFile)
     L157   코드북/응답 검증 (validateFileForKey, detectValueLabelSwap 등)
     L414   코드북 로드 · 문항 트리 구성 (loadCodebookRows, buildQuestionTree)
     L576   사이드 패널 UI (아코디언, 검색, 드래그 앤 드롭)
     L892   필터 후보 · 상태 · 렌더링 (buildFilterCandidates, renderFilters)
     L1355  필터 · 제목 · 저장 모달 이벤트 바인딩

   ── 2) Chart Renderers  (L1675 ~ L9929) ───────────────────────────
     L1680  공통 (팔레트, 척도 색상, resultState, 타입 술어)
     L2239  ─ [객관식 단일/복수] + [척도/비율/숫자/시간/텍스트] 집계·렌더
       L2354  aggregateSingle · aggregateMulti
       L2590  aggregateRatioAllocation
       L2805  derived scale (단일 척도 분포·박스플롯)
       L2970  buildNumericHistogram (숫자형)
       L3996  비율 배분 차트 · 표
       L4269  척도 UI (토글 · 축 · 트랙 · 평균 마커)
       L4747  척도 비교 (다문항 비교)
       L5143  숫자형 컨트롤 · 박스플롯 · 그룹 비교
     L6028  ─ [객관식 순위] 집계·렌더
       L6318  순위 컨트롤 · lollipop · stacked · 표 · 섹션
     L8887  renderResults (전체 결과 패널 리렌더 오케스트레이터)

   ── 3) UI Binding / Init / Export  (L9930 ~ end) ──────────────────
     L9937  결과 패널 리렌더 트리거 · 초기화 (observeDropZones, initResultFeature)
     L10017 EXPORT_LOGO_DATA_URI (로고 base64 데이터)
     L10020 A4 추출 사양 (300DPI) · 페이지 · 여백 상수
     L10222 exportAllSectionsAsPptx (PPTX 일괄 내보내기)
     L10436 exportSingleChoiceAsPptx (개별 단일 차트 → PPTX, 현재 비활성)
     L10509 exportSectionAsImage · addFooterToCanvas (이미지 추출 · 푸터 합성)
   ===================================================================== */



// 스토리지 레이어: api-client.js 참고

/**
 * File을 UTF-8 텍스트로 읽어 Promise로 반환합니다.
 */
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file, 'UTF-8');
  });
}

// 코드북/응답 데이터 파일을 읽고 파싱하기 위한 공통 유틸리티입니다.
/**
 * HTML 삽입용으로 &, <, 따옴표 등을 이스케이프합니다.
 */
function applyDragImage(e, el) {
  const clone = el.cloneNode(true);
  clone.style.position = 'fixed';
  clone.style.top = '-9999px';
  clone.style.left = '-9999px';
  clone.style.width = el.offsetWidth + 'px';
  clone.style.pointerEvents = 'none';
  document.body.appendChild(clone);
  e.dataTransfer.setDragImage(clone, e.offsetX, e.offsetY);
  setTimeout(() => document.body.removeChild(clone), 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

/**
 * 숫자 자릿수에 맞는 CSS 클래스 이름을 반환합니다.
 */
function getNumberTagDigitClass(value) {
  const digits = String(Math.abs(Number(value) || 0)).length;
  if (digits >= 3) return 'digits-3';
  if (digits === 2) return 'digits-2';
  return '';
}

/**
 * 숫자 태그 요소의 텍스트와 자릿수 클래스를 갱신합니다.
 */
function setNumberTagValue(el, value) {
  if (!el) return;
  el.textContent = String(value);
  el.classList.remove('digits-2', 'digits-3');
  const digitClass = getNumberTagDigitClass(value);
  if (digitClass) el.classList.add(digitClass);
}

/**
 * CSV 문자열을 따옴표/쉼표 규칙에 맞게 2차원 배열로 파싱합니다.
 */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * 업로드 파일(현재 CSV)을 읽어 행 배열과 원문을 반환합니다.
 */
async function readTabularFile(file, maxRows = null) {
  const ext = (file && file.name ? file.name.split('.').pop() : '').toLowerCase();
  if (ext === 'csv') {
    const text = await readAsText(file);
    const rows = parseCSV(text);
    return {
      rows: maxRows ? rows.slice(0, maxRows) : rows,
      contentType: 'csv-text',
      content: text
    };
  }
  throw new Error('unsupported');
}

/**
 * 열 이름 비교용으로 앞뒤 공백·BOM을 제거하고 소문자로 맞춥니다.
 */
function normalizeHeader(s) {
  return String(s || '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

/**
 * 열 이름이 기타 서술형(기타 텍스트) 컬럼인지 판별합니다.
 */
function isFreeTextHeaderName(headerName) {
  const normalized = normalizeHeader(headerName);
  return normalized.includes('기타_텍스트')
    || normalized.includes('기타 텍스트')
    || normalized.includes('other_text')
    || normalized.endsWith('__기타')
    || normalized.endsWith('__other');
}

const REQUIRED_CODEBOOK = ['question_no', 'question_label', 'response_type', 'data_column_role', 'value_code_map'];
const REQUIRED_RESPONSE = ['survey_year', 'respondent_no'];

/**
 * 헤더 행에 필수 컬럼이 모두 있는지 검사합니다.
 */
function checkColumns(headerRow, required) {
  const headerSet = new Set((headerRow || []).map(normalizeHeader));
  const missing = required.filter(c => !headerSet.has(c.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

/**
 * 코드북/값/라벨 파일 종류별로 행 구조가 올바른지 검증합니다.
 */
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

/**
 * 코드북 시트에서 question_label 열 값 목록을 추출합니다.
 */
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

/**
 * 응답 시트 헤더에서 survey_year, respondent_no 뒤의 문항 열명을 반환합니다.
 */
function getResponseQuestionHeaders(rows) {
  if (!rows || rows.length === 0) return [];
  return (rows[0] || []).slice(2).map(cleanCell);
}

/**
 * 두 배열을 cleanCell 기준으로 같은지 비교합니다.
 */
function arraysEqualNormalized(a, b) {
  if ((a || []).length !== (b || []).length) return false;
  for (let i = 0; i < a.length; i++) {
    if (cleanCell(a[i]) !== cleanCell(b[i])) return false;
  }
  return true;
}

/**
 * 두 헤더 배열에서 처음 어긋나는 인덱스와 값을 반환합니다.
 */
function findFirstHeaderMismatch(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (cleanCell(a[i]) !== cleanCell(b[i])) {
      return { index: i, left: cleanCell(a[i]), right: cleanCell(b[i]) };
    }
  }
  return null;
}

/**
 * 코드북 문항 순서/이름이 응답 데이터 열과 맞는지 검증합니다.
 */
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

/**
 * 값 시트와 라벨 시트의 행·열 구조 일관성을 검증합니다.
 */
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

/**
 * 값/라벨 파일이 서로 뒤바뀌었는지 코드북 힌트로 추정합니다.
 */
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
    let codeHits = 0;
    let labelHits = 0;

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

/**
 * 로드된 코드북·값·라벨 묶음 전체를 교차 검증합니다.
 */
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

/**
 * 저장된 코드북 파일 레코드에서 행 배열을 비동기로 불러옵니다.
 */
async function loadCodebookRows(fileRec) {
  if (!fileRec) return null;
  const payload = await getStoredFilePayload(fileRec);
  if (!payload) return null;
  if (payload.contentType === 'csv-text') {
    return parseCSV(payload.content);
  }
  return null;
}

/**
 * 셀 값을 문자열로 정리(트림)합니다.
 */
function cleanCell(v) {
  return String(v == null ? '' : v).replace(/^\uFEFF/, '').trim();
}

// 코드북을 category_1 > question 또는 category_1 > category_2 > question 구조로 변환합니다.
/**
 * 코드북 행으로 문항 계층(섹션/문항) 트리 구조를 만듭니다.
 */
function buildQuestionTree(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(normalizeHeader);
  const col = name => header.indexOf(name);
  const iCat1 = col('category_1');
  const iCat2 = col('category_2');
  const iLabel = col('question_label');
  const iFull = col('question_full');
  const iNo = col('question_no');
  const iRole = col('data_column_role');
  const iType = col('response_type');

  const cat1Order = [];
  const map = new Map();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const label = iLabel >= 0 ? String(row[iLabel] || '').trim() : '';
    if (!label) continue;

    const c1 = (iCat1 >= 0 ? String(row[iCat1] || '').trim() : '') || '기타';
    const c2 = iCat2 >= 0 ? String(row[iCat2] || '').trim() : '';
    const full = iFull >= 0 ? String(row[iFull] || '').trim() : '';
    const qno = iNo >= 0 ? String(row[iNo] || '').trim() : '';
    const role = iRole >= 0 ? String(row[iRole] || '').trim() : '';
    const rtype = iType >= 0 ? String(row[iType] || '').trim() : '';
    const item = { qno, label, full, role, rtype };

    // expanded 행과 주관식 시간의 분환산 derived 행은 내부 집계 컬럼이므로 사용자용 문항 리스트에서 제외합니다.
    if (role.toLowerCase() === 'expanded') continue;
    if (rtype.includes('주관식 시간') && role.toLowerCase() === 'derived') continue;

    if (!map.has(c1)) {
      map.set(c1, { items: [], children: new Map() });
      cat1Order.push(c1);
    }
    const c1m = map.get(c1);
    if (!c2) {
      c1m.items.push(item);
      continue;
    }
    if (!c1m.children.has(c2)) c1m.children.set(c2, []);
    c1m.children.get(c2).push(item);
  }

  return cat1Order.map(c1 => ({
    name: c1,
    items: map.get(c1).items,
    children: Array.from(map.get(c1).children.entries()).map(([c2, items]) => ({ name: c2, items }))
  }));
}

/**
 * 문항 트리를 HTML 목록으로 렌더링합니다.
 */
function renderTree(tree) {
  const host = document.getElementById('question-tree');
  host.innerHTML = '';

  if (!tree || tree.length === 0) {
    host.innerHTML = '<div class="question-list-empty">표시할 문항이 없습니다.</div>';
    return;
  }

  const chevron = 'assets/icons/keyboard_arrow_right_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg';
  function appendQuestionCard(parent, item, cat1Name, cat2Name) {
    const card = document.createElement('div');
    const hasFull = item.full && item.full.trim() !== '';
    card.className = 'question-item' + (hasFull ? ' has-full' : '');
    card.draggable = true;
    card.dataset.label = item.label;
    card.dataset.qno = item.qno;
    card.dataset.cat1 = cat1Name;
    card.dataset.cat2 = cat2Name || '';
    card.dataset.full = item.full;
    card.title = item.label;
    card.innerHTML = `
      <span class="question-item-label">${escapeHtml(item.label)}</span>
      ${hasFull ? `<span class="question-item-full">Q. ${escapeHtml(item.full)}</span>` : ''}
    `;
    parent.appendChild(card);
  }

  tree.forEach((cat1, i1) => {
    const cat = document.createElement('div');
    cat.className = 'accordion-category';
    cat.dataset.cat1 = cat1.name;

    const head = document.createElement('button');
    head.className = 'accordion-header';
    head.type = 'button';
    head.innerHTML = `
      <span class="accordion-label">${escapeHtml(cat1.name)}</span>
      <img class="accordion-chev" src="${chevron}" alt="">
    `;
    cat.appendChild(head);

    const list = document.createElement('div');
    list.className = 'accordion-list';

    if (Array.isArray(cat1.items) && cat1.items.length > 0) {
      const directList = document.createElement('div');
      directList.className = 'accordion-direct-list';
      cat1.items.forEach(item => appendQuestionCard(directList, item, cat1.name, ''));
      list.appendChild(directList);
    }

    cat1.children.forEach((cat2, i2) => {
      const sub = document.createElement('div');
      sub.className = 'accordion-subcategory';
      sub.dataset.cat2 = cat2.name;

      const subHead = document.createElement('button');
      subHead.className = 'sub-accordion-header';
      subHead.type = 'button';
      subHead.innerHTML = `
        <span class="sub-accordion-label">${escapeHtml(cat2.name)}</span>
        <img class="sub-accordion-chev" src="${chevron}" alt="">
      `;
      sub.appendChild(subHead);

      const subList = document.createElement('div');
      subList.className = 'sub-accordion-list';

      cat2.items.forEach(item => {
        appendQuestionCard(subList, item, cat1.name, cat2.name);
      });

      sub.appendChild(subList);
      list.appendChild(sub);
    });

    cat.appendChild(list);
    host.appendChild(cat);
  });
}

// 좌측 문항 패널의 아코디언 열기/닫기와 검색 동작을 담당합니다.
/**
 * 문항 목록 아코디언(접기/펼치기) 동작을 연결합니다.
 */
function setupAccordion() {
  const host = document.getElementById('question-tree');
  host.addEventListener('click', e => {
    const h1 = e.target.closest('.accordion-header');
    if (h1) {
      h1.parentElement.classList.toggle('open');
      return;
    }
    const h2 = e.target.closest('.sub-accordion-header');
    if (h2) {
      h2.parentElement.classList.toggle('open');
    }
  });
}

/**
 * 문항 검색 입력과 필터링 UI를 연결합니다.
 */
function setupSearch() {
  const input = document.getElementById('panel-search');
  const host = document.getElementById('question-tree');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const cats = host.querySelectorAll('.accordion-category');

    if (q === '') {
      cats.forEach(cat => {
        cat.style.display = '';
        cat.classList.remove('open');
        cat.querySelectorAll('.accordion-direct-list').forEach(list => list.style.display = '');
        cat.querySelectorAll('.accordion-direct-list .question-item').forEach(item => item.style.display = '');
        cat.querySelectorAll('.accordion-subcategory').forEach(sub => {
          sub.style.display = '';
          sub.classList.remove('open');
          sub.querySelectorAll('.question-item').forEach(item => item.style.display = '');
        });
      });
      removeEmptyMsg();
      return;
    }

    let anyMatch = false;
    cats.forEach(cat => {
      let catMatch = false;
      const cat1Name = cat.dataset.cat1 || '';
      const cat1Hit = cat1Name.toLowerCase().includes(q);
      cat.querySelectorAll('.accordion-direct-list').forEach(list => {
        let directMatch = false;
        list.querySelectorAll('.question-item').forEach(item => {
          const hay = [
            item.dataset.label || '',
            item.dataset.full || '',
            item.dataset.qno || '',
            cat1Name
          ].join(' ').toLowerCase();
          const hit = cat1Hit || hay.includes(q);
          item.style.display = hit ? '' : 'none';
          if (hit) directMatch = true;
        });
        list.style.display = directMatch ? '' : 'none';
        if (directMatch) catMatch = true;
      });
      cat.querySelectorAll('.accordion-subcategory').forEach(sub => {
        let subMatch = false;
        const cat2Name = sub.dataset.cat2 || '';
        const cat2Hit = cat2Name.toLowerCase().includes(q);
        sub.querySelectorAll('.question-item').forEach(item => {
          const hay = [
            item.dataset.label || '',
            item.dataset.full || '',
            item.dataset.qno || '',
            cat1Name,
            cat2Name
          ].join(' ').toLowerCase();
          const hit = cat1Hit || cat2Hit || hay.includes(q);
          item.style.display = hit ? '' : 'none';
          if (hit) subMatch = true;
        });
        const visible = subMatch || cat2Hit;
        sub.style.display = visible ? '' : 'none';
        if (visible) sub.classList.add('open');
        if (visible) catMatch = true;
      });
      const visibleCat = catMatch || cat1Hit;
      cat.style.display = visibleCat ? '' : 'none';
      if (visibleCat) cat.classList.add('open');
      if (visibleCat) anyMatch = true;
    });

    if (!anyMatch) showEmptyMsg();
    else removeEmptyMsg();
  });

  function showEmptyMsg() {
    removeEmptyMsg();
    const msg = document.createElement('div');
    msg.className = 'question-list-empty';
    msg.id = 'search-empty-msg';
    msg.textContent = '검색 결과가 없습니다.';
    host.appendChild(msg);
  }
  function removeEmptyMsg() {
    const existing = document.getElementById('search-empty-msg');
    if (existing) existing.remove();
  }
}

// 좌측 패널 확장/축소와 문항 다중선택, 드래그앤드롭을 처리합니다.
/**
 * 좌우 패널 토글 버튼 동작을 연결합니다.
 */
function setupPanelToggle() {
  const btn = document.getElementById('panel-toggle');
  const page = document.querySelector('.page');
  btn.addEventListener('click', () => {
    page.classList.toggle('panel-expanded');
    btn.setAttribute('aria-label', page.classList.contains('panel-expanded') ? '패널 접기' : '패널 확장');
  });
}

/**
 * 문항 선택, 드래그앤드롭, 비교/기준 영역 한도 등을 연결합니다.
 */
function setupSelectionAndDragDrop() {
  const host = document.getElementById('question-tree');
  const zones = document.querySelectorAll('#drop-target.question-drop-area, #drop-criterion.question-drop-area');
  const statusEl = document.getElementById('selection-status');
  const countEl = document.getElementById('selection-count');
  const clearBtn = document.getElementById('selection-clear-btn');
  const targetClearBtn = document.getElementById('target-clear-btn');
  const targetScaleCompareBtn = document.getElementById('target-scale-compare-btn');
  const criterionClearBtn = document.getElementById('criterion-clear-btn');
  const criterionYearBtn = document.getElementById('criterion-year-btn');
  const criterionZone = document.getElementById('drop-criterion');
  let selectionAnchor = null;

  function selectedItems() {
    return Array.from(host.querySelectorAll('.question-item.selected'));
  }

  function visibleQuestionItems() {
    return Array.from(host.querySelectorAll('.question-item'))
      .filter(item => item.offsetParent !== null);
  }

  function refreshStatus() {
    const n = selectedItems().length;
    countEl.textContent = String(n);
    statusEl.classList.toggle('show', n > 0);
  }

  function clearSelection() {
    host.querySelectorAll('.question-item.selected').forEach(el => el.classList.remove('selected'));
    selectionAnchor = null;
    refreshStatus();
  }

  function selectRangeTo(item) {
    const items = visibleQuestionItems();
    const startIndex = items.indexOf(selectionAnchor);
    const endIndex = items.indexOf(item);
    if (startIndex < 0 || endIndex < 0) return false;
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    items.slice(start, end + 1).forEach(el => el.classList.add('selected'));
    return true;
  }

  host.addEventListener('click', e => {
    const item = e.target.closest('.question-item');
    if (!item) return;
    if (e.shiftKey && selectionAnchor) {
      if (selectRangeTo(item)) {
        refreshStatus();
        return;
      }
    }
    item.classList.toggle('selected');
    selectionAnchor = item;
    refreshStatus();
  });

  clearBtn.addEventListener('click', clearSelection);
  if (targetClearBtn) {
    targetClearBtn.addEventListener('click', () => clearDropZone('drop-target'));
  }
  if (targetScaleCompareBtn) {
    targetScaleCompareBtn.addEventListener('click', () => {
      if (targetScaleCompareBtn.disabled) return;
      resultState.targetScaleCompareMode = !resultState.targetScaleCompareMode;
      refreshTargetScaleCompareControl();
      renderResults();
    });
  }
  if (criterionClearBtn) {
    criterionClearBtn.addEventListener('click', () => clearDropZone('drop-criterion'));
  }
  if (criterionYearBtn && criterionZone) {
    criterionYearBtn.addEventListener('click', () => {
      const yearCandidate = getCandidateByKey('survey_year');
      if (!yearCandidate || !Array.isArray(yearCandidate.options) || yearCandidate.options.length < 2) {
        alert('연도별 비교에 사용할 조사 연도 데이터가 없습니다.');
        return;
      }
      clearDropZone('drop-criterion');
      addChip(criterionZone, { label: '조사 연도', key: 'survey_year', qno: 'SYS_YEAR' });
    });
  }

  host.addEventListener('dragstart', e => {
    const item = e.target.closest('.question-item');
    if (!item) return;

    let payload;
    if (item.classList.contains('selected')) {
      payload = selectedItems().map(el => ({
        label: el.dataset.label,
        qno: el.dataset.qno || ''
      }));
    } else {
      payload = [{ label: item.dataset.label, qno: item.dataset.qno || '' }];
    }

    e.dataTransfer.setData('text/plain', JSON.stringify({ items: payload }));
    e.dataTransfer.effectAllowed = 'copy';
    applyDragImage(e, item);
  });

  zones.forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');

      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (_) { return; }
      const items = Array.isArray(data.items) ? data.items : (data.label ? [data] : []);
      if (items.length === 0) return;

  const limit = parseInt(zone.dataset.limit, 10) || 20;
      const zoneName = zone.dataset.zone === 'target' ? '보고 싶은 문항' : '그룹별 비교';
      const existingLabels = new Set(
        Array.from(zone.querySelectorAll('.question-chip')).map(c => c.dataset.label)
      );

      let added = 0;
      let blockedByLimit = false;
      for (const data of items) {
        if (!data || !data.label) continue;
        const entry = resultState.codebookByLabel.get(data.label);
        if (zone.dataset.zone === 'criterion') {
          if (!entry || !isSingleChoiceType(entry.type)) continue;
        }
        if (existingLabels.has(data.label)) continue;
        const current = zone.querySelectorAll('.question-chip').length;
        if (current >= limit) { blockedByLimit = true; break; }
        addChip(zone, data);
        existingLabels.add(data.label);
        added++;
      }

      if (blockedByLimit) {
        const remaining = items.length - added;
        alert(`${zoneName} 문항은 최대 ${limit}개까지 추가할 수 있습니다. (추가됨 ${added}개, 제외됨 ${remaining}개)`);
      }

      clearSelection();
    });
  });

  function addChip(zone, data) {
    const chip = document.createElement('span');
    chip.className = 'question-chip';
    chip.dataset.label = data.label;
    chip.dataset.key = data.key || data.label;
    chip.dataset.qno = data.qno || '';
    chip.innerHTML = `
      <span class="question-chip-label">${escapeHtml(data.label)}</span>
      <button type="button" class="remove-btn" aria-label="제거">×</button>
    `;
    chip.querySelector('.remove-btn').addEventListener('click', () => {
      chip.remove();
      refreshZoneState(zone);
    });
    zone.appendChild(chip);
    refreshZoneState(zone);
  }

  function refreshZoneState(zone) {
    const chips = zone.querySelectorAll('.question-chip');
    zone.classList.toggle('has-chip', chips.length > 0);
    if (zone.dataset.zone === 'target') refreshTargetScaleCompareControl();
  }
}

// 코드북과 라벨형 응답 데이터를 기준으로 동적 필터를 구성합니다.
const filterState = {
  candidates: [],
  activeKeys: [],
  selectedMap: new Map(),
  defaultKeys: [],
  rows: [],
  valueRows: [],
  headerMap: new Map(),
  valueHeaderMap: new Map(),
  draggingKey: null,
  openKey: null
};

const FILTER_OPTION_MAX_COUNT = 60;

/**
 * 코드북·라벨 데이터로 필터 후보(연도·응답값 등)를 구성합니다.
 */
function buildFilterCandidates(codebookRows, labelRows) {
  const header = (labelRows && labelRows[0] || []).map(cleanCell);
  const headerMap = new Map();
  header.forEach((name, idx) => headerMap.set(name, idx));

  const candidates = [];
  if (headerMap.has('survey_year')) {
    const yearIdx = headerMap.get('survey_year');
    const yearOptions = [];
    const yearSeen = new Set();
    for (let i = 1; i < (labelRows || []).length; i++) {
      const value = cleanCell((labelRows[i] || [])[yearIdx]);
      if (!value || yearSeen.has(value)) continue;
      yearSeen.add(value);
      yearOptions.push(value);
    }
    if (yearOptions.length > 1) {
      candidates.push({
        key: 'survey_year',
        label: '조사 연도',
        category1: 'system',
        options: yearOptions,
        priority: 3,
        fixed: true
      });
    }
  }

  const codebookHeader = (codebookRows && codebookRows[0] || []).map(normalizeHeader);
  const col = name => codebookHeader.indexOf(name);
  const iCat1 = col('category_1');
  const iLabel = col('question_label');
  const iRole = col('data_column_role');
  const iType = col('response_type');
  const iOptions = col('response_options');

  const seen = new Set();
  for (let r = 1; r < (codebookRows || []).length; r++) {
    const row = codebookRows[r] || [];
    const label = cleanCell(row[iLabel]);
    const cat1 = cleanCell(row[iCat1]);
    const role = cleanCell(row[iRole]).toLowerCase();
    const type = cleanCell(row[iType]);
    if (!label || seen.has(label)) continue;
    if (role !== 'raw') continue;
    if (!type.includes('객관식 단일')) continue;
    if (!headerMap.has(label)) continue;

    const idx = headerMap.get(label);
    const options = [];
    const optionSeen = new Set();

    const responseOptions = cleanCell(row[iOptions]);
    if (responseOptions) {
      responseOptions.split('|').map(cleanCell).forEach(option => {
        if (!option || optionSeen.has(option)) return;
        optionSeen.add(option);
        options.push(option);
      });
    }

    // 코드북 옵션이 비어 있거나 불완전한 경우에만 실제 라벨 데이터 값을 보조로 사용합니다.
    if (options.length === 0) {
      for (let i = 1; i < (labelRows || []).length; i++) {
        const value = cleanCell((labelRows[i] || [])[idx]);
        if (!value || optionSeen.has(value)) continue;
        optionSeen.add(value);
        options.push(value);
      }
    }

    if (options.length < 2 || options.length > FILTER_OPTION_MAX_COUNT) continue;

    seen.add(label);
    candidates.push({
      key: label,
      label,
      category1: cat1,
      options,
      priority: cat1 === '응답자 정보' ? 2 : 1,
      fixed: false
    });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return { candidates, headerMap };
}

/**
 * 필터 후보에서 기본으로 켤 필터 키 목록을 반환합니다.
 */
function getDefaultFilterKeys(candidates) {
  const fixed = candidates.filter(item => item.fixed).map(item => item.key);
  const respondentSingles = candidates
    .filter(item => item.category1 === '응답자 정보' && !item.fixed)
    .slice(0, 5)
    .map(item => item.key);

  if (respondentSingles.length > 0) return [...fixed, ...respondentSingles];
  return [...fixed, ...candidates.filter(item => !item.fixed).slice(0, 4).map(item => item.key)];
}

/**
 * 현재 활성화된 필터 슬롯 항목을 반환합니다.
 */
function getActiveFilterItems() {
  return filterState.activeKeys
    .map(key => filterState.candidates.find(item => item.key === key))
    .filter(Boolean);
}

/**
 * 특정 필터 키에 선택된 값 집합을 반환합니다.
 */
function getSelectedValues(key) {
  return filterState.selectedMap.get(key) || new Set();
}

/**
 * 필터 키에 해당하는 후보 메타데이터를 반환합니다.
 */
function getCandidateByKey(key) {
  return filterState.candidates.find(item => item.key === key) || null;
}

/**
 * 현재 필터에 통과한 응답 행 인덱스 배열을 반환합니다.
 */
function getFilteredRowIndexes() {
  const rows = filterState.rows || [];
  if (rows.length < 2) return [];
  const indexes = [];
  rows.slice(1).forEach((row, offset) => {
    const matched = getActiveFilterItems().every(item => {
      const selected = getSelectedValues(item.key);
      if (selected.size === 0) return true;
      const idx = filterState.headerMap.get(item.key);
      const value = cleanCell((row || [])[idx]);
      return selected.has(value);
    });
    if (matched) indexes.push(offset + 1);
  });
  return indexes;
}

/**
 * 필터 통과 행 수를 반환합니다.
 */
function getFilteredRowCount() {
  return getFilteredRowIndexes().length;
}

/**
 * 행 배열에서 주어진 인덱스만 골라 부분 배열을 만듭니다.
 */
function getRowsByIndexes(rows, indexes) {
  if (!Array.isArray(rows) || !Array.isArray(indexes)) return [];
  return indexes.map(index => rows[index]).filter(Boolean);
}

/**
 * 필터 UI의 응답 수 표시를 갱신합니다.
 */
function updateFilterCount() {
  const nEl = document.getElementById('n-count');
  if (!nEl) return;
  const n = getFilteredRowCount();
  nEl.textContent = n.toLocaleString();
}

/**
 * 필터 한 줄 요약 HTML을 생성합니다.
 */
function renderFilterSummary(item) {
  const selected = getSelectedValues(item.key);
  if (selected.size === 0) return '전체';
  const labels = Array.from(selected).slice(0, 2);
  return `${labels.join(', ')}${selected.size > 2 ? ' 외' : ''}`;
}

/**
 * 필터 패널 전체 DOM을 다시 그립니다.
 */
function renderFilters() {
  const listEl = document.getElementById('filter-list');
  const addWrap = document.getElementById('filter-add');
  const addMenu = document.getElementById('filter-add-menu');
  if (!listEl || !addWrap || !addMenu) return;

  listEl.innerHTML = '';
  getActiveFilterItems().forEach(item => {
    const selected = getSelectedValues(item.key);
    const wrap = document.createElement('div');
    wrap.className = 'filter-control' + (selected.size > 0 ? ' active' : '') + (item.fixed ? '' : ' draggable');
    wrap.dataset.key = item.key;
    wrap.draggable = !item.fixed;
    wrap.innerHTML = `
      <button type="button" class="filter-control-btn">
        <span class="filter-control-title">${escapeHtml(item.label)}</span>
        <span class="filter-control-summary">${escapeHtml(renderFilterSummary(item))}</span>
        ${selected.size > 0 ? `<span class="filter-control-count${selected.size >= 100 ? ' digits-3' : selected.size >= 10 ? ' digits-2' : ''}">${selected.size}</span>` : ''}
        ${item.fixed ? '' : '<span class="filter-remove-mark">×</span>'}
      </button>
      <div class="filter-menu"></div>
    `;
    const menu = wrap.querySelector('.filter-menu');
    const menuScroll = document.createElement('div');
    menuScroll.className = 'filter-menu-scroll';
    menu.appendChild(menuScroll);
    item.options.forEach(option => {
      const checked = selected.has(option) ? 'checked' : '';
      const row = document.createElement('label');
      row.className = 'filter-option';
      row.innerHTML = `
        <input type="checkbox" value="${escapeHtml(option)}" ${checked}>
        <span class="filter-option-label">${escapeHtml(option)}</span>
      `;
      menuScroll.appendChild(row);
    });

    const btn = wrap.querySelector('.filter-control-btn');
    btn.addEventListener('click', e => {
      const removeClick = !item.fixed && e.target && e.target.closest('.filter-remove-mark');
      if (removeClick) {
        filterState.activeKeys = filterState.activeKeys.filter(key => key !== item.key);
        filterState.selectedMap.delete(item.key);
        renderFilters();
        updateFilterCount();
        return;
      }
      document.querySelectorAll('.filter-control.open').forEach(el => {
        if (el !== wrap) el.classList.remove('open');
      });
      addWrap.classList.remove('open');
      wrap.classList.toggle('open');
      filterState.openKey = wrap.classList.contains('open') ? item.key : null;
      requestAnimationFrame(() => positionPopupWithinMainArea(wrap, wrap.querySelector('.filter-menu')));
    });

    if (!item.fixed) {
      wrap.addEventListener('dragstart', e => {
        filterState.draggingKey = item.key;
        wrap.classList.add('dragging');
        document.body.classList.add('filter-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.key);
          applyDragImage(e, wrap);
        }
      });
      wrap.addEventListener('dragend', () => {
        filterState.draggingKey = null;
        document.body.classList.remove('filter-dragging');
        document.querySelectorAll('.filter-control.drag-over, .filter-control.drop-before, .filter-control.drop-after')
          .forEach(el => el.classList.remove('drag-over', 'drop-before', 'drop-after'));
        wrap.classList.remove('dragging');
      });
      wrap.addEventListener('dragover', e => {
        if (!filterState.draggingKey || filterState.draggingKey === item.key) return;
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        wrap.classList.toggle('drop-before', before);
        wrap.classList.toggle('drop-after', !before);
        wrap.classList.add('drag-over');
      });
      wrap.addEventListener('dragleave', () => {
        wrap.classList.remove('drag-over');
        wrap.classList.remove('drop-before', 'drop-after');
      });
      wrap.addEventListener('drop', e => {
        if (!filterState.draggingKey || filterState.draggingKey === item.key) return;
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        wrap.classList.remove('drag-over');
        wrap.classList.remove('drop-before', 'drop-after');
        moveActiveFilter(filterState.draggingKey, item.key, before);
      });
    }

    wrap.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        const next = new Set(
          Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value)
        );
        filterState.selectedMap.set(item.key, next);
        renderFilters();
        updateFilterCount();
      });
    });

    listEl.appendChild(wrap);

    if (filterState.openKey === item.key) {
      wrap.classList.add('open');
      requestAnimationFrame(() => positionPopupWithinMainArea(wrap, menu));
    }
  });

  const remaining = filterState.candidates.filter(item => !filterState.activeKeys.includes(item.key));
  addMenu.innerHTML = '';
  const addMenuScroll = document.createElement('div');
  addMenuScroll.className = 'filter-add-menu-scroll';
  addMenu.appendChild(addMenuScroll);
  if (remaining.length === 0) {
    addMenuScroll.innerHTML = '<div class="filter-add-empty">추가할 수 있는 필터가 없습니다.</div>';
  } else {
    remaining.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-add-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        filterState.activeKeys.push(item.key);
        filterState.selectedMap.set(item.key, new Set());
        addWrap.classList.remove('open');
        renderFilters();
        updateFilterCount();
      });
      addMenuScroll.appendChild(btn);
    });
  }

}

/**
 * 활성 필터 순서를 바꿉니다(드래그 정렬 등).
 */
function moveActiveFilter(sourceKey, targetKey, beforeTarget = true) {
  const sourceIndex = filterState.activeKeys.indexOf(sourceKey);
  const targetIndex = filterState.activeKeys.indexOf(targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

  const sourceItem = filterState.candidates.find(item => item.key === sourceKey);
  const targetItem = filterState.candidates.find(item => item.key === targetKey);
  if (!sourceItem || !targetItem) return;
  if (sourceItem.fixed || targetItem.fixed) return;

  const fixedKeys = filterState.activeKeys.filter(key => {
    const item = filterState.candidates.find(candidate => candidate.key === key);
    return item && item.fixed;
  });
  const movableKeys = filterState.activeKeys.filter(key => {
    const item = filterState.candidates.find(candidate => candidate.key === key);
    return !item || !item.fixed;
  });

  const from = movableKeys.indexOf(sourceKey);
  const to = movableKeys.indexOf(targetKey);
  if (from < 0 || to < 0) return;

  const [moved] = movableKeys.splice(from, 1);
  let insertIndex = to;
  if (!beforeTarget && from > to) insertIndex = to + 1;
  else if (beforeTarget && from < to) insertIndex = Math.max(0, to - 1);
  movableKeys.splice(insertIndex, 0, moved);
  filterState.activeKeys = [...fixedKeys, ...movableKeys];
  renderFilters();
}

/**
 * 앵커 기준으로 팝업 메뉴 위치를 메인 영역 안에 맞춥니다.
 */
function positionPopupWithinMainArea(anchorEl, menuEl) {
  if (!anchorEl || !menuEl) return;
  const mainArea = document.querySelector('.main-area');
  if (!mainArea) return;

  const anchorRect = anchorEl.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  const mainRect = mainArea.getBoundingClientRect();

  if (menuEl.id === 'filter-add-menu') {
    // 오른쪽 정렬: 메뉴 오른쪽 끝을 anchor 오른쪽 끝에 맞춤
    menuEl.style.right = '0';
    menuEl.style.left = 'auto';
    const desiredRight = anchorRect.right;
    const clampedRight = Math.min(desiredRight, mainRect.right - 8);
    menuEl.style.right = `${anchorRect.right - clampedRight}px`;
  } else {
    menuEl.style.left = '0';
    menuEl.style.right = 'auto';
    const desiredLeft = Math.min(
      Math.max(anchorRect.left, mainRect.left + 8),
      Math.max(mainRect.left + 8, mainRect.right - menuRect.width - 8)
    );
    menuEl.style.left = `${desiredLeft - anchorRect.left}px`;
  }
}

/**
 * 기준(분모) 연도 버튼 표시 여부를 현재 상태에 맞게 조정합니다.
 */
function updateCriterionYearButtonVisibility() {
  const criterionYearBtn = document.getElementById('criterion-year-btn');
  if (!criterionYearBtn) return;
  const yearCandidate = getCandidateByKey('survey_year');
  const isVisible = !!(yearCandidate && Array.isArray(yearCandidate.options) && yearCandidate.options.length > 1);
  criterionYearBtn.hidden = !isVisible;
}

/**
 * 필터 UI를 초기화하고 후보를 채운 뒤 이벤트를 연결합니다.
 */
async function setupFilters() {
  const currentId = sessionStorage.getItem('survey.currentId');
  const nEl = document.getElementById('n-count');
  if (!currentId || !nEl) return;

  const surveys = loadSurveys();
  const cur = surveys.find(s => s.id === currentId);
  if (!cur || !cur.files || !cur.files.codebook || !cur.files.label) {
    filterState.candidates = [];
    filterState.activeKeys = [];
    filterState.selectedMap = new Map();
    filterState.rows = [];
    filterState.valueRows = [];
    filterState.headerMap = new Map();
    filterState.valueHeaderMap = new Map();
    renderFilters();
    nEl.textContent = '0';
    return;
  }

  const codebookRows = await loadCodebookRows(cur.files.codebook);
  const labelRows = await loadCodebookRows(cur.files.label);
  const valueRows = cur.files.value ? await loadCodebookRows(cur.files.value) : [];
  const { candidates, headerMap } = buildFilterCandidates(codebookRows || [], labelRows || []);
  const safeValueRows = (valueRows && valueRows.length >= 2) ? valueRows : (labelRows || []);
  const valueHeader = (safeValueRows && safeValueRows[0] || []).map(cleanCell);
  const valueHeaderMap = new Map();
  valueHeader.forEach((name, idx) => valueHeaderMap.set(name, idx));

  filterState.candidates = candidates;
  filterState.defaultKeys = getDefaultFilterKeys(candidates);
  const fixedKeys = candidates.filter(item => item.fixed).map(item => item.key);
  filterState.activeKeys = filterState.activeKeys.length
    ? filterState.activeKeys.filter(key => candidates.some(item => item.key === key))
    : [...filterState.defaultKeys];
  fixedKeys.forEach(key => {
    if (!filterState.activeKeys.includes(key)) filterState.activeKeys.unshift(key);
  });
  filterState.rows = labelRows || [];
  filterState.valueRows = safeValueRows || [];
  filterState.headerMap = headerMap;
  filterState.valueHeaderMap = valueHeaderMap;

  const nextSelectedMap = new Map();
  filterState.activeKeys.forEach(key => {
    const prev = filterState.selectedMap.get(key);
    nextSelectedMap.set(key, prev instanceof Set ? prev : new Set());
  });
  filterState.selectedMap = nextSelectedMap;

  renderFilters();
  updateCriterionYearButtonVisibility();
  updateFilterCount();
  setupFilterListeners();
}

/**
 * 필터 변경 시 결과 갱신 등 리스너를 등록합니다.
 */
function setupFilterListeners() {
  const addWrap = document.getElementById('filter-add');
  const addMenu = document.getElementById('filter-add-menu');
  const addBtn = document.getElementById('filter-add-btn');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', () => {
      document.querySelectorAll('.filter-control.open').forEach(el => el.classList.remove('open'));
      filterState.openKey = null;
      addWrap.classList.toggle('open');
      requestAnimationFrame(() => positionPopupWithinMainArea(addWrap, addMenu));
    });
  }
  if (!document.body.dataset.filterCloseBound) {
    document.body.dataset.filterCloseBound = '1';
    document.addEventListener('click', e => {
      if (!e.target.closest('.filter-control')) {
        document.querySelectorAll('.filter-control.open').forEach(el => el.classList.remove('open'));
        filterState.openKey = null;
      }
      if (!e.target.closest('.filter-add')) {
        const add = document.getElementById('filter-add');
        if (add) add.classList.remove('open');
      }
    });
  }
}

/**
 * 저장된 설문 이름을 바꿉니다(스토리지 반영).
 */
function renameSurvey(id, newTitle) {
  const clean = String(newTitle || '').trim().slice(0, 50);
  if (!clean) return false;
  const list = loadSurveys();
  const idx = list.findIndex(s => s.id === id);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], title: clean, updatedAt: new Date().toISOString() };
  saveSurveys(list);
  if (sessionStorage.getItem('survey.currentId') === id) {
    try { sessionStorage.setItem('survey.title', clean); } catch (_) {}
    const el = document.getElementById('project-title');
    if (el) el.textContent = clean;
  }
  return true;
}

// 설문 제목 수정, 저장된 대시보드 목록 모달, 저장 버튼 동작을 연결합니다.
/**
 * 설문 제목 인라인 편집 UI를 연결합니다.
 */
function setupTitleRename() {
  const titleEl = document.getElementById('project-title');
  const inputEl = document.getElementById('project-title-input');
  const editBtn = document.getElementById('title-edit-btn');
  if (!titleEl || !inputEl || !editBtn) return;

  function startEdit() {
    inputEl.value = titleEl.textContent;
    titleEl.hidden = true;
    editBtn.hidden = true;
    inputEl.hidden = false;
    inputEl.focus();
    inputEl.select();
  }

  function commit() {
    const next = inputEl.value.trim().slice(0, 50);
    const prev = titleEl.textContent;
    if (next && next !== prev) {
      const currentId = sessionStorage.getItem('survey.currentId');
      if (currentId) {
        renameSurvey(currentId, next);
      } else {
        titleEl.textContent = next;
        try { sessionStorage.setItem('survey.title', next); } catch (_) {}
      }
    }
    titleEl.hidden = false;
    editBtn.hidden = false;
    inputEl.hidden = true;
  }

  function cancel() {
    titleEl.hidden = false;
    editBtn.hidden = false;
    inputEl.hidden = true;
  }

  editBtn.addEventListener('click', startEdit);
  titleEl.addEventListener('dblclick', startEdit);
  inputEl.addEventListener('blur', commit);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inputEl.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); inputEl.value = titleEl.textContent; cancel(); }
  });
}

/**
 * 저장된 설문 목록 모달을 구성하고 이벤트를 연결합니다.
 */
function setupSavedModal() {
  // NOTE: Saved dashboard list modal is handled by `js/saved-list-modal.js` (DOM injected).
  // This function now only wires dashboard-local controls (data update modal, exports, etc.).
  const newBtn = document.getElementById('new-analysis-btn');
  const dataUpdateBtn = document.getElementById('dashboard-data-update-btn');
  const dataUpdateModal = document.getElementById('data-update-modal');
  const closeDataUpdateBtn = document.getElementById('close-data-update-btn');
  const dataUpdateList = document.getElementById('data-update-list');
  const dataUpdateFileInput = document.getElementById('data-update-file-input');
  const applyDataUpdateBtn = document.getElementById('apply-data-update-btn');
  const dataUpdateCategoryGroup = document.getElementById('data-update-category-group');
  const categoryChangeWrap = document.getElementById('category-change');
  const categoryChangeTitle = document.getElementById('category-change-title');
  const categoryChangeSummary = document.getElementById('category-change-summary');
  const CATEGORY_LABELS = { consulting: '컨설팅', research: '리서치', other: '기타' };
  let pendingDataUpdates = {};
  let pendingCategory = null;

  function getCurrentSurvey() {
    const currentId = sessionStorage.getItem('survey.currentId');
    const surveys = loadSurveys();
    return {
      currentId,
      surveys,
      current: surveys.find(s => s.id === currentId)
    };
  }

  function resetPendingDataUpdates() {
    pendingDataUpdates = {};
    pendingCategory = null;
    if (dataUpdateFileInput) {
      dataUpdateFileInput.value = '';
      delete dataUpdateFileInput.dataset.targetKey;
    }
  }

  function syncCategoryPills() {
    if (!dataUpdateCategoryGroup) return;
    const { current } = getCurrentSurvey();
    const activeCategory = pendingCategory || (current && current.category) || null;
    dataUpdateCategoryGroup.querySelectorAll('[data-category]').forEach(cb => {
      cb.checked = cb.dataset.category === activeCategory;
    });
    updateCategoryChangeButton();
  }

  function updateCategoryChangeButton() {
    if (!categoryChangeWrap || !categoryChangeSummary) return;
    if (pendingCategory) {
      if (categoryChangeTitle) categoryChangeTitle.hidden = false;
      categoryChangeSummary.textContent = CATEGORY_LABELS[pendingCategory];
    } else {
      if (categoryChangeTitle) categoryChangeTitle.hidden = true;
      categoryChangeSummary.textContent = '설문 종류 변경';
    }
    categoryChangeWrap.classList.toggle('active', !!pendingCategory);
  }

  function updateApplyButtonState() {
    if (!applyDataUpdateBtn) return;
    const { current } = getCurrentSurvey();
    const categoryChanged = !!pendingCategory && pendingCategory !== (current && current.category);
    applyDataUpdateBtn.disabled = Object.keys(pendingDataUpdates).length === 0 && !categoryChanged;
  }

  function renderDataUpdateList() {
    if (!dataUpdateList) return;
    const { current } = getCurrentSurvey();
    if (!current || !current.files) {
      dataUpdateList.innerHTML = '<div class="saved-empty">현재 연결된 데이터가 없습니다.</div>';
      if (applyDataUpdateBtn) applyDataUpdateBtn.disabled = true;
      return;
    }
    const items = [
      { key: 'codebook', label: '문항 코드북', file: current.files.codebook },
      { key: 'value', label: '응답 데이터셋_숫자형', file: current.files.value },
      { key: 'label', label: '응답 데이터셋_텍스트형', file: current.files.label }
    ];
    dataUpdateList.innerHTML = items.map(item => {
      const pending = pendingDataUpdates[item.key];
      const filename = (pending && pending.file && pending.file.name) || (item.file && item.file.name) || '파일 없음';
      return `
        <div class="saved-item data-update-item">
          <div class="saved-main">
            <div class="saved-title">${escapeHtml(item.label)}</div>
            <div class="saved-meta">
              ${escapeHtml(filename)}
              ${pending ? '<span class="data-update-status">(Updated)</span>' : ''}
            </div>
          </div>
          <div class="saved-actions">
            <button type="button" class="saved-rename data-update-trigger" data-file-update="${item.key}">
              <img class="data-update-trigger-icon" src="assets/icons/autorenew_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="">
              파일 교체하기
            </button>
          </div>
        </div>
      `;
    }).join('');

    dataUpdateList.querySelectorAll('[data-file-update]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!dataUpdateFileInput) return;
        dataUpdateFileInput.dataset.targetKey = btn.dataset.fileUpdate;
        dataUpdateFileInput.click();
      });
    });

    updateApplyButtonState();
  }

  async function handleDataFileReplace(file, key) {
    if (!file || !key) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'csv') {
      throw new Error('지원하지 않는 파일 형식입니다. .csv 파일만 업로드할 수 있습니다.');
    }
    const parsedUpload = await readTabularFile(file);
    const fileResult = validateFileForKey(key, parsedUpload.rows);
    if (!fileResult.ok) throw new Error(fileResult.error);

    pendingDataUpdates[key] = {
      file: {
        name: file.name,
        size: file.size,
        contentType: parsedUpload.contentType,
        content: parsedUpload.content
      },
      rows: parsedUpload.rows
    };
    renderDataUpdateList();
  }

  async function applyDataFileUpdates() {
    const { currentId, surveys, current } = getCurrentSurvey();
    if (!currentId || !current) {
      alert('현재 대시보드를 찾을 수 없습니다.');
      return;
    }
    const idx = surveys.findIndex(s => s.id === currentId);
    if (idx < 0) return;
    const categoryChanged = !!pendingCategory && pendingCategory !== current.category;
    if (Object.keys(pendingDataUpdates).length === 0 && !categoryChanged) {
      alert('먼저 교체할 파일을 선택하거나 분류를 변경해 주세요.');
      return;
    }

    const currentFiles = surveys[idx].files || {};
    const rowsByKey = {
      codebook: pendingDataUpdates.codebook ? pendingDataUpdates.codebook.rows : await loadCodebookRows(currentFiles.codebook),
      value: pendingDataUpdates.value ? pendingDataUpdates.value.rows : await loadCodebookRows(currentFiles.value),
      label: pendingDataUpdates.label ? pendingDataUpdates.label.rows : await loadCodebookRows(currentFiles.label)
    };
    const bundleResult = validateBundleConsistency(rowsByKey);
    if (!bundleResult.ok) {
      alert(`${bundleResult.error}\n\n파일을 다시 교체한 뒤 분석하기를 다시 눌러 주세요.`);
      return;
    }

    const nextFiles = { ...(surveys[idx].files || {}) };
    for (const key of ['codebook', 'value', 'label']) {
      const pending = pendingDataUpdates[key];
      if (!pending || !pending.file) continue;
      let storedRef = pending.file;
      try {
        const persisted = await persistStoredFile(currentId, key, pending.file);
        if (persisted) storedRef = persisted;
      } catch (_) {}
      nextFiles[key] = storedRef;
    }

    surveys[idx] = {
      ...surveys[idx],
      files: nextFiles,
      category: categoryChanged ? pendingCategory : surveys[idx].category,
      updatedAt: new Date().toISOString()
    };
    if (!(await saveSurveys(surveys))) return;

    resultState.codebookByLabel = new Map();
    try { await setupFilters(); } catch (_) {}
    try {
      const rows = await loadCodebookRows(nextFiles.codebook);
      if (rows) {
        resultState.codebookByLabel = buildCodebookIndex(rows);
        renderTree(buildQuestionTree(rows));
      }
    } catch (_) {}

    resetPendingDataUpdates();
    renderDataUpdateList();
    if (dataUpdateModal) dataUpdateModal.classList.remove('show');
    renderResults();
  }

  /* 이미지 추출 기능 */

  if (newBtn) newBtn.addEventListener('click', () => { window.location.href = 'home.html'; });
  const exportAllPptxBtn = document.getElementById('export-all-pptx-btn');
  if (exportAllPptxBtn) exportAllPptxBtn.addEventListener('click', () => exportAllSectionsAsPptx(exportAllPptxBtn));

  if (dataUpdateCategoryGroup) {
    dataUpdateCategoryGroup.querySelectorAll('[data-category]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          dataUpdateCategoryGroup.querySelectorAll('[data-category]').forEach(other => {
            if (other !== cb) other.checked = false;
          });
          pendingCategory = cb.dataset.category;
        } else {
          pendingCategory = null;
        }
        updateApplyButtonState();
        updateCategoryChangeButton();
      });
    });
  }

  const categoryChangeBtn = document.getElementById('category-change-btn');
  if (categoryChangeWrap && categoryChangeBtn) {
    categoryChangeBtn.addEventListener('click', e => {
      e.stopPropagation();
      categoryChangeWrap.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#category-change')) {
        categoryChangeWrap.classList.remove('open');
      }
    });
  }

  if (dataUpdateBtn && dataUpdateModal) {
    dataUpdateBtn.addEventListener('click', () => {
      resetPendingDataUpdates();
      renderDataUpdateList();
      syncCategoryPills();
      dataUpdateModal.classList.add('show');
    });
  }
  if (closeDataUpdateBtn && dataUpdateModal) {
    closeDataUpdateBtn.addEventListener('click', () => {
      resetPendingDataUpdates();
      dataUpdateModal.classList.remove('show');
    });
    dataUpdateModal.addEventListener('click', e => {
      if (e.target === dataUpdateModal) {
        resetPendingDataUpdates();
        dataUpdateModal.classList.remove('show');
      }
    });
  }
  if (applyDataUpdateBtn) {
    applyDataUpdateBtn.addEventListener('click', async () => {
      applyDataUpdateBtn.disabled = true;
      applyDataUpdateBtn.textContent = '데이터 교체 중...';
      try {
        await applyDataFileUpdates();
      } catch (err) {
        alert((err && err.message) || '파일 분석 중 오류가 발생했습니다. 업로드 파일을 다시 확인해 주세요.');
      } finally {
        applyDataUpdateBtn.disabled = false;
        applyDataUpdateBtn.textContent = '대시보드 업데이트';
      }
    });
  }

  if (dataUpdateFileInput) {
    dataUpdateFileInput.addEventListener('change', async () => {
      const file = dataUpdateFileInput.files && dataUpdateFileInput.files[0];
      const key = dataUpdateFileInput.dataset.targetKey;
      try {
        await handleDataFileReplace(file, key);
      } catch (err) {
        alert((err && err.message) || '파일 교체 중 오류가 발생했습니다. 업로드 파일과 연결된 데이터 구조를 확인해 주세요.');
      } finally {
        dataUpdateFileInput.value = '';
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (dataUpdateModal) {
      resetPendingDataUpdates();
      dataUpdateModal.classList.remove('show');
    }
  });
}

/* =====================================================================
   2) Chart Renderers (HTML builders)
   - data_visualization.md 의 유형별 규칙을 따른다.
   ===================================================================== */

const DATA_VIZ_COLORS = {
  categorical: [
    'var(--color-1)',  'var(--color-2)',  'var(--color-3)',  'var(--color-4)',
    'var(--color-5)',  'var(--color-6)',  'var(--color-7)',  'var(--color-8)',
    'var(--color-9)',  'var(--color-10)', 'var(--color-11)', 'var(--color-12)',
    'var(--color-13)', 'var(--color-14)', 'var(--color-15)', 'var(--color-16)',
    'var(--color-17)', 'var(--color-18)', 'var(--color-19)', 'var(--color-20)'
  ],
  singleBar: 'var(--neutral-700)',
  compareBar: 'var(--neutral-300)',
  scaleLow: 'var(--color-2)',
  scaleMid: 'var(--neutral-300)',
  scaleHigh: 'var(--color-1)',
  rankStack: [
    'var(--neutral-700)',
    'var(--neutral-400)',
    'var(--neutral-300)',
    'var(--neutral-200)',
    'var(--neutral-100)'
  ]
};

const GROUP_PALETTE = DATA_VIZ_COLORS.categorical;
const ALLOCATION_PALETTE = DATA_VIZ_COLORS.categorical;
const CUSTOM_GROUP_PALETTE = [
  'var(--color-11)', 'var(--color-12)', 'var(--color-13)', 'var(--color-14)',
  'var(--color-15)', 'var(--color-16)', 'var(--color-17)', 'var(--color-18)'
];
const SINGLE_BAR_COLOR = DATA_VIZ_COLORS.singleBar;
const HBAR_INSIDE_VALUE_THRESHOLD = 90;

const CHOICE_CHART_TYPES = ['bar_horizontal', 'bar_vertical', 'bar_horizontal_100', 'pie'];
const CHOICE_CHART_TYPE_LABELS = {
  bar_horizontal: '가로 막대',
  bar_vertical: '세로 막대',
  bar_horizontal_100: '100% 기준 누적 가로 막대',
  pie: '원형(파이)'
};
const RANK_CHART_TYPES = ['lollipop', 'stacked'];
const RANK_CHART_TYPE_LABELS = {
  lollipop: '가중 평균',
  stacked: '응답 비율'
};
const RANK_LOLLIPOP_COLOR = DATA_VIZ_COLORS.singleBar;
const RANK_STACK_PALETTE = DATA_VIZ_COLORS.rankStack;
const SCALE_CHART_TYPES = ['bar_horizontal_100', 'pie'];
const RATIO_CHART_TYPES = ['bar_horizontal_100', 'pie'];
const SCALE_RATIO_CHART_TYPE_LABELS = {
  bar_horizontal_100: '가로 누적 막대',
  pie: '원 그래프'
};
/**
 * 차트 팔레트용 고정/순환 색 값을 반환합니다.
 */
function rankStackColor(idx) {
  if (idx < RANK_STACK_PALETTE.length) return RANK_STACK_PALETTE[idx];
  return RANK_STACK_PALETTE[RANK_STACK_PALETTE.length - 1];
}

/**
 * 순위 차트/정렬 관련 설정값을 반환합니다.
 */
function getRankWeight(rankCount, rankIndex) {
  return Math.max(1, (2 * (rankCount - rankIndex)) - 1);
}

/**
 * 순위 평균/가중 등 표시용 문자열로 포맷합니다.
 */
function formatRankAverage(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankWeightFormulaText(rankCount) {
  const safeRankCount = Math.max(1, Number(rankCount) || 1);
  const weights = Array.from({ length: safeRankCount }, (_, index) => getRankWeight(safeRankCount, index));
  const formula = weights.map((weight, index) => `${index + 1}순위×${weight}`).join(' + ');
  const maxScore = weights[0] || 1;
  return `각 보기의 가중 평균 점수는 순위별 응답 수에 가중치를 곱해 합산한 뒤 전체 응답자 수로 나눈 값입니다. 예) ${safeRankCount}순위까지 선택하는 경우: (${formula}) ÷ 전체 응답자 수 (만점: ${maxScore}점)`;
}

const SCALE_5PT = [
  DATA_VIZ_COLORS.scaleLow, // 1
  'var(--low-3)',       // 2
  DATA_VIZ_COLORS.scaleMid, // 3
  'var(--high-3)',      // 4
  DATA_VIZ_COLORS.scaleHigh, // 5
];
const SCALE_7PT = [
  DATA_VIZ_COLORS.scaleLow, // 1
  'var(--low-4)',       // 2
  'var(--low-2)',       // 3
  DATA_VIZ_COLORS.scaleMid, // 4
  'var(--high-2)',      // 5
  'var(--high-4)',      // 6
  DATA_VIZ_COLORS.scaleHigh, // 7
];

/**
 * 현재 UI/상태/인덱스에서 파생 값을 조회합니다.
 */
function getScaleColor(score, maxScore) {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 1) return 'var(--neutral-300)';
  if (maxScore === 5) return SCALE_5PT[Math.max(0, Math.min(4, score - 1))];
  if (maxScore === 7) return SCALE_7PT[Math.max(0, Math.min(6, score - 1))];
  const palette = SCALE_7PT;
  const idx = Math.round(((score - 1) * (palette.length - 1)) / (maxScore - 1));
  return palette[Math.max(0, Math.min(palette.length - 1, idx))];
}

/**
 * 현재 UI/상태/인덱스에서 파생 값을 조회합니다.
 */
function getScaleMutedColor(score, maxScore) {
  return `color-mix(in srgb, ${getScaleColor(score, maxScore)} 30%, transparent)`;
}

const resultState = {
  codebookByLabel: new Map(),
  codebookRowsByLabel: new Map(),
  hiddenGroupKeys: new Map(),
  hiddenRankKeys: new Map(),
  hiddenTableKeys: new Set(),
  choiceSortModes: new Map(),
  rankViewModes: new Map(),
  rankSortModes: new Map(),
  numericHistogramConfigs: new Map(),
  numericOpenViewModes: new Map(),
  scaleViewModes: new Map(),
  scaleMidpointHidden: new Map(),
  scaleCompareSelections: new Map(),
  targetScaleCompareMode: false,
  targetScaleCompareSortByMean: false,
  scaleGroupSortByMean: new Map(),
  otherResponseTexts: new Map(),
  dataTableCollapsed: new Map(),
  singleChoiceChartTypes: new Map(),
  singleChoiceSortByRate: new Map(),
  multiChoiceSortByRate: new Map(),
  scaleChartTypes: new Map(),
  ratioChartTypes: new Map(),
  openChoiceMenus: new Set(),
  rankChartTypes: new Map(),
  rankSortByScore: new Map(),
  openRankMenus: new Set(),
  tooltipEl: null,
  initialized: false,
  customGroupDefs: new Map(),        // Map<criterionLabel, Array<{id, name}>>
  customGroupAssignments: new Map(), // Map<criterionLabel, Map<groupValue, groupId>>
  customGroupModes: new Set(),       // Set<targetLabel> - 그룹으로 묶어보기 활성화된 문항
  groupConfigModalState: null,
  dualBarModes: new Map(),           // Map<targetLabel, boolean> - 이중 막대 모드
  rank1stCardOpen: new Set(),        // Set<targetLabel> - 1순위 단독 카드 펼침 여부
  vizLabelColWidths: new Map(),      // Map<sectionKey, number> - 현재 화면에서만 유지되는 레이블 컬럼 너비
};

const TARGET_SCALE_COMPARE_VIEW_KEY = '__target_scale_compare__';
const VIZ_LABEL_COL_WIDTH_MIN = 96;
const VIZ_LABEL_COL_WIDTH_MAX = 360;
const VIZ_LABEL_COL_RESIZE_SELECTORS = [
  '.single-hbar-chart',
  '.dual-hbar-chart',
  '.stack-h-chart',
  '.lollipop-h-chart',
  '.dual-lollipop-h-chart',
  '.lane-group-chart'
].join(',');

/**
 * 코드북의 value_code_map 문자열을 코드→라벨 맵으로 파싱합니다.
 */
function parseValueCodeMap(text) {
  const map = new Map();
  String(text || '').split('|').forEach(part => {
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey || rest.length === 0) return;
    const key = cleanCell(rawKey);
    const value = cleanCell(rest.join('='));
    if (!key) return;
    map.set(key, value);
  });
  return map;
}

/**
 * 코드북 행으로 문항 메타데이터 인덱스(맵/배열)를 구축합니다.
 */
function buildCodebookIndex(codebookRows) {
  const map = new Map();
  const rowsByLabel = new Map();
  if (!codebookRows || codebookRows.length < 2) {
    resultState.codebookRowsByLabel = rowsByLabel;
    return map;
  }
  const header = (codebookRows[0] || []).map(normalizeHeader);
  const col = name => header.indexOf(name);
  const iLabel = col('question_label');
  const iFull = col('question_full');
  const iType = col('response_type');
  const iRole = col('data_column_role');
  const iOptions = col('response_options');
  const iOther = col('other_input_expected');
  const iCat1 = col('category_1');
  const iValueCount = col('value_count');
  const iValueCodeMap = col('value_code_map');
  const iNumberUnit = col('number_unit');

  for (let r = 1; r < codebookRows.length; r++) {
    const row = codebookRows[r] || [];
    const label = cleanCell(row[iLabel]);
    if (!label) continue;
    if (!rowsByLabel.has(label)) rowsByLabel.set(label, []);
    rowsByLabel.get(label).push(row);
    if (map.has(label)) continue;
    const opts = cleanCell(row[iOptions])
      .split('|').map(cleanCell).filter(Boolean);
    const vcRaw = iValueCount >= 0 ? cleanCell(row[iValueCount]) : '';
    const valueCount = vcRaw ? Number(vcRaw) : null;
    const valueCodeMap = iValueCodeMap >= 0 ? parseValueCodeMap(row[iValueCodeMap]) : new Map();
    map.set(label, {
      label,
      category1: iCat1 >= 0 ? cleanCell(row[iCat1]) : '',
      full: cleanCell(row[iFull]),
      type: cleanCell(row[iType]),
      role: cleanCell(row[iRole]),
      options: opts,
      otherInput: cleanCell(row[iOther]).toUpperCase() === 'Y',
      valueCount: Number.isFinite(valueCount) ? valueCount : null,
      valueCodeMap,
      numberUnit: iNumberUnit >= 0 ? cleanCell(row[iNumberUnit]) : ''
    });
  }
  resultState.codebookRowsByLabel = rowsByLabel;
  return map;
}

/**
 * 비교 대상으로 선택된 문항 라벨 목록을 반환합니다.
 */
function getTargetChipLabels() {
  return Array.from(document.querySelectorAll('#drop-target .question-chip'))
    .map(c => c.dataset.label)
    .filter(Boolean);
}
/**
 * 기준(분모) 문항 라벨을 반환합니다.
 */
function getCriterionChipLabel() {
  const chip = document.querySelector('#drop-criterion .question-chip');
  return chip ? (chip.dataset.key || chip.dataset.label) : null;
}

/**
 * 척도 다문항 비교 UI에서 그룹 식별 키를 만듭니다.
 */
function getScaleCompareGroupKey(entry) {
  if (!entry || !isScaleChoiceType(entry.type)) return '';
  const valueCount = Number(entry.valueCount);
  if (!Number.isFinite(valueCount)) return '';
  return String(Math.round(valueCount));
}

/**
 * 척도 비교에 쓸 대상 문항 라벨 목록을 반환합니다.
 */
function getTargetScaleCompareLabels(targetLabels = getTargetChipLabels()) {
  const scaleItems = targetLabels.map(label => {
    const entry = resultState.codebookByLabel.get(label);
    return { label, entry };
  }).filter(item => item.entry && isScaleChoiceType(item.entry.type));
  if (scaleItems.length !== targetLabels.length || scaleItems.length < 2) return [];

  const groups = new Map();
  scaleItems.forEach(({ label, entry }) => {
    const key = getScaleCompareGroupKey(entry);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(label);
  });
  if (groups.size !== 1) return [];
  const labels = Array.from(groups.values())[0] || [];
  return labels.length >= 2 ? labels : [];
}

/**
 * 척도 비교 대상 선택 컨트롤 표시를 최신 상태로 맞춥니다.
 */
function refreshTargetScaleCompareControl() {
  const btn = document.getElementById('target-scale-compare-btn');
  if (!btn) return;
  const labels = getTargetScaleCompareLabels();
  const enabled = labels.length >= 2;
  btn.disabled = !enabled;
  btn.classList.toggle('is-active', enabled);
  btn.textContent = resultState.targetScaleCompareMode ? '개별 문항 보기' : '여러 문항 한 번에 비교하기';
  if (!enabled) {
    resultState.targetScaleCompareMode = false;
    btn.classList.remove('is-active');
    btn.textContent = '여러 문항 한 번에 비교하기';
  }
}

/**
 * 지정 드롭존의 선택 칩을 비웁니다.
 */
function clearDropZone(zoneId) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.querySelectorAll('.question-chip').forEach(chip => chip.remove());
  zone.classList.remove('has-chip');
  if (zoneId === 'drop-target') refreshTargetScaleCompareControl();
}

/**
 * 필터가 적용된 라벨(텍스트) 응답 행을 반환합니다.
 */
function getFilteredLabelDataRows() {
  return getRowsByIndexes(filterState.rows || [], getFilteredRowIndexes());
}

/**
 * 필터가 적용된 값(코드) 응답 행을 반환합니다.
 */
function getFilteredValueDataRows() {
  const valueRows = filterState.valueRows || [];
  if ((filterState.rows || []).length < 2) return [];
  if (valueRows.length < 2) return getFilteredLabelDataRows();
  return getRowsByIndexes(valueRows, getFilteredRowIndexes());
}

/**
 * 코드북 response_type 등에서 "SingleChoice" 유형 여부를 판별합니다.
 */
function isSingleChoiceType(type) {
  return cleanCell(type).includes('객관식 단일');
}

/**
 * 코드북 response_type 등에서 "MultiChoice" 유형 여부를 판별합니다.
 */
function isMultiChoiceType(type) {
  return cleanCell(type).includes('객관식 중복');
}

/**
 * 코드북 response_type 등에서 "RankChoice" 유형 여부를 판별합니다.
 */
function isRankChoiceType(type) {
  return cleanCell(type).includes('객관식 순위');
}

/**
 * 코드북 response_type 등에서 "ScaleChoice" 유형 여부를 판별합니다.
 */
function isScaleChoiceType(type) {
  return cleanCell(type).includes('객관식 척도');
}

/**
 * 코드북 response_type 등에서 "NumericOpen" 유형 여부를 판별합니다.
 */
function isNumericOpenType(type) {
  return cleanCell(type).includes('주관식 숫자');
}

/**
 * 코드북 response_type 등에서 "TimeMinutesEntry" 유형 여부를 판별합니다.
 */
function isTimeMinutesEntry(entry) {
  if (!entry) return false;
  const type = cleanCell(entry.type);
  const role = cleanCell(entry.role).toLowerCase();
  const label = cleanCell(entry.label);
  const unit = cleanCell(entry.numberUnit);
  if (type.includes('주관식 시간') && role === 'derived' && label.includes('분환산')) return true;
  if (role === 'derived' && unit === '분') return true;
  return false;
}

/**
 * 코드북 response_type 등에서 "NumericOpenEntry" 유형 여부를 판별합니다.
 */
function isNumericOpenEntry(entry) {
  if (!entry) return false;
  return isNumericOpenType(entry.type) || isTimeMinutesEntry(entry);
}

/**
 * 코드북 response_type 등에서 "TimeOpenRawEntry" 유형 여부를 판별합니다.
 */
function isTimeOpenRawEntry(entry) {
  if (!entry) return false;
  return cleanCell(entry.type).includes('주관식 시간') && cleanCell(entry.role).toLowerCase() === 'raw';
}

/**
 * 시간(분) 파생 열에 대응하는 라벨 열을 찾습니다.
 */
function findTimeMinutesLabel(rawLabel) {
  const direct = rawLabel + '_분환산';
  if (resultState.codebookByLabel.has(direct)) return direct;
  for (const [label, entry] of resultState.codebookByLabel) {
    if (isTimeMinutesEntry(entry) && label.startsWith(rawLabel)) return label;
  }
  return null;
}

/**
 * 코드북 response_type 등에서 "RatioAllocation" 유형 여부를 판별합니다.
 */
function isRatioAllocationType(type) {
  return cleanCell(type).includes('주관식 비율 배분');
}

/**
 * 코드북 response_type 등에서 "TextOpen" 유형 여부를 판별합니다.
 */
function isTextOpenType(type) {
  return cleanCell(type).includes('주관식 문자');
}

/**
 * 해당 문항 유형/엔트리가 결과 패널에서 지원되는지 판별합니다.
 */
function supportsResultType(type) {
  return isSingleChoiceType(type)
    || isMultiChoiceType(type)
    || isRankChoiceType(type)
    || isScaleChoiceType(type)
    || isNumericOpenType(type)
    || isRatioAllocationType(type)
    || isTextOpenType(type);
}

/**
 * 해당 문항 유형/엔트리가 결과 패널에서 지원되는지 판별합니다.
 */
function supportsResultEntry(entry) {
  if (!entry) return false;
  if (supportsResultType(entry.type)) return true;
  if (isTimeMinutesEntry(entry)) return true;
  return isTimeOpenRawEntry(entry);
}

/**
 * 기준 문항 라벨에 해당하는 코드북 엔트리를 찾습니다.
 */
function getCriterionEntry(criterionLabel) {
  return resultState.codebookByLabel.get(criterionLabel) || (() => {
    const candidate = getCandidateByKey(criterionLabel);
    if (!candidate) return null;
    return {
      label: candidate.label,
      type: '객관식 단일',
      role: 'raw',
      options: candidate.options || []
    };
  })();
}

/**
 * 다중선택 문항의 선택지 목록(확장 포함)을 반환합니다.
 */
function getExpandedMultiOptionItems(targetLabel, entry) {
  if (!entry || !isMultiChoiceType(entry.type)) return [];

  const items = [];
  const usedLabels = new Set();
  const headerMap = filterState.headerMap || new Map();

  (entry.options || []).forEach(option => {
    const expandedLabel = `${targetLabel}__${option}`;
    if (!headerMap.has(expandedLabel)) return;
    items.push({ option, label: expandedLabel });
    usedLabels.add(expandedLabel);
  });

  resultState.codebookByLabel.forEach((candidate, label) => {
    if (!candidate || cleanCell(candidate.role).toLowerCase() !== 'expanded') return;
    if (!isMultiChoiceType(candidate.type)) return;
    if (!label.startsWith(`${targetLabel}__`)) return;
    if (!headerMap.has(label) || usedLabels.has(label)) return;

    const option = cleanCell(label.slice(targetLabel.length + 2));
    if (!option || option.includes('기타_텍스트') || option.includes('기타 텍스트')) return;
    items.push({ option, label });
    usedLabels.add(label);
  });

  return items;
}

/**
 * 다중선택 표기 문자열이 선택됨을 나타내는지 판별합니다.
 */
function isMarkedMultiSelected(value) {
  const normalized = cleanCell(value).toLowerCase();
  return normalized === '선택'
    || normalized === '1'
    || normalized === 'y'
    || normalized === 'yes'
    || normalized === 'true'
    || normalized === 'selected';
}

/**
 * 한 행에서 다중선택 값을 파싱해 선택지 배열로 만듭니다.
 */
function getMultiSelectionsFromRow(row, rawIdx, expandedItems) {
  const selected = [];
  const seen = new Set();

  (expandedItems || []).forEach(item => {
    const idx = filterState.headerMap.get(item.label);
    if (idx === undefined) return;
    if (!isMarkedMultiSelected((row || [])[idx])) return;
    if (seen.has(item.option)) return;
    seen.add(item.option);
    selected.push(item.option);
  });

  if (rawIdx === undefined) return selected;

  const rawValue = cleanCell((row || [])[rawIdx]);
  if (!rawValue) return selected;

  rawValue.split('|').map(cleanCell).filter(Boolean).forEach(option => {
    if (seen.has(option)) return;
    seen.add(option);
    selected.push(option);
  });

  return selected;
}

/* ---------- 공통 포맷 ---------- */
/**
 * 퍼센트·소수 표시 형식으로 포맷합니다.
 */
function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.0%';
  return `${(Math.round((num + 1e-10) * 10) / 10).toFixed(1)}%`;
}

/**
 * 선택지가 기타(직접입력) 옵션인지 판별합니다.
 */
function isOtherOption(option) {
  return cleanCell(option).includes('기타');
}

const PINNED_SORT_PATTERNS = ['기타', '해당사항없음', '잘모름', '모르겠음', '무응답', '응답거절'];
/**
 * 정렬 시 항상 끝/앞에 고정되는 옵션인지 판별합니다.
 */
function isPinnedSortOption(option) {
  const normalized = cleanCell(option).replace(/\s+/g, '');
  return PINNED_SORT_PATTERNS.some(pat => normalized === pat || normalized.startsWith(pat));
}

/* =========================================================
   [객관식 단일] 집계 / 렌더
   ========================================================= */
/**
 * 단일선택 문항을 기준(교차)별로 응답 분포를 집계합니다.
 */
function aggregateSingleFromColumn(targetLabel, criterionLabel, rows, options = {}) {
  const {
    sourceLabel = targetLabel,
    displayLabel = targetLabel,
    columnLabel = sourceLabel,
    columnIndex,
    entry = resultState.codebookByLabel.get(sourceLabel)
  } = options;
  if (!entry) return null;
  const tIdx = Number.isFinite(columnIndex)
    ? columnIndex
    : (filterState.headerMap ? filterState.headerMap.get(columnLabel) : undefined);
  if (tIdx === undefined) return null;

  const optionOrder = [...entry.options];
  const optionSet = new Set(optionOrder);
  const totalCount = {};
  optionOrder.forEach(o => totalCount[o] = 0);
  let totalN = 0;

  rows.forEach(row => {
    const v = cleanCell(row[tIdx]);
    if (v === '') return;
    if (!optionSet.has(v)) {
      optionSet.add(v);
      optionOrder.push(v);
      totalCount[v] = 0;
    }
    totalCount[v] = (totalCount[v] || 0) + 1;
    totalN += 1;
  });

  const totalResults = optionOrder.map(o => ({
    option: o,
    count: totalCount[o] || 0,
    pct: totalN > 0 ? ((totalCount[o] || 0) / totalN) * 100 : 0
  }));

  // 응답이 0건인 보기는 차트/테이블에서 모두 제외
  const visibleOptionOrder = optionOrder.filter(o => (totalCount[o] || 0) > 0);
  const visibleOptionSet = new Set(visibleOptionOrder);
  const visibleTotalResults = totalResults.filter(r => visibleOptionSet.has(r.option));

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      groupOrder.forEach(gv => {
        byGroup.set(gv, { n: 0, count: Object.fromEntries(optionOrder.map(o => [o, 0])) });
      });

      rows.forEach(row => {
        const gv = cleanCell(row[cIdx]);
        const v = cleanCell(row[tIdx]);
        if (gv === '' || v === '') return;
        if (!groupSet.has(gv)) {
          groupSet.add(gv);
          groupOrder.push(gv);
          byGroup.set(gv, { n: 0, count: Object.fromEntries(optionOrder.map(o => [o, 0])) });
        }
        if (!optionSet.has(v)) {
          optionSet.add(v);
          optionOrder.push(v);
          byGroup.forEach(g => { if (g.count[v] === undefined) g.count[v] = 0; });
          totalResults.push({ option: v, count: 0, pct: 0 });
        }
        const g = byGroup.get(gv);
        g.count[v] = (g.count[v] || 0) + 1;
        g.n += 1;
      });

      groupResults = groupOrder.map(gv => {
        const g = byGroup.get(gv);
        return {
          value: gv,
          label: `${critEntry.label}: ${gv}`,
          n: g.n,
          results: visibleOptionOrder.map(o => ({
            option: o,
            count: g.count[o] || 0,
            pct: g.n > 0 ? ((g.count[o] || 0) / g.n) * 100 : 0
          }))
        };
      });
    }
  }

  return {
    targetLabel,
    sourceLabel,
    displayLabel,
    codebookEntry: entry,
    totalN,
    optionOrder: visibleOptionOrder,
    totalResults: visibleTotalResults,
    visualType: 'choice',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults,
    isMulti: false
  };
}

/**
 * 단일선택 문항을 기준(교차)별로 응답 분포를 집계합니다.
 */
function aggregateSingle(targetLabel, criterionLabel, rows) {
  return aggregateSingleFromColumn(targetLabel, criterionLabel, rows);
}

/**
 * 다중선택 문항을 기준별로 선택 비율을 집계합니다.
 */
function aggregateMulti(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;

  const tIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;
  const expandedItems = getExpandedMultiOptionItems(targetLabel, entry);
  if (tIdx === undefined && expandedItems.length === 0) return null;

  const optionOrder = [...entry.options];
  const optionSet = new Set(optionOrder);
  const totalCount = {};
  optionOrder.forEach(o => totalCount[o] = 0);
  let totalN = 0;

  rows.forEach(row => {
    const selectedOptions = getMultiSelectionsFromRow(row, tIdx, expandedItems);
    if (selectedOptions.length === 0) return;

    selectedOptions.forEach(option => {
      if (!optionSet.has(option)) {
        optionSet.add(option);
        optionOrder.push(option);
        totalCount[option] = 0;
      }
      totalCount[option] = (totalCount[option] || 0) + 1;
    });
    totalN += 1;
  });

  const totalResults = optionOrder.map(option => ({
    option,
    count: totalCount[option] || 0,
    pct: totalN > 0 ? ((totalCount[option] || 0) / totalN) * 100 : 0
  }));

  const visibleOptionOrder = optionOrder.filter(option => (totalCount[option] || 0) > 0);
  const visibleOptionSet = new Set(visibleOptionOrder);
  const visibleTotalResults = totalResults.filter(result => visibleOptionSet.has(result.option));

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      const createGroupState = () => ({
        n: 0,
        count: Object.fromEntries(optionOrder.map(option => [option, 0]))
      });

      groupOrder.forEach(groupValue => {
        byGroup.set(groupValue, createGroupState());
      });

      rows.forEach(row => {
        const groupValue = cleanCell((row || [])[cIdx]);
        const selectedOptions = getMultiSelectionsFromRow(row, tIdx, expandedItems);
        if (groupValue === '' || selectedOptions.length === 0) return;

        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, createGroupState());
        }

        const group = byGroup.get(groupValue);
        group.n += 1;

        selectedOptions.forEach(option => {
          if (group.count[option] === undefined) group.count[option] = 0;
          group.count[option] += 1;
        });
      });

      groupResults = groupOrder.map(groupValue => {
        const group = byGroup.get(groupValue);
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          n: group.n,
          results: visibleOptionOrder.map(option => ({
            option,
            count: group.count[option] || 0,
            pct: group.n > 0 ? ((group.count[option] || 0) / group.n) * 100 : 0
          }))
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    totalN,
    optionOrder: visibleOptionOrder,
    totalResults: visibleTotalResults,
    visualType: 'choice',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults,
    isMulti: true
  };
}

/**
 * 화면 표시용 숫자 문자열을 유한 실수로 파싱합니다.
 */
function parseFiniteDisplayNumber(value) {
  const raw = cleanCell(value).replace(/,/g, '');
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * 비율 배분 집계에 쓸 라벨/값 행 소스를 고릅니다.
 */
function getRatioAllocationDataSource() {
  const hasValueRows = Array.isArray(filterState.valueRows) && filterState.valueRows.length >= 2;
  return {
    rows: hasValueRows ? filterState.valueRows : filterState.rows,
    headerMap: hasValueRows ? filterState.valueHeaderMap : filterState.headerMap
  };
}

/**
 * 비율 배분 하위 항목(열) 목록을 헤더 맵과 함께 확장합니다.
 */
function getExpandedRatioAllocationItems(targetLabel, entry, headerMap) {
  if (!entry || !isRatioAllocationType(entry.type)) return [];
  const sourceHeaderMap = headerMap || new Map();
  const items = [];
  const usedLabels = new Set();

  (entry.options || []).forEach(option => {
    const expandedLabel = `${targetLabel}__${option}`;
    if (!sourceHeaderMap.has(expandedLabel)) return;
    items.push({ option, label: expandedLabel, colIdx: sourceHeaderMap.get(expandedLabel) });
    usedLabels.add(expandedLabel);
  });

  resultState.codebookByLabel.forEach((candidate, label) => {
    if (!candidate || cleanCell(candidate.role).toLowerCase() !== 'expanded') return;
    if (!isRatioAllocationType(candidate.type)) return;
    if (!label.startsWith(`${targetLabel}__`)) return;
    if (!sourceHeaderMap.has(label) || usedLabels.has(label)) return;

    const option = cleanCell(label.slice(targetLabel.length + 2));
    if (!option) return;
    items.push({ option, label, colIdx: sourceHeaderMap.get(label) });
    usedLabels.add(label);
  });

  return items;
}

/**
 * 원시 행에서 비율 배분 숫자 배열을 추출합니다.
 */
function getRatioAllocationValuesFromRaw(row, rawIdx, optionOrder) {
  if (rawIdx === undefined || !Array.isArray(optionOrder) || optionOrder.length === 0) return null;
  const raw = cleanCell((row || [])[rawIdx]);
  if (!raw) return null;
  const parts = raw.split('|').map(parseFiniteDisplayNumber);
  if (parts.length < optionOrder.length) return null;
  const values = optionOrder.map((option, index) => ({
    option,
    value: parts[index]
  }));
  return values.every(item => Number.isFinite(item.value)) ? values : null;
}

/**
 * 확장 항목 순서에 맞게 행에서 비율 값 배열을 만듭니다.
 */
function getRatioAllocationValues(row, rawIdx, expandedItems, optionOrder) {
  const safeOptionOrder = Array.isArray(optionOrder) ? optionOrder : [];
  const byOption = new Map();
  let expandedComplete = expandedItems.length > 0;

  expandedItems.forEach(item => {
    const value = item.colIdx === undefined ? null : parseFiniteDisplayNumber((row || [])[item.colIdx]);
    if (!Number.isFinite(value)) expandedComplete = false;
    byOption.set(item.option, value);
  });

  if (expandedComplete && safeOptionOrder.every(option => byOption.has(option))) {
    return safeOptionOrder.map(option => ({ option, value: byOption.get(option) }));
  }

  return getRatioAllocationValuesFromRaw(row, rawIdx, safeOptionOrder);
}

/**
 * 비율 배분 값 배열이 유효한지 검사합니다.
 */
function isValidRatioAllocationValues(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  if (!values.every(item => Number.isFinite(item.value) && item.value >= 0)) return false;
  const sum = values.reduce((total, item) => total + item.value, 0);
  return sum >= 99.99 && sum <= 100.01;
}

/**
 * 비율 배분 레코드를 옵션 순서대로 합산·요약합니다.
 */
function summarizeRatioAllocationRecords(records, optionOrder) {
  const n = Array.isArray(records) ? records.length : 0;
  const sums = Object.fromEntries((optionOrder || []).map(option => [option, 0]));
  (records || []).forEach(values => {
    values.forEach(item => {
      if (!Object.prototype.hasOwnProperty.call(sums, item.option)) sums[item.option] = 0;
      sums[item.option] += item.value;
    });
  });
  return (optionOrder || []).map(option => {
    const mean = n > 0 ? (sums[option] || 0) / n : 0;
    return {
      option,
      pct: mean,
      count: n
    };
  });
}

/**
 * 비율 배분 문항을 기준별로 합산·요약합니다.
 */
function aggregateRatioAllocation(targetLabel, criterionLabel, rowIndexes = []) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;

  const effectiveIndexes = Array.isArray(rowIndexes) && rowIndexes.length > 0
    ? rowIndexes
    : getFilteredRowIndexes();
  if (effectiveIndexes.length === 0) return null;

  const source = getRatioAllocationDataSource();
  const sourceRows = source.rows || [];
  const sourceHeaderMap = source.headerMap || new Map();
  const rawIdx = sourceHeaderMap.get(targetLabel);
  const expandedItems = getExpandedRatioAllocationItems(targetLabel, entry, sourceHeaderMap);
  const optionOrder = (entry.options && entry.options.length > 0)
    ? [...entry.options]
    : expandedItems.map(item => item.option);
  if (optionOrder.length === 0) return null;

  const activeValueRows = getRowsByIndexes(sourceRows, effectiveIndexes);
  const activeLabelRows = getRowsByIndexes(filterState.rows || [], effectiveIndexes);
  const parsedRows = [];
  let invalidN = 0;

  activeValueRows.forEach((valueRow, index) => {
    const values = getRatioAllocationValues(valueRow, rawIdx, expandedItems, optionOrder);
    if (!isValidRatioAllocationValues(values)) {
      invalidN += 1;
      return;
    }
    parsedRows.push({
      values,
      labelRow: activeLabelRows[index] || []
    });
  });

  if (parsedRows.length === 0) return null;

  const totalResults = summarizeRatioAllocationRecords(parsedRows.map(row => row.values), optionOrder);

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      groupOrder.forEach(groupValue => byGroup.set(groupValue, []));

      parsedRows.forEach(parsed => {
        const groupValue = cleanCell((parsed.labelRow || [])[cIdx]);
        if (!groupValue) return;
        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, []);
        }
        byGroup.get(groupValue).push(parsed.values);
      });

      groupResults = groupOrder.map(groupValue => {
        const records = byGroup.get(groupValue) || [];
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          n: records.length,
          results: summarizeRatioAllocationRecords(records, optionOrder)
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    totalN: parsedRows.length,
    invalidN,
    optionOrder,
    totalResults,
    visualType: 'ratio-allocation',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

/**
 * 문항 유형에 따라 단일/다중/척도 등 적절한 집계 함수로 위임합니다.
 */
function aggregateResultQuestion(targetLabel, criterionLabel, rows, valueRows = [], rowIndexes = []) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  if (isSingleChoiceType(entry.type)) return aggregateSingle(targetLabel, criterionLabel, rows);
  if (isMultiChoiceType(entry.type)) return aggregateMulti(targetLabel, criterionLabel, rows);
  if (isRankChoiceType(entry.type)) return aggregateRank(targetLabel, criterionLabel, rows);
  if (isScaleChoiceType(entry.type)) return aggregateScale(targetLabel, criterionLabel, rows);
  if (isNumericOpenEntry(entry)) return aggregateNumericOpen(targetLabel, criterionLabel, rowIndexes);
  if (isTimeOpenRawEntry(entry)) {
    const minutesLabel = findTimeMinutesLabel(targetLabel);
    if (!minutesLabel) return null;
    const result = aggregateNumericOpen(minutesLabel, criterionLabel, rowIndexes);
    if (!result) return null;
    return { ...result, targetLabel };
  }
  if (isRatioAllocationType(entry.type)) return aggregateRatioAllocation(targetLabel, criterionLabel, rowIndexes);
  if (isTextOpenType(entry.type)) return aggregateTextOpen(targetLabel, rowIndexes);
  return null;
}

/**
 * 코드북 엔트리에서 척도 점수 범위 배열을 반환합니다.
 */
function getScaleScoreRange(entry) {
  const maxScore = Number(entry && entry.valueCount);
  const safeMax = Number.isFinite(maxScore) && maxScore >= 2 ? Math.round(maxScore) : 5;
  return Array.from({ length: safeMax }, (_, i) => i + 1);
}

/**
 * 점수값에 해당하는 라벨을 코드북에서 찾습니다.
 */
function getScaleScoreLabel(entry, score) {
  const mapped = cleanCell(entry && entry.valueCodeMap ? entry.valueCodeMap.get(String(score)) : '');
  return mapped || `${score}점`;
}

/**
 * 코드북 엔트리가 파생(연산) 척도인지 판별합니다.
 */
function isDerivedScaleEntry(entry) {
  return !!(entry && isScaleChoiceType(entry.type) && cleanCell(entry.role) === 'derived');
}

/**
 * 평균 점수를 0–100% 트랙 상의 좌표로 변환합니다.
 */
function getScaleMeanLeftPct(mean, maxScore) {
  if (!Number.isFinite(mean) || mean <= 0) return null;
  if (!Number.isFinite(maxScore) || maxScore <= 1) return 50;
  return Math.max(0, Math.min(100, ((mean - 1) / (maxScore - 1)) * 100));
}

/**
 * 소수 자릿수 고정 표시(끝자리 0도 유지).
 */
function formatFixedDecimal(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

/**
 * 척도 평균 마커·라벨 표시용 — 소수 둘째 자리까지 고정(둘째 자리가 0이어도 표시).
 */
function formatScaleMeanDisplay(mean, options = {}) {
  const { allowZero = false } = options;
  const num = Number(mean);
  if (!Number.isFinite(num) || (!allowZero && num <= 0)) return '';
  return formatFixedDecimal(num, 2);
}

/**
 * 척도 점수·평균 등 표시용 문자열로 포맷합니다.
 */
function formatScaleCompareMean(mean) {
  return formatScaleMeanDisplay(mean);
}

/**
 * 척도 응답의 긍·부정 요약 통계를 냅니다.
 */
function getScalePolaritySummary(scoreResults) {
  const mid = (Array.isArray(scoreResults) ? scoreResults.length : 0) > 0
    ? ((scoreResults.length + 1) / 2)
    : 0;
  return (scoreResults || []).reduce((acc, result) => {
    const pctValue = result.pct || 0;
    if (result.score < mid) {
      acc.negativePct += pctValue;
      acc.negativeCount += result.count || 0;
    } else if (result.score > mid) {
      acc.positivePct += pctValue;
      acc.positiveCount += result.count || 0;
    } else {
      acc.neutralPct += pctValue;
      acc.neutralCount += result.count || 0;
    }
    return acc;
  }, {
    negativePct: 0,
    negativeCount: 0,
    positivePct: 0,
    positiveCount: 0,
    neutralPct: 0,
    neutralCount: 0
  });
}

/**
 * 척도 원시 값 배열의 평균·분산 등 기초 통계를 냅니다.
 */
function getScaleValueStats(values) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  const n = nums.length;
  if (n === 0) return { n: 0, mean: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  const initial = { sum: 0, min: nums[0], max: nums[0] };
  const summary = nums.reduce((acc, value) => ({
    sum: acc.sum + value,
    min: Math.min(acc.min, value),
    max: Math.max(acc.max, value)
  }), initial);
  const sorted = [...nums].sort((a, b) => a - b);
  const quantile = p => {
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[Math.min(base + 1, sorted.length - 1)];
    return sorted[base] + ((next - sorted[base]) * rest);
  };
  return {
    n,
    mean: summary.sum / n,
    min: summary.min,
    q1: quantile(0.25),
    median: quantile(0.5),
    q3: quantile(0.75),
    max: summary.max
  };
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildDerivedScaleResult(values, scoreRange) {
  const stats = getScaleValueStats(values);
  const safeRange = Array.isArray(scoreRange) ? scoreRange : [];
  const bucketCounts = Object.fromEntries(safeRange.map(score => [score, 0]));
  (Array.isArray(values) ? values : []).forEach(value => {
    const num = Number(value);
    if (!Number.isFinite(num) || safeRange.length === 0) return;
    let nearest = safeRange[0];
    let minDistance = Math.abs(num - Number(nearest));
    safeRange.forEach(score => {
      const distance = Math.abs(num - Number(score));
      if (distance < minDistance) {
        nearest = score;
        minDistance = distance;
      }
    });
    bucketCounts[nearest] = Number(bucketCounts[nearest] || 0) + 1;
  });
  const totalN = Number(stats.n || 0);
  const scoreResults = safeRange.map(score => {
    const count = Number(bucketCounts[score] || 0);
    return {
      score,
      label: String(score),
      count,
      pct: totalN > 0 ? (count / totalN) * 100 : 0
    };
  });
  return {
    values,
    n: stats.n,
    mean: stats.mean,
    min: stats.min,
    q1: stats.q1,
    median: stats.median,
    q3: stats.q3,
    max: stats.max,
    scoreRange,
    scoreResults
  };
}

/**
 * 히스토그램 간격·시작값 등을 유효 범위로 조정합니다.
 */
function clampNumericHistogramStep(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return 5;
  return Math.max(1, Math.min(1000000, num));
}

/**
 * 히스토그램 간격·시작값 등을 유효 범위로 조정합니다.
 */
function normalizeNumericHistogramStart(value) {
  const num = Math.round(Number(value));
  return Number.isFinite(num) ? num : 0;
}

/**
 * 히스토그램 구간 폭 기본값을 데이터에서 추천합니다.
 */
function getDefaultNumericHistogramStep(values) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (nums.length <= 1) return 1;
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const span = Math.max(1, max - min);
  const roughStep = Math.ceil(span / 10);
  return clampNumericHistogramStep(roughStep);
}

/**
 * 히스토그램 시작값 기본값을 데이터에서 추천합니다.
 */
function getDefaultNumericHistogramStart(values, step = null) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (nums.length === 0) return 0;
  const min = Math.min(...nums);
  const safeStep = clampNumericHistogramStep(step || getDefaultNumericHistogramStep(nums));
  return Math.floor(min / safeStep) * safeStep;
}

/**
 * 숫자/단위 포함 표시 문자열로 포맷합니다.
 */
function formatNumericValue(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  const rounded = Number(value.toFixed(digits));
  return rounded.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

/**
 * formatMinutesAsTime: 대시보드 시각화/집계 로직의 일부입니다(이름·호출 맥락 참고).
 */
function formatMinutesAsTime(value) {
  if (!Number.isFinite(value)) return '-';
  const m = Math.round(Number(value));
  const dayMinutes = 24 * 60;
  const normalized = ((m % dayMinutes) + dayMinutes) % dayMinutes;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatMinutesAsHourMin(value) {
  if (!Number.isFinite(value)) return '-';
  const total = Math.round(Number(value));
  const h = Math.floor(Math.abs(total) / 60);
  const m = Math.abs(total) % 60;
  const sign = total < 0 ? '-' : '';
  if (h === 0) return `${sign}${m}분`;
  if (m === 0) return `${sign}${h}시간`;
  return `${sign}${h}시간 ${m}분`;
}

function formatMinutesAsClockTime(value) {
  if (!Number.isFinite(value)) return '-';
  const total = Math.round(Number(value));
  const dayMinutes = 24 * 60;
  const normalized = ((total % dayMinutes) + dayMinutes) % dayMinutes;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  if (m === 0) return `${h}시`;
  return `${h}시 ${m}분`;
}

function formatMinutesAsHHMM(value) {
  if (!Number.isFinite(value)) return '-';
  const total = Math.round(Number(value));
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getTimeMinutesFormat(entry) {
  if (!isTimeMinutesEntry(entry)) return 'duration';
  const baseLabel = cleanCell(entry.label).replace(/_분환산$/, '');
  if (resultState.codebookByLabel.has(baseLabel + '__시')) return 'clock';
  return 'duration';
}

/**
 * 숫자/시간 단위에 맞는 값 포맷 함수를 반환합니다.
 */
function getNumericOpenValueFormatter(entry) {
  if (isTimeMinutesEntry(entry)) {
    const fmt = getTimeMinutesFormat(entry);
    return fmt === 'clock' ? formatMinutesAsClockTime : formatMinutesAsHourMin;
  }
  return (value, digits = 2) => formatNumericValue(value, digits);
}

/**
 * 숫자/단위 포함 표시 문자열로 포맷합니다.
 */
function formatNumericMeanDisplay(value, unit = '') {
  const num = Number(value);
  const base = Number.isFinite(num)
    ? num.toLocaleString('ko-KR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      })
    : '-';
  return unit ? `${base}${unit}` : base;
}

/**
 * 숫자/단위 포함 표시 문자열로 포맷합니다.
 */
function formatNumericValueWithUnit(value, unit = '', digits = 2) {
  const base = formatNumericValue(value, digits);
  return base === '-' ? base : (unit ? `${base}${unit}` : base);
}

/**
 * 히스토그램 축 범위(최소·최대)를 추정합니다.
 */
function getNumericHistogramDomain(values) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (nums.length === 0) return { min: 0, max: 0 };
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

/**
 * 숫자 값을 축 범위 내 백분율 위치로 변환합니다.
 */
function getNumericValueLeftPct(value, axisMin, axisMax) {
  if (!Number.isFinite(value)) return null;
  if (!Number.isFinite(axisMin) || !Number.isFinite(axisMax)) return null;
  if (axisMin === axisMax) return 50;
  return Math.max(0, Math.min(100, ((value - axisMin) / (axisMax - axisMin)) * 100));
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericHistogram(values, config = {}, domain = null) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  const stats = getScaleValueStats(nums);
  const domainInfo = domain && Number.isFinite(domain.min) && Number.isFinite(domain.max)
    ? domain
    : getNumericHistogramDomain(nums);
  const domainMin = Number(domainInfo.min);
  const domainMax = Number(domainInfo.max);
  const safeStep = clampNumericHistogramStep(config.interval || getDefaultNumericHistogramStep(nums));
  const safeStart = normalizeNumericHistogramStart(
    config.start != null ? config.start : getDefaultNumericHistogramStart(nums, safeStep)
  );

  if (nums.length === 0) {
    return {
      n: 0,
      mean: 0,
      min: 0,
      q1: 0,
      median: 0,
      q3: 0,
      max: 0,
      interval: safeStep,
      start: safeStart,
      domainMin,
      domainMax,
      bins: [],
      maxBinCount: 0,
      meanLeftPct: null,
      q1LeftPct: null,
      medianLeftPct: null,
      q3LeftPct: null
    };
  }

  if (domainMin === domainMax) {
    return {
      n: stats.n,
      mean: stats.mean,
      min: stats.min,
      q1: stats.q1,
      median: stats.median,
      q3: stats.q3,
      max: stats.max,
      interval: safeStep,
      start: safeStart,
      domainMin,
      domainMax,
      bins: [{
        start: safeStart,
        end: safeStart + safeStep,
        count: nums.length,
        pct: 100,
        leftPct: 0,
        widthPct: 100
      }],
      maxBinCount: nums.length,
      meanLeftPct: 50,
      q1LeftPct: 50,
      medianLeftPct: 50,
      q3LeftPct: 50
    };
  }

  let firstStart = safeStart;
  while (domainMin < firstStart) firstStart -= safeStep;
  while (domainMin >= firstStart + safeStep) firstStart += safeStep;

  let lastEnd = safeStart + safeStep;
  while (domainMax > lastEnd) lastEnd += safeStep;

  const binCount = Math.max(1, Math.round((lastEnd - firstStart) / safeStep));
  const bins = Array.from({ length: binCount }, (_, idx) => ({
    start: firstStart + (safeStep * idx),
    end: firstStart + (safeStep * (idx + 1)),
    count: 0
  }));

  nums.forEach(value => {
    const rawIndex = Math.floor((value - firstStart) / safeStep);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    bins[index].count += 1;
  });

  const maxBinCount = bins.reduce((maxCount, bin) => Math.max(maxCount, bin.count || 0), 0);
  const decoratedBins = bins.map((bin, idx) => ({
    ...bin,
    pct: stats.n > 0 ? (bin.count / stats.n) * 100 : 0,
    leftPct: (idx / binCount) * 100,
    widthPct: 100 / binCount
  }));
  const axisMin = firstStart;
  const axisMax = lastEnd;
  const meanLeftPct = getNumericValueLeftPct(stats.mean, axisMin, axisMax);
  const q1LeftPct = getNumericValueLeftPct(stats.q1, axisMin, axisMax);
  const medianLeftPct = getNumericValueLeftPct(stats.median, axisMin, axisMax);
  const q3LeftPct = getNumericValueLeftPct(stats.q3, axisMin, axisMax);
  return {
    n: stats.n,
    mean: stats.mean,
    min: stats.min,
    q1: stats.q1,
    median: stats.median,
    q3: stats.q3,
    max: stats.max,
    interval: safeStep,
    start: safeStart,
    domainMin: axisMin,
    domainMax: axisMax,
    bins: decoratedBins,
    maxBinCount,
    meanLeftPct,
    q1LeftPct,
    medianLeftPct,
    q3LeftPct
  };
}

/**
 * 열에서 유한한 숫자만 모아 배열로 반환합니다.
 */
function collectFiniteNumericValues(rows, columnIndex) {
  if (!Array.isArray(rows) || columnIndex === undefined) return [];
  const values = [];
  rows.forEach(row => {
    const raw = cleanCell((row || [])[columnIndex]);
    if (!raw) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    values.push(value);
  });
  return values;
}

/**
 * 숫자/시간 입력 문항을 기준별로 히스토그램·통계를 집계합니다.
 */
function aggregateNumericOpen(targetLabel, criterionLabel, rowIndexes = []) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const effectiveIndexes = Array.isArray(rowIndexes) && rowIndexes.length > 0
    ? rowIndexes
    : getFilteredRowIndexes();
  if (effectiveIndexes.length === 0) return null;

  const numericRows = Array.isArray(filterState.valueRows) && filterState.valueRows.length >= 2
    ? filterState.valueRows
    : filterState.rows;
  const numericHeaderMap = Array.isArray(filterState.valueRows) && filterState.valueRows.length >= 2
    ? filterState.valueHeaderMap
    : filterState.headerMap;
  const tIdx = numericHeaderMap ? numericHeaderMap.get(targetLabel) : undefined;
  if (tIdx === undefined) return null;

  const activeRows = getRowsByIndexes(numericRows || [], effectiveIndexes);
  const activeLabelRows = getRowsByIndexes(filterState.rows || [], effectiveIndexes);
  const values = collectFiniteNumericValues(activeRows, tIdx);
  if (values.length === 0) return null;

  const defaultInterval = getDefaultNumericHistogramStep(values);
  const defaultStart = getDefaultNumericHistogramStart(values, defaultInterval);
  const savedConfig = resultState.numericHistogramConfigs.get(targetLabel) || {};
  const histogramConfig = {
    interval: clampNumericHistogramStep(savedConfig.interval || defaultInterval),
    start: normalizeNumericHistogramStart(savedConfig.start != null ? savedConfig.start : defaultStart)
  };
  if (!resultState.numericHistogramConfigs.has(targetLabel)) {
    resultState.numericHistogramConfigs.set(targetLabel, histogramConfig);
  }
  const domain = getNumericHistogramDomain(values);
  const overall = buildNumericHistogram(values, histogramConfig, domain);

  let groupResults = null;
  let groupMaxBinCount = overall.maxBinCount;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      groupOrder.forEach(groupValue => byGroup.set(groupValue, []));

      activeRows.forEach((valueRow, index) => {
        const labelRow = activeLabelRows[index] || [];
        const groupValue = cleanCell(labelRow[cIdx]);
        const raw = cleanCell((valueRow || [])[tIdx]);
        if (!groupValue || !raw) return;
        const value = Number(raw);
        if (!Number.isFinite(value)) return;
        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, []);
        }
        byGroup.get(groupValue).push(value);
      });

      groupResults = groupOrder.map(groupValue => {
        const groupValues = byGroup.get(groupValue) || [];
        const histogram = buildNumericHistogram(groupValues, histogramConfig, domain);
        groupMaxBinCount = Math.max(groupMaxBinCount, histogram.maxBinCount || 0);
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          ...histogram,
          values: groupValues
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    n: overall.n,
    totalN: overall.n,
    mean: overall.mean,
    min: overall.min,
    q1: overall.q1,
    median: overall.median,
    q3: overall.q3,
    max: overall.max,
    values,
    interval: histogramConfig.interval,
    start: histogramConfig.start,
    defaultInterval,
    defaultStart,
    domainMin: overall.domainMin,
    domainMax: overall.domainMax,
    bins: overall.bins,
    maxBinCount: groupResults ? groupMaxBinCount : overall.maxBinCount,
    meanLeftPct: overall.meanLeftPct,
    q1LeftPct: overall.q1LeftPct,
    medianLeftPct: overall.medianLeftPct,
    q3LeftPct: overall.q3LeftPct,
    visualType: 'numeric-open',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

/**
 * 척도 문항을 기준별로 점수 분포·평균 등을 집계합니다.
 */
function aggregateScale(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const tIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;
  if (tIdx === undefined) return null;

  const scoreRange = getScaleScoreRange(entry);
  const isDerived = isDerivedScaleEntry(entry);
  if (isDerived) {
    const maxScore = scoreRange.length;
    const values = [];

    rows.forEach(row => {
      const raw = cleanCell((row || [])[tIdx]);
      if (!raw) return;
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      if (value < 1 || value > maxScore) return;
      values.push(value);
    });

    const overall = buildDerivedScaleResult(values, scoreRange);
    let groupResults = null;
    if (criterionLabel) {
      const critEntry = getCriterionEntry(criterionLabel);
      const cIdx = filterState.headerMap.get(criterionLabel);
      if (critEntry && cIdx !== undefined) {
        const groupOrder = [...critEntry.options];
        const groupSet = new Set(groupOrder);
        const byGroup = new Map();
        groupOrder.forEach(groupValue => byGroup.set(groupValue, []));

        rows.forEach(row => {
          const groupValue = cleanCell((row || [])[cIdx]);
          const raw = cleanCell((row || [])[tIdx]);
          if (!groupValue || !raw) return;
          const value = Number(raw);
          if (!Number.isFinite(value)) return;
          if (value < 1 || value > maxScore) return;

          if (!groupSet.has(groupValue)) {
            groupSet.add(groupValue);
            groupOrder.push(groupValue);
            byGroup.set(groupValue, []);
          }
          byGroup.get(groupValue).push(value);
        });

        groupResults = groupOrder.map(groupValue => {
          const groupValues = byGroup.get(groupValue) || [];
          const result = buildDerivedScaleResult(groupValues, scoreRange);
          return {
            value: groupValue,
            label: `${critEntry.label}: ${groupValue}`,
            n: result.n,
            mean: result.mean,
            min: result.min,
            q1: result.q1,
            median: result.median,
            q3: result.q3,
            max: result.max,
            values: result.values
          };
        });
      }
    }

    return {
      targetLabel,
      codebookEntry: entry,
      totalN: overall.n,
      mean: overall.mean,
      min: overall.min,
      q1: overall.q1,
      median: overall.median,
      q3: overall.q3,
      max: overall.max,
      values: overall.values,
      scoreRange,
      scoreResults: [],
      visualType: 'scale',
      isDerivedScale: true,
      criterionLabel: groupResults ? criterionLabel : null,
      groupResults
    };
  }

  const scoreCounts = Object.fromEntries(scoreRange.map(score => [score, 0]));
  let totalN = 0;
  let totalSum = 0;

  rows.forEach(row => {
    const raw = cleanCell((row || [])[tIdx]);
    if (!raw) return;
    const score = Number(raw);
    if (!Number.isFinite(score)) return;
    if (!Object.prototype.hasOwnProperty.call(scoreCounts, score)) return;
    scoreCounts[score] += 1;
    totalN += 1;
    totalSum += score;
  });

  const scoreResults = scoreRange.map(score => ({
    score,
    label: getScaleScoreLabel(entry, score),
    count: scoreCounts[score] || 0,
    pct: totalN > 0 ? ((scoreCounts[score] || 0) / totalN) * 100 : 0
  }));
  const mean = totalN > 0 ? totalSum / totalN : 0;

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      const createBucket = () => ({
        n: 0,
        sum: 0,
        counts: Object.fromEntries(scoreRange.map(score => [score, 0]))
      });
      groupOrder.forEach(groupValue => byGroup.set(groupValue, createBucket()));

      rows.forEach(row => {
        const groupValue = cleanCell((row || [])[cIdx]);
        const raw = cleanCell((row || [])[tIdx]);
        if (!groupValue || !raw) return;
        const score = Number(raw);
        if (!Number.isFinite(score)) return;
        if (!Object.prototype.hasOwnProperty.call(scoreCounts, score)) return;

        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, createBucket());
        }
        const bucket = byGroup.get(groupValue);
        bucket.n += 1;
        bucket.sum += score;
        bucket.counts[score] = (bucket.counts[score] || 0) + 1;
      });

      groupResults = groupOrder.map(groupValue => {
        const bucket = byGroup.get(groupValue);
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          n: bucket.n,
          mean: bucket.n > 0 ? bucket.sum / bucket.n : 0,
          scoreResults: scoreRange.map(score => ({
            score,
            label: getScaleScoreLabel(entry, score),
            count: bucket.counts[score] || 0,
            pct: bucket.n > 0 ? ((bucket.counts[score] || 0) / bucket.n) * 100 : 0
          }))
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    totalN,
    mean,
    scoreRange,
    scoreResults,
    visualType: 'scale',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

/**
 * 순위 차트 보기 모드를 반환합니다.
 */
function getRankChartViewMode(targetLabel) {
  return resultState.rankViewModes.get(targetLabel) || 'horizontal';
}


/**
 * 결과 블록 헤더·레이아웃 래퍼 HTML을 생성합니다.
 */
function buildResultSidePanelHtml(legendHtml, targetLabel) {
  if (legendHtml && legendHtml.includes('</aside>')) {
    return legendHtml;
  }
  return '<aside class="legend-panel is-placeholder" aria-hidden="true"></aside>';
}

/**
 * 단일선택 차트 정렬 모드를 반환합니다.
 */
function getChoiceChartSortMode(targetLabel) {
  return resultState.choiceSortModes.get(targetLabel) || 'default';
}

/**
 * 행 배열을 지표 함수와 정렬 모드에 따라 정렬합니다.
 */
function sortRowsByMetric(rows, metricFn, sortMode) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (sortMode !== 'desc') return safeRows;
  return safeRows
    .map((row, index) => ({ row, index, metric: Number(metricFn(row)) || 0 }))
    .sort((a, b) => (b.metric - a.metric) || (a.index - b.index))
    .map(item => item.row);
}

/**
 * 단일선택 차트용 행 데이터(비율 등)를 만듭니다.
 */
function getChoiceChartRows(data) {
  if (!data) return [];
  return sortRowsByMetric(data.totalResults, row => row.pct, getChoiceChartSortMode(data.targetLabel));
}

/**
 * 차트·표·컨트롤 등 화면용 HTML 조각을 생성합니다.
 */
function buildBasicChartHtml(data) {
  const rows = getChoiceChartRows(data);
  const rowHtml = rows.map(r => {
    const pct = Math.max(0, Math.min(100, r.pct));
    const widthStr = `${pct}%`;
    const valueClass = pct >= HBAR_INSIDE_VALUE_THRESHOLD ? 'single-hbar-outside-value is-inside' : 'single-hbar-outside-value';
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'basic-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    const valueHtml = `<span class="${valueClass}" style="left:${widthStr}; --hbar-value-pct:${widthStr};" data-tip="${tip}">${formatPercent(r.pct)}</span>`;
    return `
      <div class="single-hbar-row">
        <div class="single-hbar-label" title="${escapeHtml(r.option)}" data-tip="${tip}">${escapeHtml(r.option)}</div>
        <div class="single-hbar-track">
          <div class="single-hbar-fill"
               style="width:${widthStr}; background:${SINGLE_BAR_COLOR};"
               data-tip="${tip}"></div>
          ${valueHtml}
        </div>
      </div>
    `;
  }).join('');
  const overlayHeight = rows.length * 40;
  const guideHtml = [0, 20, 40, 60, 80, 100].map(t => `<span class="horizontal-chart-guide" style="left:${t}%;"></span>`).join('');
  const axisHtml = [20, 40, 60, 80, 100].map(t =>
    `<span class="horizontal-chart-axis-label" style="left:${t}%;">${t}%</span>`
  ).join('');
  return `
    <div class="single-hbar-chart">
      <div class="horizontal-chart-guides" style="height:${overlayHeight}px;" aria-hidden="true">${guideHtml}</div>
      ${rowHtml}
      <div class="horizontal-chart-axis-row" aria-hidden="true">
        <div class="horizontal-chart-axis-spacer"></div>
        <div class="horizontal-chart-axis">${axisHtml}</div>
      </div>
    </div>
  `;
}

/**
 * 그룹 간 비교(가로/세로 막대 등) HTML을 생성합니다.
 */
function buildGroupCompareItems(data) {
  if (!data || !data.groupResults) return [];
  if (data.visualType === 'rank') {
    const rows = getRankFirstChoiceRows(data);
    return rows.map(row => ({
      key: row.option,
      label: row.option,
      overallPct: row.pct || 0,
      groups: (data.groupResults || []).map(group => {
        const first = getRankFirstChoiceForGroup(group, row.option);
        return { key: group.value, label: group.label, pct: first.pct || 0, count: first.count || 0, n: group.n || 0 };
      })
    }));
  }
  if (data.visualType === 'scale') {
    const scoreRows = Array.isArray(data.scoreResults) ? data.scoreResults : [];
    return scoreRows.map(row => ({
      key: String(row.score),
      label: `${row.score}점`,
      overallPct: row.pct || 0,
      groups: (data.groupResults || []).map(group => {
        const found = (group.scoreResults || []).find(item => item.score === row.score) || { pct: 0, count: 0 };
        return { key: group.value, label: group.label, pct: found.pct || 0, count: found.count || 0, n: group.n || 0 };
      })
    }));
  }
  if (data.visualType === 'numeric-open') {
    const bins = Array.isArray(data.bins) ? data.bins : [];
    return bins.map((bin, index) => {
      const label = `${formatNumericValue(bin.start)}~${formatNumericValue(bin.end)}`;
      const totalCount = Number(bin.count || 0);
      const overallPct = data.totalN > 0 ? (totalCount / data.totalN) * 100 : 0;
      return {
        key: `${bin.start}-${bin.end}-${index}`,
        label,
        overallPct,
        groups: (data.groupResults || []).map(group => {
          const gBin = (group.bins || [])[index] || { count: 0 };
          const count = Number(gBin.count || 0);
          const pct = group.n > 0 ? (count / group.n) * 100 : 0;
          return { key: group.value, label: group.label, pct, count, n: group.n || 0 };
        })
      };
    });
  }
  const rows = Array.isArray(data.totalResults) ? data.totalResults : [];
  return rows.map(row => ({
    key: row.option,
    label: row.option,
    overallPct: row.pct || 0,
    groups: (data.groupResults || []).map(group => {
      const found = (group.results || []).find(item => item.option === row.option) || { pct: 0, count: 0 };
      return { key: group.value, label: group.label, pct: found.pct || 0, count: found.count || 0, n: group.n || 0 };
    })
  }));
}

/**
 * 그룹 간 비교(가로/세로 막대 등) HTML을 생성합니다.
 */
function buildGroupCompareChartHtml(data, hiddenGroups = new Set()) {
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const displayGroupKeys = new Set(displayGroups.map(g => g.value));
  const items = buildGroupCompareItems(data);

  const rowHtml = items.map(item => {
    const overallPct = Math.max(0, Math.min(100, item.overallPct || 0));
    const labelTip = encodeURIComponent(JSON.stringify({ kind: 'option-label', option: item.label }));
    const ticksHtml = (item.groups || [])
      .filter(group => displayGroupKeys.has(group.key))
      .map(group => {
        const color = getGroupColor(data.groupResults, group.key);
        const left = Math.max(0, Math.min(100, group.pct || 0));
        const tip = encodeURIComponent(JSON.stringify({
          kind: 'compare-bar',
          groupLabel: group.label,
          option: item.label,
          pct: group.pct || 0,
          count: group.count || 0
        }));
        const labelSide = left > 50 ? 'left' : 'right';
        return `<div class="group-dot-wrap" style="left:${left}%;" data-tip="${tip}" data-group-key="${escapeHtml(String(group.key))}" data-label-side="${labelSide}"><div class="group-dot" style="background:${color};"></div><span class="group-dot-label">${formatPercent(group.pct || 0)}</span></div>`;
      }).join('');
    return `
      <div class="single-hbar-row">
        <div class="single-hbar-label" title="${escapeHtml(item.label)}" data-tip="${labelTip}">${escapeHtml(item.label)}</div>
        <div class="single-hbar-track">
          <div class="single-hbar-fill" style="width:${overallPct}%;"></div>
          ${ticksHtml}
        </div>
      </div>
    `;
  }).join('');
  const overlayHeight = items.length * 40;
  const guideHtml = [0, 20, 40, 60, 80, 100].map(t => `<span class="horizontal-chart-guide" style="left:${t}%;"></span>`).join('');
  const axisHtml = [20, 40, 60, 80, 100].map(t =>
    `<span class="horizontal-chart-axis-label" style="left:${t}%;">${t}%</span>`
  ).join('');
  return `
    <div class="single-hbar-chart group-compare">
      <div class="horizontal-chart-guides" style="height:${overlayHeight}px;" aria-hidden="true">${guideHtml}</div>
      ${rowHtml}
      <div class="horizontal-chart-axis-row" aria-hidden="true">
        <div class="horizontal-chart-axis-spacer"></div>
        <div class="horizontal-chart-axis">${axisHtml}</div>
      </div>
    </div>
  `;
}

/**
 * 차트·표·컨트롤 등 화면용 HTML 조각을 생성합니다.
 */
function buildDualHbarChartHtml(data, hiddenGroups = new Set()) {
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  if (!displayGroups.length) return '<div class="result-empty">표시할 그룹이 없습니다.</div>';

  const items = buildGroupCompareItems(data);

  const rowHtml = items.map(item => {
    const labelTip = encodeURIComponent(JSON.stringify({ kind: 'option-label', option: item.label }));
    const barsHtml = displayGroups.map(group => {
      const groupItem = (item.groups || []).find(g => g.key === group.value) || { pct: 0, count: 0 };
      const color = getGroupColor(data.groupResults, group.value);
      const pct = Math.max(0, Math.min(100, groupItem.pct || 0));
      const tip = encodeURIComponent(JSON.stringify({
        kind: 'compare-bar',
        groupLabel: group.label,
        option: item.label,
        pct: groupItem.pct || 0,
        count: groupItem.count || 0
      }));
      const valueClass = pct >= HBAR_INSIDE_VALUE_THRESHOLD
        ? 'single-hbar-outside-value is-inside'
        : 'single-hbar-outside-value';
      return `
        <div class="dual-hbar-track">
          <div class="dual-hbar-fill" style="width:${pct}%; background:${color};" data-tip="${tip}"></div>
          <span class="${valueClass}" style="left:${pct}%; --hbar-value-pct:${pct}%;">${formatPercent(groupItem.pct || 0)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="dual-hbar-row">
        <div class="dual-hbar-label" title="${escapeHtml(item.label)}" data-tip="${labelTip}">${escapeHtml(item.label)}</div>
        <div class="dual-hbar-bars">${barsHtml}</div>
      </div>
    `;
  }).join('');

  const G = displayGroups.length;
  const rowH = G * 32 + Math.max(0, G - 1) * 4;
  const overlayHeight = items.length * rowH + Math.max(0, items.length - 1) * 16 + 8;
  const guideHtml = [0, 20, 40, 60, 80, 100].map(t => `<span class="horizontal-chart-guide" style="left:${t}%;"></span>`).join('');
  const axisHtml = [20, 40, 60, 80, 100].map(t =>
    `<span class="horizontal-chart-axis-label" style="left:${t}%;">${t}%</span>`
  ).join('');
  return `
    <div class="dual-hbar-chart">
      <div class="horizontal-chart-guides" style="height:${overlayHeight}px;" aria-hidden="true">${guideHtml}</div>
      ${rowHtml}
      <div class="horizontal-chart-axis-row" aria-hidden="true">
        <div class="horizontal-chart-axis-spacer"></div>
        <div class="horizontal-chart-axis">${axisHtml}</div>
      </div>
    </div>
  `;
}

/**
 * 숨긴 그룹을 제외한 그룹별 결과 배열을 반환합니다.
 */
function getDisplayGroupResults(groupResults, hidden) {
  if (!Array.isArray(groupResults)) return [];
  return groupResults.filter(group => {
    const hasResponse = Array.isArray(group.results)
      ? group.results.some(r => (r.count || 0) > 0)
      : Array.isArray(group.perOption)
        ? group.perOption.some(r => {
            const totalCount = r.totalCount || 0;
            const perRankCount = Array.isArray(r.perRank)
              ? r.perRank.reduce((sum, pr) => sum + (pr.count || 0), 0)
              : 0;
            return totalCount > 0 || perRankCount > 0;
          })
        : ((group.n || 0) > 0);
    if (!hasResponse) return false;
    if (hidden && hidden.has(group.value)) return false;
    return true;
  });
}

/**
 * 그룹 비교 범례용 색상을 반환합니다.
 */
function getGroupColor(groupResults, groupValue) {
  // 사용자 정의 그룹은 _customColor를 직접 사용
  const found = groupResults.find(g => g.value === groupValue);
  if (found && found._customColor) return found._customColor;
  const baseGroups = getDisplayGroupResults(groupResults);
  const idx = baseGroups.findIndex(group => group.value === groupValue);
  return GROUP_PALETTE[(idx < 0 ? 0 : idx) % GROUP_PALETTE.length];
}

/**
 * 그룹 비교 범례용 색상을 반환합니다.
 */
function getCustomGroupColor(criterionLabel, groupId) {
  const defs = resultState.customGroupDefs.get(criterionLabel) || [];
  const idx = defs.findIndex(d => d.id === groupId);
  return CUSTOM_GROUP_PALETTE[(idx < 0 ? 0 : idx) % CUSTOM_GROUP_PALETTE.length];
}

/**
 * 새 사용자 정의 그룹 ID를 발급합니다.
 */
function nextCustomGroupId(criterionLabel, defsOverride = null) {
  const defs = Array.isArray(defsOverride) ? defsOverride : (resultState.customGroupDefs.get(criterionLabel) || []);
  const ids = new Set(defs.map(d => d.id));
  let n = 1;
  while (ids.has('cg' + n)) n++;
  return 'cg' + n;
}

/**
 * 범례 한 줄에 표시할 사용자 정의 그룹 구성원을 반환합니다.
 */
function getCustomGroupLegendMembers(data, groupValue) {
  if (!data || !data.isCustomGroupView || !data.criterionLabel) return [];
  const assignments = resultState.customGroupAssignments.get(data.criterionLabel) || new Map();
  const sourceGroups = Array.isArray(data.originalGroupResults) ? data.originalGroupResults : [];
  return sourceGroups
    .filter(group => assignments.get(group.value) === groupValue)
    .map(group => ({
      label: group.label || group.value,
      color: getGroupColor(sourceGroups, group.value)
    }));
}

/**
 * 범례 영역 HTML을 생성합니다.
 */
function buildGroupedLegendRowsHtml(data, hiddenGroups = new Set()) {
  const displayGroups = getDisplayGroupResults(data.groupResults);
  if (displayGroups.length === 0) return '';

  return displayGroups.map((group) => {
    const color = getGroupColor(data.groupResults, group.value);
    const isHidden = hiddenGroups.has(group.value);
    const members = getCustomGroupLegendMembers(data, group.value);
    const membersHtml = members.length > 0
      ? `
        <div class="legend-group-members${isHidden ? ' is-disabled' : ''}">
          ${members.map(member => `
            <div class="legend-item is-static legend-group-member">
              <span class="legend-swatch" style="background:${member.color}"></span>
              <span>${escapeHtml(member.label)}</span>
            </div>
          `).join('')}
        </div>
      `
      : '';

    return `
      <div class="legend-row">
        <label class="legend-item ${isHidden ? 'disabled' : ''}" data-group="${escapeHtml(group.value)}">
          <input type="checkbox" ${isHidden ? '' : 'checked'}>
          <span class="legend-swatch" style="background:${color}"></span>
          <span>${escapeHtml(group.label)}</span>
        </label>
        ${membersHtml}
      </div>
    `;
  }).join('');
}

/**
 * 사용자 정의 그룹 설정이 묶인 대상 문항 라벨을 반환합니다.
 */
function getGroupConfigTargetLabel(data) {
  if (!data) return '';
  return data.rank1stSourceLabel || data.targetLabel || '';
}

/**
 * 범례 영역 HTML을 생성합니다.
 */
function buildLegendHtml(data, hidden, opts = {}) {
  if (!data.groupResults) return '';
  const items = buildGroupedLegendRowsHtml(data, hidden);
  if (!items) return '';
  const { showDualBar = false, isDualBar = false } = opts;
  const criterionLabel = data.criterionLabel || null;
  const groupConfigTargetLabel = getGroupConfigTargetLabel(data);

  const dualBarBtnHtml = showDualBar
    ? `<button type="button" class="two-compare-btn${isDualBar ? ' is-active' : ''}" data-dual-bar-toggle="${escapeHtml(data.targetLabel)}">${isDualBar ? '기본 그래프로 보기' : '두 그룹만 비교하기'}</button>`
    : '';

  return `
    <aside class="legend-panel">
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">${items}</div>
      <div class="legend-btn-group">
        <div class="legend-actions" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">
          <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
          <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
          ${criterionLabel ? `<button type="button" class="legend-action-btn" data-open-group-config="true" data-target="${escapeHtml(groupConfigTargetLabel)}" data-criterion="${escapeHtml(criterionLabel)}">그룹 편집</button>` : ''}
        </div>
        ${dualBarBtnHtml}
      </div>
    </aside>
  `;
}

/**
 * 데이터 테이블 셀 라벨을 HTML 이스케이프와 함께 렌더링합니다.
 */
function renderTableOptionLabel(option, targetLabel) {
  const safeOption = escapeHtml(option);
  if (!isOtherOption(option)) return safeOption;
  return `${safeOption}<button type="button" class="other-response-open-btn" data-open-other="${escapeHtml(targetLabel)}">응답 보기</button>`;
}

/**
 * 문항 전체 설명·타이틀 HTML을 생성합니다.
 */
function buildQuestionFullHtml(entry) {
  return entry && entry.full
    ? `<div class="result-question-full">Q. ${escapeHtml(entry.full)}</div>`
    : '';
}

/**
 * 결과 블록 헤더·레이아웃 래퍼 HTML을 생성합니다.
 */
function buildResultHeaderHtml(titleHtml, fullTextHtml = '', controlsHtml = '', actionsHtml = '') {
  const actions = actionsHtml || '';
  return `
    <div class="result-header">
      <div class="result-header-top">
        <div class="result-title">
          ${titleHtml}
          ${fullTextHtml}
        </div>
        <div class="result-header-actions">${actions}</div>
      </div>
      ${controlsHtml}
    </div>
  `;
}

/**
 * 현재 UI/상태/인덱스에서 파생 값을 조회합니다.
 */
function getResultVisualClass(hasLegend) {
  return hasLegend ? 'result-visual has-legend' : 'result-visual';
}

/**
 * 차트·표·컨트롤 등 화면용 HTML 조각을 생성합니다.
 */
function buildGroupedCountHeader(label, count, colspan) {
  return `<th colspan="${colspan}" class="group-col">${escapeHtml(label)}</th>`;
}

/**
 * 결과 데이터 테이블 HTML을 생성합니다.
 */
function buildDataTableToggleButtonHtml() {
  return `
    <button type="button" class="result-table-toggle" data-data-table-toggle aria-expanded="true">
      <img class="result-table-toggle-icon result-table-toggle-icon-up" src="assets/icons/keyboard_arrow_up_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true">
      <img class="result-table-toggle-icon result-table-toggle-icon-down" src="assets/icons/keyboard_arrow_down_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true">
      <span class="result-table-toggle-label" data-label-expanded="데이터 테이블 숨기기" data-label-collapsed="데이터 테이블 펼치기">데이터 테이블 숨기기</span>
    </button>
  `;
}

/**
 * wrapResultTable: 대시보드 시각화/집계 로직의 일부입니다(이름·호출 맥락 참고).
 */
function wrapResultTable(tableHtml, noteHtml = '') {
  return `
    <div class="result-table-section" data-data-table-section>
      <div class="result-table-header">
        ${buildDataTableToggleButtonHtml()}
        <button type="button" class="result-table-copy-btn" data-data-table-copy aria-label="데이터 테이블 복사하기" title="데이터 테이블 복사하기">
          <img class="result-table-copy-icon" src="assets/icons/content_copy_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true">
        </button>
      </div>
      <div class="result-table-body" data-data-table-body>
        <div class="result-table-wrap">
          ${tableHtml}
        </div>
        ${noteHtml}
      </div>
    </div>
  `;
}

/**
 * 단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.
 */
function buildSimpleChoiceTableHtml(data) {
  const { totalResults, totalN } = data;
  const sumPct = totalResults.reduce((s, r) => s + r.pct, 0);
  return `
    <table class="result-table">
      <thead>
        <tr>
          <th>보기</th>
          <th class="num">응답 비율(%)</th>
          <th class="num">응답 수(명)</th>
        </tr>
      </thead>
      <tbody>
        ${totalResults.map(r => `
          <tr>
            <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
            <td class="num">${formatPercent(r.pct)}</td>
            <td class="num">${r.count.toLocaleString()}</td>
          </tr>
        `).join('')}
        <tr class="total-row">
          <td>합계</td>
          <td class="num">${formatPercent(sumPct)}</td>
          <td class="num">${totalN.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  `;
}

/**
 * 단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.
 */
function buildChoiceDataTableHtml(data, noteHtml = '') {
  const { totalResults, groupResults, totalN } = data;
  if (!groupResults) {
    return wrapResultTable(buildSimpleChoiceTableHtml(data), noteHtml);
  }

  const hidden = resultState.hiddenGroupKeys.get(data.targetLabel) || new Set();
  const displayGroups = getDisplayGroupResults(groupResults, hidden);
  const topRow1 = [
    `<th rowspan="2">보기</th>`,
    buildGroupedCountHeader('응답자 전체', totalN, 2),
    ...displayGroups.map(g => buildGroupedCountHeader(g.label, g.n, 2))
  ].join('');
  const topRow2 = [
    `<th class="num group-col">응답 비율(%)</th><th class="num">응답 수(명)</th>`,
    ...displayGroups.map(() => `<th class="num group-col">응답 비율(%)</th><th class="num">응답 수(명)</th>`)
  ].join('');

  const bodyRows = totalResults.map(r => {
    const groupCells = displayGroups.map(g => {
      const gr = g.results.find(x => x.option === r.option) || { pct: 0, count: 0 };
      return `<td class="num group-col">${formatPercent(gr.pct)}</td><td class="num">${gr.count.toLocaleString()}</td>`;
    }).join('');
    return `
      <tr>
        <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
        <td class="num group-col">${formatPercent(r.pct)}</td>
        <td class="num">${r.count.toLocaleString()}</td>
        ${groupCells}
      </tr>
    `;
  }).join('');
  const totalGroupCells = displayGroups.map(g => {
    const totalCount = totalResults.reduce((sum, result) => {
      const gr = g.results.find(x => x.option === result.option);
      return sum + ((gr && gr.count) || 0);
    }, 0);
    const totalPct = g.n > 0 ? (totalCount / g.n) * 100 : 0;
    return `<td class="num group-col">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
  }).join('');

  const tableHtml = `
    <table class="result-table">
      <thead>
        <tr>${topRow1}</tr>
        <tr>${topRow2}</tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total-row">
          <td>합계</td>
          <td class="num group-col">${formatPercent(totalResults.reduce((sum, result) => sum + (result.pct || 0), 0))}</td>
          <td class="num">${totalN.toLocaleString()}</td>
          ${totalGroupCells}
        </tr>
      </tbody>
    </table>
  `;
  return wrapResultTable(tableHtml, noteHtml);
}

/**
 * 차트 팔레트용 고정/순환 색 값을 반환합니다.
 */
function allocationColor(index) {
  const idx = Math.max(0, Number(index) || 0);
  return ALLOCATION_PALETTE[idx % ALLOCATION_PALETTE.length];
}

/**
 * 비율 배분 문항 차트·스택·표 HTML을 생성합니다.
 */
function buildRatioAllocationStackHtml(results, options = {}) {
  const { groupLabel = '', n = 0, showLabels = true } = options;
  const safeResults = Array.isArray(results) ? results : [];
  const segmentsHtml = safeResults.map((result, index) => {
    const width = Math.max(0, Math.min(100, Number(result.pct) || 0));
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'ratio-allocation',
      groupLabel,
      option: result.option,
      pct: result.pct,
      count: n || result.count || 0
    }));
    return `
      <div class="allocation-segment ${width < 6 ? 'is-narrow' : ''}"
           style="width:${width}%; background:${allocationColor(index)};"
           data-tip="${tip}">
        <span class="allocation-segment-value">${formatPercent(result.pct)}</span>
      </div>
    `;
  }).join('');
  const labelsHtml = safeResults.map((result, index) => {
    const width = Math.max(0, Math.min(100, Number(result.pct) || 0));
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'ratio-allocation',
      groupLabel,
      option: result.option,
      pct: result.pct,
      count: n || result.count || 0
    }));
    const posClass = index === 0 ? 'is-start' : (index === safeResults.length - 1 ? 'is-end' : 'is-center');
    return `
      <div class="allocation-item-label ${posClass}" style="width:${width}%;" data-tip="${tip}">
        <span class="allocation-item-text">${escapeHtml(result.option)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="allocation-stack-wrap">
      <div class="allocation-stack-track">${segmentsHtml}</div>
      ${showLabels ? `<div class="allocation-label-row">${labelsHtml}</div>` : ''}
    </div>
  `;
}

/**
 * 범례 영역 HTML을 생성합니다.
 */
function buildAllocationGroupLegendHtml(data, hiddenGroups) {
  const options = data.totalResults || [];
  const optionItems = options.map((opt, i) => {
    const color = allocationColor(i);
    return `<div class="legend-item is-static"><span class="legend-swatch" style="background:${color}"></span><span title="${escapeHtml(opt.option)}">${escapeHtml(opt.option)}</span></div>`;
  }).join('');

  const groupItems = buildGroupedLegendRowsHtml(data, hiddenGroups);
  if (!groupItems) {
    return `<aside class="legend-panel"><div class="legend is-static">${optionItems}</div></aside>`;
  }

  const criterionLabel = data.criterionLabel || null;
  const groupConfigTargetLabel = getGroupConfigTargetLabel(data);

  return `
    <aside class="legend-panel">
      <div class="legend is-static">${optionItems}</div>
      <div class="lane-group-legend-divider"></div>
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">${groupItems}</div>
      <div class="legend-actions" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">
        <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
        <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
        ${criterionLabel ? `<button type="button" class="legend-action-btn" data-open-group-config="true" data-target="${escapeHtml(groupConfigTargetLabel)}" data-criterion="${escapeHtml(criterionLabel)}">그룹 편집</button>` : ''}
      </div>
    </aside>
  `;
}

/**
 * 비율 배분 문항 차트·스택·표 HTML을 생성합니다.
 */
function buildRatioAllocationChartHtml(data, hiddenGroups = new Set()) {
  if (!data.groupResults) {
    return `
      <div class="allocation-chart">
        ${buildRatioAllocationStackHtml(data.totalResults, { n: data.totalN })}
      </div>
    `;
  }

  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  if (displayGroups.length === 0) return '<div class="result-empty">표시할 그룹이 없습니다.</div>';
  const overallRowHtml = `
    <div class="lane-group-row">
      <div class="lane-group-label">응답자 전체</div>
      <div class="lane-group-cell">
        ${buildRatioAllocationStackHtml(data.totalResults, { groupLabel: '응답자 전체', n: data.totalN, showLabels: false })}
      </div>
    </div>
    <div class="lane-group-divider"></div>
  `;
  const rowsHtml = displayGroups.map(group => {
    return `
      <div class="lane-group-row">
        <div class="lane-group-label">${escapeHtml(group.label)}</div>
        <div class="lane-group-cell">
          ${buildRatioAllocationStackHtml(group.results, { groupLabel: group.label, n: group.n, showLabels: false })}
        </div>
      </div>
    `;
  }).join('');
  return `<div class="lane-group-chart">${overallRowHtml}${rowsHtml}</div>`;
}

/**
 * 비율 배분 문항 차트·스택·표 HTML을 생성합니다.
 */
function buildRatioAllocationDataTableHtml(data, hiddenGroups = new Set()) {
  if (!data.groupResults) {
    const tableHtml = `
      <table class="result-table ratio-allocation-table">
        <thead>
          <tr>
            <th>배분 항목</th>
            <th class="num">평균 배분값</th>
            <th class="num">응답 수(명)</th>
          </tr>
        </thead>
        <tbody>
          ${data.totalResults.map(result => `
            <tr>
              <td>${escapeHtml(result.option)}</td>
              <td class="num mean-value">${formatPercent(result.pct)}</td>
              <td class="num">${Number(result.count || 0).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    return wrapResultTable(tableHtml);
  }

  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const topRow = [
    `<th rowspan="2">배분 항목</th>`,
    `<th colspan="2">응답자 전체</th>`,
    ...displayGroups.map(group => buildGroupedCountHeader(group.label, group.n, 2))
  ].join('');
  const subRow = [
    `<th class="num">평균 배분값</th><th class="num">응답 수(명)</th>`,
    ...displayGroups.map(() => `<th class="num group-col">평균 배분값</th><th class="num">응답 수(명)</th>`)
  ].join('');
  const bodyRows = data.totalResults.map(result => {
    const groupCells = displayGroups.map(group => {
      const groupResult = group.results.find(item => item.option === result.option) || { pct: 0, count: 0 };
      return `<td class="num group-col mean-value">${formatPercent(groupResult.pct)}</td><td class="num">${Number(group.n || groupResult.count || 0).toLocaleString()}</td>`;
    }).join('');
    return `
      <tr>
        <td>${escapeHtml(result.option)}</td>
        <td class="num mean-value">${formatPercent(result.pct)}</td>
        <td class="num">${Number(result.count || 0).toLocaleString()}</td>
        ${groupCells}
      </tr>
    `;
  }).join('');
  const tableHtml = `
    <table class="result-table ratio-allocation-table">
      <thead>
        <tr>${topRow}</tr>
        <tr>${subRow}</tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

/**
 * 비율 배분 문항 차트·스택·표 HTML을 생성합니다.
 */
function buildRatioAllocationSection(data) {
  if (!data) return '';
  const { codebookEntry, targetLabel, groupResults } = data;
  const customGroupOn = shouldApplyCustomGroup(data);
  const customGroupData = (customGroupOn && groupResults) ? buildCustomGroupData(data) : null;
  const baseData = customGroupData || data;
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const showChartType = !baseData.groupResults;
  const chartType = showChartType ? getRatioChartType(targetLabel) : 'bar_horizontal_100';
  const isPie = chartType === 'pie';
  const chevron = 'assets/icons/keyboard_arrow_down_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg';
  const menuKey = `ratio:${targetLabel}`;
  const isMenuOpen = resultState.openChoiceMenus.has(menuKey);

  const invalidNote = baseData.invalidN > 0
    ? ` 합계가 100이 아니거나 비어 있는 응답 ${Number(baseData.invalidN).toLocaleString()}건은 제외했습니다.`
    : '';
  const allocationNoteHtml = `<div class="viz-controls-note">각 응답자가 두 항목의 합이 100이 되도록 값을 나누어 기입하는 문항입니다. 아래 차트는 각 항목에 기입한 값의 평균을 보여줍니다.${invalidNote}</div>`;

  const chartRowHtml = showChartType ? `
      <div class="viz-controls-element">
        <span class="viz-controls-label">그래프 모양 선택</span>
        <div class="viz-control-dropdown ${isMenuOpen ? 'is-open' : ''}" data-choice-chart-type-select data-target="${escapeHtml(targetLabel)}" data-scope="ratio">
          <button type="button" class="viz-control-dropdown__trigger" data-choice-chart-type-trigger data-target="${escapeHtml(targetLabel)}" data-scope="ratio" aria-haspopup="listbox" aria-expanded="${isMenuOpen ? 'true' : 'false'}">
            <span class="viz-control-dropdown__current">${escapeHtml(SCALE_RATIO_CHART_TYPE_LABELS[chartType] || SCALE_RATIO_CHART_TYPE_LABELS.bar_horizontal_100)}</span>
            <img class="viz-control-dropdown__chevron" src="${chevron}" alt="" aria-hidden="true">
          </button>
          <div class="viz-control-dropdown__menu" role="listbox" ${isMenuOpen ? '' : 'hidden'}>
            ${RATIO_CHART_TYPES.map(type => `
              <button type="button"
                      class="viz-control-dropdown__option"
                      data-choice-chart-type="${type}"
                      data-choice-chart-scope="ratio"
                      data-target="${escapeHtml(targetLabel)}"
                      role="option"
                      aria-selected="${type === chartType ? 'true' : 'false'}">
                ${escapeHtml(SCALE_RATIO_CHART_TYPE_LABELS[type])}
              </button>
            `).join('')}
          </div>
        </div>
      </div>` : '';

  const controlsHtml = `<div class="viz-controls">${chartRowHtml}${allocationNoteHtml}</div>`;

  const baseChartHtml = isPie
    ? buildRatioAllocationPieChartHtml(baseData)
    : buildRatioAllocationChartHtml(baseData, hiddenGroups);
  const legendHtml = baseData.groupResults
    ? buildAllocationGroupLegendHtml(baseData, hiddenGroups)
    : (isPie ? buildRatioAllocationItemLegendHtml(baseData) : '');
  const tableHtml = buildRatioAllocationDataTableHtml(baseData, hiddenGroups);
  const fullText = buildQuestionFullHtml(codebookEntry);
  const visualClass = getResultVisualClass(!!legendHtml);

  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="ratio-allocation">
      ${buildResultHeaderHtml(`<div class="result-question-label">${escapeHtml(targetLabel)}</div>`, fullText, controlsHtml)}
      <div class="${visualClass}">
        <div class="result-chart-col">${baseChartHtml}</div>
        ${legendHtml}
      </div>
      ${tableHtml}
    </section>
  `;
}

/**
 * 척도 시각화 보기 모드(분포/평균 등)를 반환합니다.
 */
function getScaleViewMode(targetLabel) {
  return resultState.scaleViewModes.get(targetLabel) || 'distribution';
}

/**
 * 척도 중립점 숨김을 지원하는지 데이터를 보고 판단합니다.
 */
function canHideScaleMidpoint(data) {
  return !!(data && Array.isArray(data.scoreRange) && data.scoreRange.length >= 3 && (data.scoreRange.length % 2 === 1));
}

/**
 * 해당 문항에서 척도 중립점이 숨겨졌는지 상태를 반환합니다.
 */
function isScaleMidpointHidden(targetLabel) {
  return !!resultState.scaleMidpointHidden.get(targetLabel);
}

function isScaleGroupSortedByMean(targetLabel) {
  return !!resultState.scaleGroupSortByMean.get(targetLabel);
}

function sortGroupsByMean(groups) {
  return [...groups].sort((a, b) => {
    const aMean = Number.isFinite(Number(a.mean)) ? Number(a.mean) : Number.NEGATIVE_INFINITY;
    const bMean = Number.isFinite(Number(b.mean)) ? Number(b.mean) : Number.NEGATIVE_INFINITY;
    return bMean - aMean;
  });
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleToggleHtml(targetLabel, activeMode, options = {}) {
  const {
    showMidpointOption = false,
    hideMidpoint = false,
    disabledModes = [],
    showChartType = false,
    chartType = 'bar_horizontal_100',
    showMeanSortOption = false,
    sortByMean = false,
    isGroupSort = false
  } = options;
  const isPie = chartType === 'pie';
  const chevron = 'assets/icons/keyboard_arrow_down_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg';
  const menuKey = `scale:${targetLabel}`;
  const isMenuOpen = resultState.openChoiceMenus.has(menuKey);

  const chartTypeHtml = showChartType ? `
    <div class="viz-controls-element">
      <span class="viz-controls-label">그래프 모양 선택</span>
      <div class="viz-control-dropdown ${isMenuOpen ? 'is-open' : ''}" data-choice-chart-type-select data-target="${escapeHtml(targetLabel)}" data-scope="scale">
        <button type="button" class="viz-control-dropdown__trigger" data-choice-chart-type-trigger data-target="${escapeHtml(targetLabel)}" data-scope="scale" aria-haspopup="listbox" aria-expanded="${isMenuOpen ? 'true' : 'false'}">
          <span class="viz-control-dropdown__current">${escapeHtml(SCALE_RATIO_CHART_TYPE_LABELS[chartType] || SCALE_RATIO_CHART_TYPE_LABELS.bar_horizontal_100)}</span>
          <img class="viz-control-dropdown__chevron" src="${chevron}" alt="" aria-hidden="true">
        </button>
        <div class="viz-control-dropdown__menu" role="listbox" ${isMenuOpen ? '' : 'hidden'}>
          ${SCALE_CHART_TYPES.map(type => `
            <button type="button"
                    class="viz-control-dropdown__option"
                    data-choice-chart-type="${type}"
                    data-choice-chart-scope="scale"
                    data-target="${escapeHtml(targetLabel)}"
                    role="option"
                    aria-selected="${type === chartType ? 'true' : 'false'}">
              ${escapeHtml(SCALE_RATIO_CHART_TYPE_LABELS[type])}
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  ` : '';

  const allDisabledModes = isPie ? ['distribution', 'mean'] : disabledModes;
  const buttons = [
    { mode: 'distribution', label: '분포 보기' },
    { mode: 'mean', label: '평균 보기' }
  ].map(item => {
    const disabled = allDisabledModes.includes(item.mode);
    let disabledTitle = '';
    if (disabled) {
      if (targetLabel === TARGET_SCALE_COMPARE_VIEW_KEY && item.mode === 'distribution') {
        disabledTitle = '그룹별 비교 기준이 적용된 상태에서는 분포 보기를 사용할 수 없습니다. 분포 보기를 보려면 그룹별 비교 기준을 해제해 주세요.';
      } else if (isPie) {
        disabledTitle = '원형 그래프에서는 분포·평균 보기 전환을 사용할 수 없습니다.';
      } else {
        disabledTitle = '현재 이 보기를 선택할 수 없습니다.';
      }
    }
    const titleAttr = disabled ? ` title="${escapeHtml(disabledTitle)}"` : '';
    return `
    <button type="button"
            class="viz-control-toggle__btn ${activeMode === item.mode && !isPie ? 'active' : ''}"
            data-scale-mode="${item.mode}"
            data-target="${escapeHtml(targetLabel)}"
            ${disabled ? `disabled${titleAttr}` : ''}>
      ${escapeHtml(item.label)}
    </button>
  `;
  }).join('');
  const midpointOption = showMidpointOption ? `
    <label class="viz-control-checkbox${isPie ? ' is-disabled' : ''}">
      <input type="checkbox" data-scale-hide-midpoint="true" data-target="${escapeHtml(targetLabel)}" ${hideMidpoint ? 'checked' : ''} ${isPie ? 'disabled' : ''}>
      <span class="viz-control-checkbox__label">중간값 제외 보기</span>
    </label>
  ` : '';
  const midpointGuide = showMidpointOption ? `
    <div class="viz-controls-note">중간값 제외 보기는 차트에서만 시각적으로 제외하며, 응답 비율의 계산 모수와 원본 수치는 바뀌지 않습니다.</div>
  ` : '';
  const meanSortAttr = isGroupSort ? 'data-scale-group-sort-mean' : 'data-scale-compare-sort-mean';
  const meanSortOption = showMeanSortOption ? `
    <label class="viz-control-checkbox">
      <input type="checkbox" ${meanSortAttr}="true" data-target="${escapeHtml(targetLabel)}" ${sortByMean ? 'checked' : ''}>
      <span class="viz-control-checkbox__label">평균값이 높은 순서로 정렬</span>
    </label>
  ` : '';
  return `
    <div class="viz-controls">
      ${chartTypeHtml}
      <div class="viz-control-toggle">${buttons}</div>
      ${meanSortOption}
      ${midpointOption}
      ${midpointGuide}
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleAxisHtml(maxScore, showLabels = false) {
  return `
    <div class="scale-axis">
      ${Array.from({ length: maxScore }, (_, i) => {
        const score = i + 1;
        const left = maxScore === 1 ? 50 : (i / (maxScore - 1)) * 100;
        return `
          <span class="scale-axis-container" style="left:${left}%;">
            <span class="scale-axis-tick"></span>
          </span>
          ${showLabels ? `<span class="scale-axis-label" style="left:${left}%;">${score}</span>` : ''}
        `;
      }).join('')}
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleMeanHtml(mean, maxScore, tipData, options = {}) {
  const { markerColor = '', hideValue = false, hideLabel = false, hideMarker = false } = options;
  if (hideMarker) return '<div class="scale-mean-row"></div>';
  if (!Number.isFinite(mean) || mean <= 0) return '<div class="scale-mean-row"></div>';
  const left = getScaleMeanLeftPct(mean, maxScore);
  const dotStyle = markerColor || hideValue
    ? ` style="${markerColor ? `background:${markerColor};` : ''}${hideValue ? 'color:transparent;' : ''}"`
    : '';
  return `
    <div class="scale-mean-row">
      <div class="scale-mean centered" style="left:${left}%;" data-tip="${encodeURIComponent(JSON.stringify(tipData))}">
        ${hideLabel ? '' : `<div class="scale-mean-label">평균</div>`}
        <div class="scale-mean-dot"${dotStyle}>${hideValue ? '' : formatScaleMeanDisplay(mean)}</div>
      </div>
    </div>
  `;
}

/**
 * 척도 막대/트랙에 쓸 점수별 표시용 결과를 가공합니다.
 */
function getScaleDisplayResults(scoreResults, options = {}) {
  const { hideMidpoint = false } = options;
  const source = Array.isArray(scoreResults) ? scoreResults : [];
  if (!hideMidpoint || source.length === 0 || (source.length % 2) !== 1) {
    return source.map(result => ({
      ...result,
      displayPct: result.pct || 0
    }));
  }
  const midpoint = (source.length + 1) / 2;
  const filtered = source.filter(result => result.score !== midpoint);
  const visibleTotalPct = filtered.reduce((sum, result) => sum + (result.pct || 0), 0);
  return filtered.map(result => ({
    ...result,
    displayPct: visibleTotalPct > 0 ? ((result.pct || 0) / visibleTotalPct) * 100 : 0
  }));
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleTrackHtml(scoreResults, maxScore, options = {}) {
  const { muted = false, interactive = true, hideMidpoint = false, groupLabel = '' } = options;
  const displayResults = getScaleDisplayResults(scoreResults, { hideMidpoint });
  const widths = displayResults.map(r => Math.max(0, Math.min(100, r.displayPct || 0)));
  const firstNonZero = widths.findIndex(w => w > 0);
  const lastNonZero = widths.reduce((acc, w, i) => w > 0 ? i : acc, -1);
  const segments = displayResults.map((result, i) => {
    const width = widths[i];
    const color = muted ? getScaleMutedColor(result.score, maxScore) : getScaleColor(result.score, maxScore);
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'scale-segment',
      groupLabel: groupLabel || undefined,
      score: result.score,
      scoreLabel: result.label,
      pct: result.pct,
      count: result.count
    }));
    const edgeClass = (i === firstNonZero ? ' is-first' : '') + (i === lastNonZero ? ' is-last' : '');
    return `
      <div class="scale-segment${edgeClass}"
           style="width:${width}%; background:${color};"
           ${interactive ? `data-tip="${tip}"` : ''}></div>
    `;
  }).join('');
  const valueLabels = !muted ? displayResults.map(result => {
    const width = Math.max(0, Math.min(100, result.displayPct || 0));
    return `
      <div class="scale-segment-value-slot" style="flex:0 0 ${width}%;">
        ${width >= 6 ? `<span class="scale-segment-value">${formatPercent(result.pct)}</span>` : ''}
      </div>
    `;
  }).join('') : '';
  return `
    <div class="scale-bar ${muted ? 'is-muted' : ''}">
      ${valueLabels ? `<div class="scale-segment-value-row">${valueLabels}</div>` : ''}
      <div class="scale-track ${muted ? 'is-muted' : ''}">${segments}</div>
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleEdgeLabelsHtml(scoreResults) {
  const items = Array.isArray(scoreResults) ? scoreResults : [];
  if (items.length < 2) return '';
  const first = items[0];
  const last = items[items.length - 1];
  const firstLabel = cleanCell(first && first.label);
  const lastLabel = cleanCell(last && last.label);
  const firstDefault = first ? `${first.score}점` : '';
  const lastDefault = last ? `${last.score}점` : '';
  const leftCopy = firstLabel && firstLabel !== firstDefault ? firstLabel : '';
  const rightCopy = lastLabel && lastLabel !== lastDefault ? lastLabel : '';
  if (!leftCopy && !rightCopy) return '';
  return `
    <div class="scale-edge-labels" aria-hidden="true">
      <span class="scale-edge-label is-left">${escapeHtml(leftCopy)}</span>
      <span class="scale-edge-label is-right">${escapeHtml(rightCopy)}</span>
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleDistributionSummaryHtml(scoreResults) {
  const summary = getScalePolaritySummary(scoreResults);
  return `
    <div class="scale-summary">
      <div class="scale-summary-item"><span class="label">하위 척도 응답 합계</span><span class="value">${formatPercent(summary.negativePct)}</span></div>
      <div class="scale-summary-item is-positive"><span class="label">상위 척도 응답 합계</span><span class="value">${formatPercent(summary.positivePct)}</span></div>
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleDistributionBarHtml(scoreResults, maxScore, options = {}) {
  const { hideMidpoint = false, hideSummary = false, groupLabel = '' } = options;
  return `
    <div class="scale-bar-wrap">
      ${buildScaleTrackHtml(scoreResults, maxScore, { hideMidpoint, groupLabel })}
      ${hideSummary ? '' : buildScaleDistributionSummaryHtml(scoreResults)}
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleMeanOnlyHtml(mean, maxScore, meanTipData, scoreResults, options = {}) {
  const { hideMidpoint = false, meanMarkerColor = '', hideMeanValue = false, hideMeanLabel = false, hideMeanMarker = false } = options;
  return `
    <div class="scale-mean-only">
      <div class="scale-mean-background">
        ${buildScaleTrackHtml(scoreResults, maxScore, { muted: true, interactive: false, hideMidpoint })}
      </div>
      ${buildScaleAxisHtml(maxScore, true)}
      ${buildScaleEdgeLabelsHtml(scoreResults)}
      ${buildScaleMeanHtml(mean, maxScore, meanTipData, {
        markerColor: meanMarkerColor,
        hideValue: hideMeanValue,
        hideLabel: hideMeanLabel,
        hideMarker: hideMeanMarker
      })}
    </div>
  `;
}

/**
 * 척도 점수·평균 등 표시용 문자열로 포맷합니다.
 */
function formatScaleScoreLabel(result) {
  if (!result) return '';
  const baseLabel = `${result.score}점`;
  return result.label !== baseLabel
    ? `${baseLabel} - ${escapeHtml(result.label)}`
    : baseLabel;
}

/**
 * 척도 구간 툴팁 첫 줄: `N점`, 보기 문구가 있으면 `N점 · 보기문구`.
 */
function formatScaleScoreTooltipTitle(score, scoreLabel) {
  const scoreNum = Number(score);
  const base = Number.isFinite(scoreNum) ? `${scoreNum}점` : `${score}점`;
  const label = cleanCell(scoreLabel);
  if (!label || label === base) return base;
  return `${base} · ${label}`;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildDerivedScaleBoxPlotHtml(data, viewMode, { hideAxis = false, mutedMeanMarker = false, hideMeanMarker = false } = {}) {
  const axisMin = 1;
  const axisMax = data.scoreRange.length;
  const item = { ...data, n: data.n ?? data.totalN };
  return `
    <div class="box-plot-chart${viewMode === 'mean' ? ' is-mean-mode' : ''}">
      <div class="box-plot-body">
        ${buildNumericWhiskerTrackHtml(item, axisMin, axisMax, '', data.groupLabel || '', {
          meanDecimals: 2,
          quartileDecimals: 2,
          valueFormatter: formatFixedDecimal,
          fixedDecimals: true,
          color: data.color,
          mutedMeanMarker,
          hideMeanMarker
        })}
        ${hideAxis ? '' : `<div class="chart-bottom-axis">${buildIntegerBoxAxisHtml(axisMin, axisMax)}</div>`}
      </div>
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleLegendItemsHtml(data) {
  const maxScore = data.scoreRange.length;
  const items = data.scoreResults.map(result => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${getScaleColor(result.score, maxScore)}"></span>
      <span>${result.score}점${result.label !== `${result.score}점` ? `<span class="legend-item-sub"> - ${escapeHtml(result.label)}</span>` : ''}</span>
    </div>
  `).join('');
  return `<div class="legend is-static">${items}</div>`;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleLegendItemsByScoreRangeHtml(scoreRange) {
  const scores = Array.isArray(scoreRange) ? scoreRange : [];
  const maxScore = scores.length;
  const items = scores.map(score => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${getScaleColor(score, maxScore)}"></span>
      <span>${score}점</span>
    </div>
  `).join('');
  return `<div class="legend is-static">${items}</div>`;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleScoreOnlyLegendHtml(scoreRange) {
  return `
    <aside class="legend-panel">
      ${buildScaleLegendItemsByScoreRangeHtml(scoreRange)}
    </aside>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleLegendHtml(data) {
  return `
    <aside class="legend-panel">
      ${buildScaleLegendItemsHtml(data)}
    </aside>
  `;
}

/**
 * 척도 다문항 비교 후보 엔트리 목록을 반환합니다.
 */
function getScaleCompareCandidateEntries(targetLabel) {
  const baseEntry = resultState.codebookByLabel.get(targetLabel);
  if (!baseEntry || !isScaleChoiceType(baseEntry.type)) return [];
  const targetValueCount = Number(baseEntry.valueCount);
  const baseIsDerived = isDerivedScaleEntry(baseEntry);
  return Array.from(resultState.codebookByLabel.values()).filter(entry => {
    if (!entry || entry.label === targetLabel) return false;
    if (!isScaleChoiceType(entry.type)) return false;
    if (isDerivedScaleEntry(entry) !== baseIsDerived) return false;
    if (!baseIsDerived && entry.role !== 'raw') return false;
    return Number(entry.valueCount) === targetValueCount;
  });
}

/**
 * 비교 모달에서 선택된 척도 문항 라벨을 반환합니다.
 */
function getScaleCompareSelectedLabels(targetLabel) {
  const allowed = new Set(getScaleCompareCandidateEntries(targetLabel).map(entry => entry.label));
  const current = Array.isArray(resultState.scaleCompareSelections.get(targetLabel))
    ? resultState.scaleCompareSelections.get(targetLabel)
    : [];
  const next = current.filter(label => allowed.has(label));
  if (next.length !== current.length) {
    if (next.length > 0) resultState.scaleCompareSelections.set(targetLabel, next);
    else resultState.scaleCompareSelections.delete(targetLabel);
  }
  return next;
}

/**
 * 여러 대상 척도 문항을 같은 기준으로 묶어 비교용 데이터를 집계합니다.
 */
function aggregateTargetScaleCompareData(targetLabels, criterionLabel, rows) {
  const compareLabels = getTargetScaleCompareLabels(targetLabels);
  if (compareLabels.length < 2) return null;
  const compared = compareLabels.map(label => aggregateScale(label, criterionLabel, rows))
    .filter(item => item && item.visualType === 'scale');
  if (compared.length < 2) return null;

  const baseData = compared[0];
  const questions = compared.map(item => ({
    value: item.targetLabel,
    label: item.targetLabel,
    full: item.codebookEntry && item.codebookEntry.full ? item.codebookEntry.full : '',
    mean: item.mean,
    totalN: item.totalN,
    data: item
  }));

  let groups = null;
  if (baseData.groupResults) {
    const baseGroups = Array.isArray(baseData.groupResults) ? baseData.groupResults : [];
    groups = baseGroups.map(group => {
      const points = compared.map(item => {
        const found = Array.isArray(item.groupResults)
          ? item.groupResults.find(candidate => candidate.value === group.value)
          : null;
        return {
          questionLabel: item.targetLabel,
          mean: found ? found.mean : 0,
          n: found ? found.n : 0
        };
      });
      return {
        value: group.value,
        label: group.label,
        color: getGroupColor(baseGroups, group.value),
        points
      };
    }).filter(group => group.points.some(point => point.n > 0));
  }

  return {
    targetLabel: baseData.targetLabel,
    baseData,
    maxScore: baseData.scoreRange.length,
    criterionLabel: baseData.criterionLabel,
    questions,
    groups
  };
}

/**
 * 척도 비교 표에서 문항을 평균 기준으로 정렬합니다.
 */
function sortScaleCompareQuestionsByMean(compareData) {
  if (!compareData || !Array.isArray(compareData.questions)) return compareData;
  const ordered = compareData.questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => {
      const aMean = Number(a.question && a.question.mean);
      const bMean = Number(b.question && b.question.mean);
      const aValue = Number.isFinite(aMean) ? aMean : Number.NEGATIVE_INFINITY;
      const bValue = Number.isFinite(bMean) ? bMean : Number.NEGATIVE_INFINITY;
      if (bValue !== aValue) return bValue - aValue;
      return a.index - b.index;
    });
  return {
    ...compareData,
    questions: ordered.map(item => item.question),
    groups: Array.isArray(compareData.groups)
      ? compareData.groups.map(group => ({
          ...group,
          points: ordered.map(({ question, index }) => (
            Array.isArray(group.points) && group.points[index]
              ? group.points[index]
              : { questionLabel: question.label, mean: 0, n: 0 }
          ))
        }))
      : compareData.groups
  };
}

/**
 * 숨김 처리 반영 후 실제로 그릴 척도 비교 그룹 목록을 반환합니다.
 */
function getDisplayScaleCompareGroups(groups, hiddenGroups) {
  if (!Array.isArray(groups)) return [];
  return groups.filter(group => {
    if (hiddenGroups && hiddenGroups.has(group.value)) return false;
    return Array.isArray(group.points) && group.points.some(point => point.n > 0);
  });
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareLegendHtml(groups, hiddenGroups = new Set(), targetLabel = '', criterionLabel = '', opts = {}) {
  if (!Array.isArray(groups) || groups.length === 0) return '';
  const { showDualBar = false, isDualBar = false } = opts;
  const items = [
    `<div class="legend-row"><div class="legend-item is-static"><span class="legend-swatch" style="background:var(--neutral-700);"></span><span>응답자 전체</span></div></div>`,
    ...groups.map(group => {
      const isHidden = hiddenGroups && hiddenGroups.has(group.value);
      return `
      <div class="legend-row">
        <label class="legend-item ${isHidden ? 'disabled' : ''}" data-group="${escapeHtml(group.value)}">
          <input type="checkbox"
                 data-scale-group-toggle="true"
                 data-target="${escapeHtml(targetLabel)}"
                 data-group="${escapeHtml(group.value)}"
                 ${isHidden ? '' : 'checked'}>
          <span class="legend-swatch" style="background:${group.color};"></span>
          <span>${escapeHtml(group.label)}</span>
        </label>
      </div>
    `;
    })
  ].join('');
  const dualBarBtnHtml = showDualBar
    ? `<button type="button" class="two-compare-btn${isDualBar ? ' is-active' : ''}" data-dual-bar-toggle="${escapeHtml(targetLabel)}">${isDualBar ? '기본 그래프로 보기' : '두 그룹만 비교하기'}</button>`
    : '';
  return `
    <aside class="legend-panel">
      <div class="legend" data-target="${escapeHtml(targetLabel)}" data-mode="group">${items}</div>
      <div class="legend-btn-group">
        <div class="legend-actions" data-target="${escapeHtml(targetLabel)}" data-mode="group">
          <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
          <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
          ${criterionLabel ? `<button type="button" class="legend-action-btn" data-open-group-config="true" data-target="${escapeHtml(targetLabel)}" data-criterion="${escapeHtml(criterionLabel)}">그룹 편집</button>` : ''}
        </div>
        ${dualBarBtnHtml}
      </div>
    </aside>
  `;
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareQuestionLabelHtml(question) {
  const tip = encodeURIComponent(JSON.stringify({
    kind: 'question-full',
    label: question.label,
    full: question.full
  }));
  return `<div class="lane-group-label" data-tip="${tip}">${escapeHtml(question.label)}</div>`;
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareDistributionSectionHtml(compareData) {
  if (!compareData) return '';
  const scoreRange = compareData.baseData && Array.isArray(compareData.baseData.scoreRange)
    ? compareData.baseData.scoreRange
    : Array.from({ length: compareData.maxScore || 0 }, (_, i) => i + 1);
  const visualClass = getResultVisualClass(true);
  const rowsHtml = compareData.questions.map(question => {
    const item = question.data;
    if (!item) return '';
    const hideMidpoint = isScaleMidpointHidden(TARGET_SCALE_COMPARE_VIEW_KEY);
    const chartHtml = item.isDerivedScale
      ? buildDerivedScaleBoxPlotHtml(item, 'distribution', { hideAxis: true })
      : `<div class="scale-chart">${buildScaleDistributionBarHtml(item.scoreResults, item.scoreRange.length, { hideMidpoint, hideSummary: true })}</div>`;
    return `
      <div class="lane-group-row">
        ${buildScaleCompareQuestionLabelHtml(question)}
        <div class="lane-group-cell">${chartHtml}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="scale-compare-section">
      <div class="${visualClass}">
        <div class="result-chart-col">
          <div class="scale-compare-chart">
            <div class="lane-group-chart">${rowsHtml}</div>
          </div>
        </div>
        ${buildScaleScoreOnlyLegendHtml(scoreRange)}
      </div>
    </div>
  `;
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareScoreHeaders(scoreRange) {
  return (scoreRange || []).map(score => `
    <th class="num group-col" colspan="2">${Number(score).toLocaleString()}점</th>
  `).join("");
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareScoreSubHeaders(scoreRange) {
  return (scoreRange || []).map(() => `
    <th class="num group-col">응답 비율(%)</th><th class="num">응답 수(명)</th>
  `).join("");
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareScoreCells(scoreResults, scoreRange) {
  const results = Array.isArray(scoreResults) ? scoreResults : [];
  return (scoreRange || []).map(score => {
    const result = results.find(item => Number(item.score) === Number(score));
    if (!result) return '<td class="num group-col">-</td><td class="num">-</td>';
    return `<td class="num group-col">${formatPercent(result.pct)}</td><td class="num">${Number(result.count || 0).toLocaleString()}</td>`;
  }).join('');
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareDataTableHtml(compareData, hiddenGroups = new Set()) {
  if (!compareData || !Array.isArray(compareData.questions)) return "";
  const hasGroups = !!compareData.criterionLabel;
  const displayGroups = getDisplayScaleCompareGroups(compareData.groups, hiddenGroups);
  if (hasGroups) {
    const topRow = [
      `<th rowspan="2">문항명</th>`,
      `<th colspan="2" class="group-col">응답자 전체</th>`,
      ...displayGroups.map(group => `<th colspan="2" class="group-col">${escapeHtml(group.label)}</th>`)
    ].join("");
    const subRow = [
      `<th class="num group-col">평균</th><th class="num">응답 수(명)</th>`,
      ...displayGroups.map(() => `<th class="num group-col">평균</th><th class="num">응답 수(명)</th>`)
    ].join("");
    const bodyRows = compareData.questions.map((question, questionIndex) => {
      const groupCells = displayGroups.map(group => {
        const point = group.points[questionIndex] || { mean: 0, n: 0 };
        return `<td class="num group-col mean-value">${Number(point.mean || 0).toFixed(2)}점</td><td class="num">${Number(point.n || 0).toLocaleString()}</td>`;
      }).join("");
      return `
        <tr>
          <td>${escapeHtml(question.label)}</td>
          <td class="num group-col mean-value">${Number(question.mean || 0).toFixed(2)}점</td>
          <td class="num">${Number(question.totalN || 0).toLocaleString()}</td>
          ${groupCells}
        </tr>
      `;
    }).join("");
    return wrapResultTable(`
      <table class="result-table">
        <thead>
          <tr>${topRow}</tr>
          <tr>${subRow}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `);
  }

  const scoreRange = compareData.baseData && Array.isArray(compareData.baseData.scoreRange)
    ? compareData.baseData.scoreRange
    : Array.from({ length: compareData.maxScore || 0 }, (_, i) => i + 1);
  const bodyRows = compareData.questions.map(question => `
    <tr>
      <td>${escapeHtml(question.label)}</td>
      ${buildScaleCompareScoreCells(question.data && question.data.scoreResults, scoreRange)}
      <td class="num mean-col mean-value">${Number(question.mean || 0).toFixed(2)}점</td>
      <td class="num group-col">${Number(question.totalN || 0).toLocaleString()}</td>
    </tr>
  `).join("");
  return wrapResultTable(`
    <table class="result-table scale-compare-table">
      <thead>
        <tr>
          <th rowspan="2">문항명</th>
          ${buildScaleCompareScoreHeaders(scoreRange)}
          <th rowspan="2" class="num mean-col">평균</th>
          <th rowspan="2" class="num group-col">전체 응답 수(명)</th>
        </tr>
        <tr>
          ${buildScaleCompareScoreSubHeaders(scoreRange)}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `);
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareSectionHtml(compareData, hiddenGroups, options = {}) {
  if (!compareData) return '';
  const { showHeader = true, flush = false, isDualBar = false, showDualBar = false } = options;
  const visibleGroups = getDisplayScaleCompareGroups(compareData.groups, hiddenGroups);
  const hasGroups = visibleGroups.length > 0;
  const hasLegendGroups = Array.isArray(compareData.groups) && compareData.groups.length > 0;
  const scoreRange = compareData.baseData && Array.isArray(compareData.baseData.scoreRange)
    ? compareData.baseData.scoreRange
    : Array.from({ length: compareData.maxScore || 0 }, (_, i) => i + 1);

  let rowHtml;
  let chartInnerHtml;
  if (hasGroups) {
    if (isDualBar) {
      rowHtml = compareData.questions.map((question, questionIndex) => {
        const item = question.data;
        if (!item) return '';
        const tracksHtml = visibleGroups.map(group => {
          const point = group.points[questionIndex];
          if (!point || point.n <= 0) return '';
          const leftPct = getScaleMeanLeftPct(point.mean, compareData.maxScore);
          if (leftPct === null) return '';
          const tip = encodeURIComponent(JSON.stringify({
            kind: 'scale-compare-group-dot',
            groupLabel: group.label,
            questionLabel: point.questionLabel,
            mean: point.mean,
            totalN: point.n
          }));
          return `
            <div class="scale-compare-lollipop-track">
              <div class="scale-compare-lollipop-line" style="width:${leftPct}%;background:${group.color};"></div>
              <div class="scale-compare-lollipop-dot" style="left:${leftPct}%;background:${group.color};" data-tip="${tip}"></div>
              <div class="lollipop-h-value" style="left:calc(${leftPct}% + 17px);">${formatScaleCompareMean(point.mean)}</div>
            </div>
          `;
        }).join('');
        return `
          <div class="lane-group-row lane-group-mean scale-compare-dual-row">
            ${buildScaleCompareQuestionLabelHtml(question)}
            <div class="lane-group-cell">
              <div class="scale-compare-dual-tracks">${tracksHtml}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      rowHtml = compareData.questions.map((question, questionIndex) => {
        const item = question.data;
        if (!item) return '';
        const hideMidpoint = isScaleMidpointHidden(TARGET_SCALE_COMPARE_VIEW_KEY);
        const baseChartHtml = item.isDerivedScale
          ? buildDerivedScaleBoxPlotHtml(item, 'mean', { hideAxis: true, hideMeanMarker: true })
          : buildScaleMeanOnlyHtml(
              question.mean,
              compareData.maxScore,
              { kind: 'scale-mean', questionLabel: question.label, groupLabel: '응답자 전체', mean: question.mean, totalN: item.totalN },
              item.scoreResults,
              { hideMidpoint, hideMeanMarker: true }
            );
        const overallDotHtml = buildScaleCompareOverallGroupedMeanDotHtml(question, compareData.maxScore);
        const groupDotHtml = visibleGroups
          .map(group => buildScaleCompareGroupedMeanDotHtml(group, group.points[questionIndex], compareData.maxScore))
          .join('');
        return `
          <div class="lane-group-row lane-group-mean">
            ${buildScaleCompareQuestionLabelHtml(question)}
            <div class="lane-group-cell">
              <div class="scale-compare-group-row-chart">
                ${baseChartHtml}
                ${overallDotHtml}
                ${groupDotHtml}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
    if (isDualBar) {
      const safeMaxScore = Number.isFinite(Number(compareData.maxScore)) && compareData.maxScore >= 1 ? Math.round(Number(compareData.maxScore)) : 5;
      const axisTicks = Array.from({ length: safeMaxScore }, (_, i) => i + 1);
      const pctFor = score => safeMaxScore <= 1 ? 0 : ((score - 1) / (safeMaxScore - 1)) * 100;
      const axisTicksHtml = axisTicks.map(score => {
        const leftPct = pctFor(score);
        const cls = score === 1 ? 'is-start' : score === safeMaxScore ? 'is-end' : 'is-mid';
        return `<span class="horizontal-chart-axis-label ${cls}" style="left:${leftPct}%;">${score}</span>`;
      }).join('');
      const numQ = compareData.questions.filter(q => q.data).length;
      const numG = visibleGroups.length;
      const rowH = numG * 32 + (numG - 1) * 4;
      const overlayH = numQ * rowH + Math.max(0, numQ - 1) * 16;
      const guideLinesHtml = axisTicks.map(score => {
        return `<span class="horizontal-chart-guide" style="left:${pctFor(score)}%;"></span>`;
      }).join('');
      chartInnerHtml = `
        <div class="scale-compare-lollipop-chart">
          <div class="scale-compare-lollipop-guides" style="height:${overlayH}px;" aria-hidden="true">${guideLinesHtml}</div>
          <div class="lane-group-chart">${rowHtml}</div>
          ${numQ > 0 ? `
            <div class="scale-compare-lollipop-axis-row" aria-hidden="true">
              <div class="horizontal-chart-axis-spacer"></div>
              <div class="horizontal-chart-axis">${axisTicksHtml}</div>
            </div>
          ` : ''}
        </div>
      `;
    } else {
      const axisRowHtml = compareData.questions.length > 0 ? `
        <div class="lane-group-row">
          <div class="lane-group-label" aria-hidden="true"></div>
          <div class="lane-group-cell">${buildScaleBottomAxisHtml(compareData.maxScore)}</div>
        </div>
      ` : '';
      chartInnerHtml = `<div class="lane-group-chart">${rowHtml}${axisRowHtml}</div>`;
    }
  } else {
    rowHtml = compareData.questions.map(question => {
      const item = question.data;
      if (!item) return '';
      const hideMidpoint = isScaleMidpointHidden(TARGET_SCALE_COMPARE_VIEW_KEY);
      const chartHtml = item.isDerivedScale
        ? buildDerivedScaleBoxPlotHtml(item, 'mean', { hideAxis: true })
        : buildScaleMeanOnlyHtml(
            question.mean,
            compareData.maxScore,
            { kind: 'scale-mean', mean: question.mean, totalN: item.totalN },
            item.scoreResults,
            { hideMidpoint }
          );
      return `
        <div class="lane-group-row lane-group-mean">
          ${buildScaleCompareQuestionLabelHtml(question)}
          <div class="lane-group-cell">${chartHtml}</div>
        </div>
      `;
    }).join('');
    const axisRowHtml = compareData.questions.length > 0 ? `
      <div class="lane-group-row">
        <div class="lane-group-label" aria-hidden="true"></div>
        <div class="lane-group-cell">${buildScaleBottomAxisHtml(compareData.maxScore)}</div>
      </div>
    ` : '';
    chartInnerHtml = `<div class="lane-group-chart">${rowHtml}${axisRowHtml}</div>`;
  }

  const chartHtml = `
    <div class="scale-compare-chart ${hasGroups ? 'is-group group-compare' : ''}" data-scale-compare-chart="true" data-max-score="${compareData.maxScore}">
      ${chartInnerHtml}
    </div>
  `;
  const visualClass = getResultVisualClass(hasLegendGroups);
  const legendHtml = hasLegendGroups
    ? buildScaleCompareLegendHtml(compareData.groups, hiddenGroups, compareData.targetLabel, compareData.criterionLabel || '', { showDualBar, isDualBar })
    : buildScaleScoreOnlyLegendHtml(scoreRange);
  return `
    <div class="scale-compare-section">
      ${showHeader ? `<div class="scale-compare-header">
        <div class="scale-compare-title">다중 문항 비교</div>
        <div class="scale-compare-sub">
          ${hasGroups ? '연한 회색 점은 전체 평균이고, 색상 점은 각 그룹의 평균입니다.' : '선택한 문항들의 평균값을 한 화면에서 비교합니다.'}
        </div>
      </div>` : ''}
      <div class="${visualClass}">
        <div class="result-chart-col">${chartHtml}</div>
        ${legendHtml}
      </div>
    </div>
  `;
}


/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleGroupLegendHtml(data, hiddenGroups, viewMode) {
  const showScoreColors = !data.isDerivedScale;
  const scoreItemsHtml = showScoreColors ? buildScaleLegendItemsHtml(data) : '';

  const groupItems = buildGroupedLegendRowsHtml(data, hiddenGroups);
  if (!groupItems) {
    return scoreItemsHtml
      ? `<aside class="legend-panel">${scoreItemsHtml}</aside>`
      : '<aside class="legend-panel is-placeholder" aria-hidden="true"></aside>';
  }

  const criterionLabel = data.criterionLabel || '';

  return `
    <aside class="legend-panel">
      ${showScoreColors ? scoreItemsHtml + '<div class="lane-group-legend-divider scale-group-section"></div>' : ''}
      <div class="legend scale-group-section" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">${groupItems}</div>
      <div class="legend-actions scale-group-section" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">
        <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
        <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
        ${criterionLabel ? `<button type="button" class="legend-action-btn" data-open-group-config="true" data-target="${escapeHtml(data.targetLabel)}" data-criterion="${escapeHtml(criterionLabel)}">그룹 편집</button>` : ''}
      </div>
    </aside>
  `;
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericOpenControlsHtml(targetLabel, interval, start, disabled = false, viewMode = 'histogram') {
  const safeMode = viewMode === 'box' ? 'box' : 'histogram';
  const inputDisabled = disabled || safeMode === 'box';
  const disabledAttr = inputDisabled ? ' disabled' : '';
  const noteText = disabled
    ? '그룹별 비교에서는 전체 기준 축을 유지하기 위해 구간 시작값과 간격을 조정할 수 없습니다.'
    : safeMode === 'box'
      ? '박스플롯 차트 보는 법: 수염은 응답값의 전체 범위, 박스는 전체 응답 중 가운데 50%가 모인 구간, 박스 중앙 마커(Q2)는 중앙값입니다.'
      : '구간 시작값과 간격을 조정해서 차트를 조정해보세요. 참고로 각 구간은 시작값 \'이상\' 다음 경계값 \'미만\'을 의미하며, 마지막 구간은 최댓값을 포함합니다.';
  return `
    <div class="viz-controls">
      <div class="viz-control-toggle" role="group" aria-label="주관식 숫자 차트 유형">
        <button type="button"
                class="viz-control-toggle__btn ${safeMode === 'box' ? 'active' : ''}"
                data-numeric-view="box"
                data-target="${escapeHtml(targetLabel)}">요약 보기</button>
        <button type="button"
                class="viz-control-toggle__btn ${safeMode === 'histogram' ? 'active' : ''}"
                data-numeric-view="histogram"
                data-target="${escapeHtml(targetLabel)}"
                ${disabled ? `disabled title="${escapeHtml('그룹별 비교에서는 분포 보기를 사용할 수 없습니다. 그룹별 비교는 요약 보기로 표시합니다.')}"` : ''}>분포 보기</button>
      </div>
      <div class="viz-controls-group">
        <label class="viz-control-number">
          <span>구간 시작값</span>
          <input type="number"
                 step="1"
                 class="viz-control-number__input"
                 data-numeric-start="true"
                 data-target="${escapeHtml(targetLabel)}"
                 value="${normalizeNumericHistogramStart(start)}"${disabledAttr}>
        </label>
        <label class="viz-control-number">
          <span>구간 간격</span>
          <input type="number"
                 min="1"
                 step="1"
                 class="viz-control-number__input"
                 data-numeric-interval="true"
                 data-target="${escapeHtml(targetLabel)}"
                 value="${clampNumericHistogramStep(interval)}"${disabledAttr}>
        </label>
      </div>
      ${noteText ? `<div class="viz-controls-note">${noteText}</div>` : ''}
    </div>
  `;
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericWhiskerTrackHtml(item, axisMin, axisMax, numberUnit = '', groupLabel = '', options = {}) {
  const fmtValue = typeof options.valueFormatter === 'function'
    ? options.valueFormatter
    : (v, digits = 2) => formatNumericValue(v, digits);
  const tipExtra = options.fixedDecimals
    ? { fixedDecimals: true, decimalDigits: options.meanDecimals ?? 2 }
    : {};
  const minLeft   = getNumericValueLeftPct(item.min,    axisMin, axisMax) ?? 0;
  const q1Left    = getNumericValueLeftPct(item.q1,     axisMin, axisMax) ?? 0;
  const medLeft   = getNumericValueLeftPct(item.median, axisMin, axisMax) ?? 0;
  const q3Left    = getNumericValueLeftPct(item.q3,     axisMin, axisMax) ?? 0;
  const maxLeft   = getNumericValueLeftPct(item.max,    axisMin, axisMax) ?? 100;
  const meanLeft  = getNumericValueLeftPct(item.mean,   axisMin, axisMax) ?? 0;
  const deadLeftFlex    = Math.max(0, minLeft);
  const leftWhiskerFlex = Math.max(0, q1Left - minLeft);
  const q1q2Flex        = Math.max(0, medLeft - q1Left);
  const q2q3Flex        = Math.max(0, q3Left - medLeft);
  const rightWhiskerFlex = Math.max(0, maxLeft - q3Left);
  const deadRightFlex   = Math.max(0, 100 - maxLeft);
  const meanTip = encodeURIComponent(JSON.stringify({
    kind: 'numeric-mean', groupLabel, mean: item.mean, totalN: item.n, unit: numberUnit,
    valueFormat: options.valueFormat || '',
    ...tipExtra
  }));
  const minTip = encodeURIComponent(JSON.stringify({ kind: 'numeric-boxplot-stat', groupLabel, label: '최솟값',       value: item.min,    unit: numberUnit, valueFormat: options.valueFormat || '', ...tipExtra }));
  const q1Tip  = encodeURIComponent(JSON.stringify({ kind: 'numeric-boxplot-stat', groupLabel, label: 'Q1(하위 25%)', value: item.q1,     unit: numberUnit, valueFormat: options.valueFormat || '', ...tipExtra }));
  const q2Tip  = encodeURIComponent(JSON.stringify({ kind: 'numeric-boxplot-stat', groupLabel, label: 'Q2(중앙값)',   value: item.median, unit: numberUnit, valueFormat: options.valueFormat || '', ...tipExtra }));
  const q3Tip  = encodeURIComponent(JSON.stringify({ kind: 'numeric-boxplot-stat', groupLabel, label: 'Q3(상위 25%)', value: item.q3,     unit: numberUnit, valueFormat: options.valueFormat || '', ...tipExtra }));
  const maxTip = encodeURIComponent(JSON.stringify({ kind: 'numeric-boxplot-stat', groupLabel, label: '최댓값',       value: item.max,    unit: numberUnit, valueFormat: options.valueFormat || '', ...tipExtra }));
  const meanFmt = (options.valueFormat === 'time-clock' || options.valueFormat === 'time-duration') ? formatMinutesAsHHMM : (v) => fmtValue(v, options.meanDecimals ?? 1);
  const meanLabel = Number.isFinite(Number(item.mean)) ? meanFmt(item.mean) : '-';
  const qDigits = options.quartileDecimals ?? 1;
  const fmtQ = v => Number.isFinite(Number(v)) ? fmtValue(v, qDigits) : '-';
  const meanStyle = options.mutedMeanMarker
    ? `left:${meanLeft}%;background:var(--neutral-300);color:transparent;`
    : `left:${meanLeft}%;`;
  return `
    <div class="box-plot-track-wrap">
      <div class="box-plot-q-tick" style="left:${q1Left}%;" data-tip="${q1Tip}"></div>
      <div class="box-plot-q-tick" style="left:${medLeft}%;" data-tip="${q2Tip}"></div>
      <div class="box-plot-q-tick" style="left:${q3Left}%;" data-tip="${q3Tip}"></div>
      <div class="box-plot-box-row">
        <div class="box-plot-dead-seg"    style="flex:${deadLeftFlex};"></div>
        <div class="box-plot-whisker-seg" style="flex:${leftWhiskerFlex};"></div>
        <div class="box-plot-box is-left"  style="flex:${q1q2Flex};  background:${options.color || 'var(--neutral-400)'};"></div>
        <div class="box-plot-box is-right" style="flex:${q2q3Flex};  background:${options.color || 'var(--neutral-400)'};"></div>
        <div class="box-plot-whisker-seg" style="flex:${rightWhiskerFlex};"></div>
        <div class="box-plot-dead-seg"    style="flex:${deadRightFlex};"></div>
        <div class="box-plot-end-tick" style="left:${minLeft}%;" data-tip="${minTip}"></div>
        <div class="box-plot-end-tick" style="left:${maxLeft}%;" data-tip="${maxTip}"></div>
        ${options.hideMeanMarker ? '' : `
        <div class="box-plot-mean" style="${meanStyle}" data-tip="${meanTip}">
          <div class="box-plot-mean-label">평균</div>
          ${options.mutedMeanMarker ? '' : escapeHtml(meanLabel)}
        </div>
        `}
      </div>
      <div class="box-plot-q-label-layer">
        <div class="box-plot-q-item" style="left:${q1Left}%;"  data-q="Q1" data-tip="${q1Tip}">
          <div class="box-plot-q-name">Q1</div>
          <div class="box-plot-q-val">${fmtQ(item.q1)}</div>
        </div>
        <div class="box-plot-q-item" style="left:${medLeft}%;" data-q="Q2" data-tip="${q2Tip}">
          <div class="box-plot-q-name">Q2</div>
          <div class="box-plot-q-val">${fmtQ(item.median)}</div>
        </div>
        <div class="box-plot-q-item" style="left:${q3Left}%;"  data-q="Q3" data-tip="${q3Tip}">
          <div class="box-plot-q-name">Q3</div>
          <div class="box-plot-q-val">${fmtQ(item.q3)}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 차트·표·컨트롤 등 화면용 HTML 조각을 생성합니다.
 */
function buildIntegerBoxAxisHtml(domainMin, domainMax) {
  const n = domainMax - domainMin + 1;
  if (n <= 0) return '';
  const ticks = Array.from({ length: n }, (_, i) => domainMin + i);
  return ticks.map((v, i) => {
    const leftPct = ((v - domainMin) / (domainMax - domainMin)) * 100;
    const edgeClass = i === 0 ? ' is-start' : i === ticks.length - 1 ? ' is-end' : '';
    return `<div class="chart-bottom-axis-tick${edgeClass}" style="left:${leftPct}%;"></div><span class="chart-bottom-axis-label${edgeClass}" style="left:${leftPct}%;">${v}</span>`;
  }).join('');
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericBoxAxisHtml(domainMin, domainMax, fmtValue = (v, digits = 2) => formatNumericValue(v, digits)) {
  const range = domainMax - domainMin;
  if (!Number.isFinite(range) || range <= 0) {
    const label = Number.isFinite(domainMin)
      ? fmtValue(domainMin, Number.isInteger(domainMin) ? 0 : 1)
      : '-';
    return `<div class="chart-bottom-axis-tick is-start" style="left:0%;"></div><span class="chart-bottom-axis-label is-start" style="left:0%;">${label}</span>`;
  }
  const rawInterval = range / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;
  const niceInterval = normalized < 1.5 ? magnitude
                     : normalized < 3   ? 2 * magnitude
                     : normalized < 7   ? 5 * magnitude
                     : 10 * magnitude;
  const tickStart = Math.ceil(domainMin / niceInterval) * niceInterval;
  const tickEnd   = Math.floor(domainMax / niceInterval) * niceInterval;
  const ticks = [];
  if (Math.abs(tickStart - domainMin) > niceInterval * 0.01) ticks.push(domainMin);
  for (let v = tickStart; v <= tickEnd + niceInterval * 1e-6; v += niceInterval) {
    ticks.push(Math.round(v / niceInterval) * niceInterval);
  }
  if (ticks.length === 0 || Math.abs(ticks[ticks.length - 1] - domainMax) > niceInterval * 0.01) ticks.push(domainMax);
  const n = ticks.length;
  const fmt = v => {
    if (!Number.isFinite(v)) return '-';
    return fmtValue(v, Number.isInteger(v) ? 0 : 1);
  };
  return ticks.map((v, i) => {
    const leftPct = ((v - domainMin) / (domainMax - domainMin)) * 100;
    const edgeClass = i === 0 ? ' is-start' : i === n - 1 ? ' is-end' : '';
    return `<div class="chart-bottom-axis-tick${edgeClass}" style="left:${leftPct}%;"></div><span class="chart-bottom-axis-label${edgeClass}" style="left:${leftPct}%;">${fmt(v)}</span>`;
  }).join('');
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleBottomAxisHtml(maxScore) {
  const safeMaxScore = Number.isFinite(Number(maxScore)) && Number(maxScore) >= 1 ? Math.round(Number(maxScore)) : 5;
  return `<div class="chart-bottom-axis">${buildIntegerBoxAxisHtml(1, safeMaxScore)}</div>`;
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericBoundaryAxisLabelsHtml(bins, domainMax, className, fmtValue = (v, digits = 2) => formatNumericValue(v, digits)) {
  const safeBins = Array.isArray(bins) ? bins : [];
  const boundaryValues = safeBins.map(bin => bin.start).concat([domainMax]);
  return boundaryValues.map((value, index) => {
    const left = safeBins.length === 0 ? 0 : (index / safeBins.length) * 100;
    const edgeClass = index === 0
      ? ' is-start'
      : index === boundaryValues.length - 1
        ? ' is-end'
        : '';
    return `<span class="${className}${edgeClass}" style="left:${left}%;">${fmtValue(value)}</span>`;
  }).join('');
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericHistogramChartHtml(histogram, options = {}) {
  const {
    groupLabel = '',
    numberUnit = '',
    valueFormatter = null,
    valueFormat = ''
  } = options;
  const fmtValue = typeof valueFormatter === 'function'
    ? valueFormatter
    : (v, digits = 2) => formatNumericValue(v, digits);
  const hasValues = Array.isArray(histogram.bins) && histogram.bins.length > 0 && histogram.n > 0;
  if (!hasValues) {
    return '<div class="result-empty">표시할 수치 응답이 없습니다.</div>';
  }
  // Y축: 응답 비율(%) 기준 — single-vbar와 동일한 방식
  const maxBinPct = histogram.bins.reduce((m, b) => Math.max(m, b.pct || 0), 0);
  const axisMax = Math.max(20, Math.ceil(maxBinPct / 20) * 20);
  const guideMarks = [];
  for (let mark = 20; mark <= axisMax; mark += 20) guideMarks.push(mark);
  const guidesHtml = guideMarks.map(mark => `
    <div class="vertical-chart-guide" style="bottom:${(mark / axisMax) * 100}%;">
      <span class="vertical-chart-guide-line"></span>
      <span class="vertical-chart-guide-label">${mark}%</span>
    </div>
  `).join('');

  const binWidth = 100 / histogram.bins.length;
  const gap = Math.min(0.18, binWidth * 0.06);
  const barWidth = Math.max(0.2, binWidth - gap);
  const barsHtml = histogram.bins.map((bin, index) => {
    const heightPct = axisMax > 0 ? Math.max(0, Math.min(100, (bin.pct / axisMax) * 100)) : 0;
    const visibleHeight = bin.count > 0 ? Math.max(1.2, heightPct) : 0.6;
    const x = (index * binWidth) + (gap / 2);
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'numeric-hist-bin',
      groupLabel,
      rangeLabel: bin.start === bin.end
        ? `${fmtValue(bin.start)}`
        : `${fmtValue(bin.start)} - ${fmtValue(bin.end)}`,
      pct: bin.pct,
      count: bin.count,
      valueFormat
    }));
    const valueLabel = bin.count > 0
      ? `<span class="numeric-hist-bar-value">${formatPercent(bin.pct)}</span>`
      : '';
    return `
      <div class="numeric-hist-bar ${bin.count > 0 ? '' : 'is-empty'}"
           style="left:${x.toFixed(3)}%; width:${barWidth.toFixed(3)}%; height:${visibleHeight.toFixed(3)}%; background:${SINGLE_BAR_COLOR};"
           data-tip="${tip}"
           aria-label="구간 ${index + 1}">${valueLabel}</div>
    `;
  }).join('');

  const axisLabelsHtml = buildNumericBoundaryAxisLabelsHtml(histogram.bins, histogram.domainMax, 'numeric-hist-axis-label', fmtValue);

  const meanTip = encodeURIComponent(JSON.stringify({
    kind: 'numeric-mean',
    groupLabel,
    mean: histogram.mean,
    totalN: histogram.n,
    unit: numberUnit,
    valueFormat
  }));
  return `
    <div class="vertical-chart numeric-hist-chart">
      <div class="vertical-chart-plot">
        <div class="vertical-chart-guides" aria-hidden="true">${guidesHtml}</div>
        <div class="numeric-hist-bars">${barsHtml}</div>
        <div class="numeric-hist-mean-layer">
          ${histogram.meanLeftPct === null ? '' : `
          <div class="numeric-hist-mean-marker" style="left:${histogram.meanLeftPct}%;">
            <div class="numeric-hist-mean-line"></div>
            <div class="numeric-hist-mean-label" data-tip="${meanTip}">평균<span class="numeric-hist-marker-value">${fmtValue(histogram.mean, 1)}</span></div>
          </div>
          `}
        </div>
      </div>
      <div class="numeric-hist-boundary-axis">${axisLabelsHtml}</div>
      ${numberUnit ? `<div class="numeric-open-unit">단위 : ${escapeHtml(numberUnit)}</div>` : ''}
    </div>
  `;
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericOpenBoxChartHtml(data) {
  const isTimeMinutes = isTimeMinutesEntry(data.codebookEntry);
  const timeFormat = isTimeMinutes ? getTimeMinutesFormat(data.codebookEntry) : '';
  const fmtValue = getNumericOpenValueFormatter(data.codebookEntry);
  const numberUnit = isTimeMinutes ? '' : (data.codebookEntry && data.codebookEntry.numberUnit ? data.codebookEntry.numberUnit : '');
  return `
    <div class="box-plot-chart">
      <div class="box-plot-body">
        <div class="numeric-open-summary-whisker">
          <div class="numeric-open-summary-body">
            ${buildNumericWhiskerTrackHtml(data, data.domainMin, data.domainMax, numberUnit, '응답자 전체', { valueFormatter: fmtValue, valueFormat: timeFormat ? 'time-' + timeFormat : '' })}
            <div class="chart-bottom-axis">${buildNumericBoxAxisHtml(data.domainMin, data.domainMax, fmtValue)}</div>
          </div>
          ${numberUnit ? `<div class="numeric-open-unit">단위 : ${escapeHtml(numberUnit)}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareGroupedMeanDotHtml(group, point, maxScore) {
  if (!point || point.n <= 0) return '';
  const left = getScaleMeanLeftPct(point.mean, maxScore);
  if (left === null) return '';
  const tip = encodeURIComponent(JSON.stringify({
    kind: 'scale-compare-group-dot',
    groupLabel: group.label,
    questionLabel: point.questionLabel,
    mean: point.mean,
    totalN: point.n
  }));
  const labelSide = left > 72 ? 'left' : 'right';
  return `
    <div class="group-dot-wrap"
         style="left:${left}%;"
         data-tip="${tip}"
         data-group-key="${escapeHtml(String(group.value))}"
         data-label-side="${labelSide}">
      <div class="group-dot" style="background:${group.color};"></div>
      <span class="group-dot-label">${formatScaleCompareMean(point.mean)}</span>
    </div>
  `;
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildScaleCompareOverallGroupedMeanDotHtml(question, maxScore) {
  const left = getScaleMeanLeftPct(question.mean, maxScore);
  if (left === null) return '';
  const tip = encodeURIComponent(JSON.stringify({
    kind: 'scale-mean',
    questionLabel: question.label,
    groupLabel: '응답자 전체',
    mean: question.mean,
    totalN: question.totalN
  }));
  const labelSide = left > 72 ? 'left' : 'right';
  return `
    <div class="group-dot-wrap"
         style="left:${left}%;"
         data-tip="${tip}"
         data-group-key="__overall__"
         data-label-side="${labelSide}">
      <div class="group-dot" style="background:var(--neutral-700);"></div>
      <span class="group-dot-label">${formatScaleCompareMean(question.mean)}</span>
    </div>
  `;
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericOpenGroupChartHtml(data, hiddenGroups) {
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  if (displayGroups.length === 0) {
    return '<div class="result-empty">표시할 그룹이 없습니다.</div>';
  }
  const isTimeMinutes = isTimeMinutesEntry(data.codebookEntry);
  const timeFormat = isTimeMinutes ? getTimeMinutesFormat(data.codebookEntry) : '';
  const vf = timeFormat ? 'time-' + timeFormat : '';
  const fmtValue = getNumericOpenValueFormatter(data.codebookEntry);
  const numberUnit = isTimeMinutes ? '' : (data.codebookEntry && data.codebookEntry.numberUnit ? data.codebookEntry.numberUnit : '');
  const criterionLabel = data.criterionLabel || '';
  const groupRowsHtml = displayGroups.map(group => {
    const groupLabel = group.label || (criterionLabel ? `${criterionLabel}: ${group.value}` : group.value);
    const color = getGroupColor(data.groupResults, group.value);
    const trackHtml = buildNumericWhiskerTrackHtml(
      group,
      data.domainMin,
      data.domainMax,
      numberUnit,
      groupLabel,
      { color, valueFormatter: fmtValue, valueFormat: vf }
    );
    return `
      <div class="lane-group-row">
        <div class="lane-group-label">${escapeHtml(groupLabel)}</div>
        <div class="lane-group-cell">${trackHtml}</div>
      </div>
    `;
  }).join('');
  const overallTrackHtml = buildNumericWhiskerTrackHtml(
    data,
    data.domainMin,
    data.domainMax,
    numberUnit,
    '응답자 전체',
    { valueFormatter: fmtValue, valueFormat: vf }
  );
  const overallRowHtml = `
    <div class="lane-group-row">
      <div class="lane-group-label">응답자 전체</div>
      <div class="lane-group-cell">${overallTrackHtml}</div>
    </div>
    <div class="lane-group-divider"></div>
  `;
  return `
    <div class="lane-group-chart">
      ${overallRowHtml}${groupRowsHtml}
      <div class="lane-group-row">
        <div class="lane-group-label" aria-hidden="true"></div>
        <div class="lane-group-cell">
          <div class="chart-bottom-axis">${buildNumericBoxAxisHtml(data.domainMin, data.domainMax, fmtValue)}</div>
        </div>
      </div>
    </div>
    ${numberUnit ? `<div class="numeric-open-unit">단위 : ${escapeHtml(numberUnit)}</div>` : ''}
  `;
}

/**
 * 서술형 문항 응답 텍스트를 수집·요약합니다.
 */
function aggregateTextOpen(targetLabel, rowIndexes = []) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const effectiveIndexes = Array.isArray(rowIndexes) && rowIndexes.length > 0
    ? rowIndexes
    : getFilteredRowIndexes();
  if (effectiveIndexes.length === 0) return null;
  const tIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;
  if (tIdx === undefined) return null;
  const activeRows = getRowsByIndexes(filterState.rows || [], effectiveIndexes);
  const responses = [];
  activeRows.forEach(row => {
    const val = cleanCell((row || [])[tIdx]);
    if (val) responses.push(val);
  });
  return {
    targetLabel,
    codebookEntry: entry,
    totalN: activeRows.length,
    responses,
    visualType: 'text-open'
  };
}

/**
 * 결과 패널에서 문항별 섹션(차트+표) HTML을 생성합니다.
 */
function buildTextOpenSection(data) {
  if (!data) return '';
  const { codebookEntry, targetLabel, responses, totalN } = data;
  const fullText = buildQuestionFullHtml(codebookEntry);
  const safeTarget = escapeHtml(targetLabel);
  const searchIcon = 'assets/icons/search_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg';
  const itemsHtml = responses.map(r => `<div class="open-text-item" data-text="${escapeHtml(r.toLowerCase())}">${escapeHtml(r)}</div>`).join('');
  const controlsHtml = `
    <div class="viz-controls">
      <div class="viz-controls-element">
        <span class="viz-controls-label">키워드 검색</span>
        <label class="viz-control-search" for="viz-control-search-${safeTarget}">
          <input class="viz-control-search__input" id="viz-control-search-${safeTarget}" type="text" placeholder="단어를 입력해보세요" data-viz-control-search data-target="${safeTarget}">
          <img class="viz-control-search__icon" src="${searchIcon}" alt="" aria-hidden="true">
        </label>
      </div>
    </div>
  `;
  const chartHtml = `
    <div class="open-text-box">
      <div class="open-text-header">응답 ${responses.length}건 / 전체 ${totalN}명</div>
      <div class="open-text-responses" data-text-open-responses data-target="${safeTarget}">${itemsHtml}</div>
    </div>
  `;
  return `
    <section class="result-section" data-target="${safeTarget}" data-type="text-open">
      ${buildResultHeaderHtml(`<div class="result-question-label">${escapeHtml(targetLabel)}</div>`, fullText, controlsHtml)}
      <div class="result-visual">
        <div class="result-chart-col">${chartHtml}</div>
      </div>
    </section>
  `;
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericOpenSection(data) {
  if (!data) return '';
  const { codebookEntry, targetLabel, groupResults } = data;
  const customGroupOn = shouldApplyCustomGroup(data);
  const customGroupData = (customGroupOn && groupResults) ? buildCustomGroupData(data) : null;
  const baseData = customGroupData || data;
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const showTable = true;
  const viewMode = groupResults ? 'box' : (resultState.numericOpenViewModes.get(targetLabel) || 'box');
  const isTimeMinutes = isTimeMinutesEntry(codebookEntry);
  const timeFormat = isTimeMinutes ? getTimeMinutesFormat(codebookEntry) : '';
  const fmtValue = getNumericOpenValueFormatter(codebookEntry);
  const numberUnit = isTimeMinutes ? '' : (codebookEntry && codebookEntry.numberUnit ? codebookEntry.numberUnit : '');
  const valueFormat = timeFormat ? 'time-' + timeFormat : '';
  const chartHtml = groupResults
    ? buildNumericOpenGroupChartHtml(baseData, hiddenGroups)
    : viewMode === 'box'
      ? buildNumericOpenBoxChartHtml(baseData)
      : buildNumericHistogramChartHtml(baseData, {
          maxBinCount: baseData.maxBinCount,
          numberUnit,
          valueFormatter: fmtValue,
          valueFormat
        });
  const tableHtml = showTable ? buildDataTableHtml(baseData, hiddenGroups) : '';
  const fullText = buildQuestionFullHtml(codebookEntry);
  const controlsHtml = groupResults
    ? `<div class="viz-controls"><div class="viz-controls-note">박스플롯 차트 보는 법: 수염은 응답값의 전체 범위, 박스는 전체 응답 중 가운데 50%가 모인 구간, 박스 중앙 마커(Q2)는 중앙값입니다.</div></div>`
    : buildNumericOpenControlsHtml(targetLabel, data.interval, data.start, false, viewMode);
  const legendHtml = groupResults ? buildLegendHtml(baseData, hiddenGroups) : '';
  const sidePanelHtml = buildResultSidePanelHtml(legendHtml, targetLabel);
  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="numeric-open">
      ${buildResultHeaderHtml(`<div class="result-question-label">${escapeHtml(targetLabel)}</div>`, fullText, controlsHtml)}
      <div class="result-visual has-legend">
        <div class="result-chart-col">${chartHtml}</div>
        ${sidePanelHtml}
      </div>
      ${tableHtml}
    </section>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleGroupRowHtml(group, maxScore, viewMode, hideMidpoint) {
  const meanTip = {
    kind: 'scale-mean',
    mean: group.mean,
    totalN: group.n,
    groupLabel: group.label
  };
  const isMean = viewMode === 'mean';
  const chartHtml = isMean
    ? buildScaleMeanOnlyHtml(group.mean, maxScore, meanTip, group.scoreResults, { hideMidpoint })
    : buildScaleDistributionBarHtml(group.scoreResults, maxScore, { hideMidpoint, hideSummary: true, groupLabel: group.label });
  return `
    <div class="lane-group-row${isMean ? ' lane-group-mean' : ''}">
      <div class="lane-group-label">${escapeHtml(group.label)}</div>
      <div class="lane-group-cell">
        ${chartHtml}
      </div>
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildDerivedScaleGroupRowHtml(group, scoreRange, viewMode) {
  const chartData = {
    values: group.values || [],
    totalN: group.n,
    n: group.n,
    mean: group.mean,
    min: group.min,
    q1: group.q1,
    median: group.median,
    q3: group.q3,
    max: group.max,
    scoreRange,
    groupLabel: group.label,
    color: group.color
  };
  return `
    <div class="lane-group-row${viewMode === 'mean' ? ' lane-group-mean' : ''}">
      <div class="lane-group-label">${escapeHtml(group.label)}</div>
      <div class="lane-group-cell">
        ${buildDerivedScaleBoxPlotHtml(chartData, viewMode, { hideAxis: true })}
      </div>
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleGroupChartHtml(data, hiddenGroups, viewMode) {
  const rawDisplayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const displayGroups = isScaleGroupSortedByMean(data.targetLabel) ? sortGroupsByMean(rawDisplayGroups) : rawDisplayGroups;
  const maxScore = data.scoreRange.length;
  const hideMidpoint = isScaleMidpointHidden(data.targetLabel);
  if (data.isDerivedScale) {
    const axisMin = 1;
    const axisMax = data.scoreRange.length;
    const overallGroup = { label: '응답자 전체', values: data.values || [], n: data.totalN, mean: data.mean, min: data.min, q1: data.q1, median: data.median, q3: data.q3, max: data.max };
    const overallRowHtml = `
      ${buildDerivedScaleGroupRowHtml(overallGroup, data.scoreRange, viewMode)}
      <div class="lane-group-divider"></div>
    `;
    return `
      <div class="lane-group-chart">
        ${displayGroups.length === 0 ? '<div class="result-empty">표시할 그룹이 없습니다.</div>' : overallRowHtml + displayGroups.map(group => buildDerivedScaleGroupRowHtml({ ...group, color: getGroupColor(data.groupResults, group.value) }, data.scoreRange, viewMode)).join('')}
        ${displayGroups.length > 0 ? `
          <div class="lane-group-row">
            <div class="lane-group-label" aria-hidden="true"></div>
            <div class="lane-group-cell">
              <div class="chart-bottom-axis">${buildIntegerBoxAxisHtml(axisMin, axisMax)}</div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
  const overallGroup = { label: '응답자 전체', mean: data.mean, scoreResults: data.scoreResults, n: data.totalN };
  const overallRowHtml = `
    ${buildScaleGroupRowHtml(overallGroup, maxScore, viewMode, hideMidpoint)}
    <div class="lane-group-divider"></div>
  `;
  return `
    <div class="lane-group-chart">
      ${displayGroups.length === 0 ? '<div class="result-empty">표시할 그룹이 없습니다.</div>' : overallRowHtml + displayGroups.map(group => buildScaleGroupRowHtml(group, maxScore, viewMode, hideMidpoint)).join('')}
      ${displayGroups.length > 0 && viewMode === 'mean' ? `
        <div class="lane-group-row">
          <div class="lane-group-label" aria-hidden="true"></div>
          <div class="lane-group-cell">${buildScaleBottomAxisHtml(maxScore)}</div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleChartHtml(data, hiddenGroups, viewMode, chartType = 'bar_horizontal_100') {
  const maxScore = data.scoreRange.length;
  const hideMidpoint = isScaleMidpointHidden(data.targetLabel);
  if (data.groupResults) return buildScaleGroupChartHtml(data, hiddenGroups, viewMode);
  if (data.isDerivedScale) return buildDerivedScaleBoxPlotHtml(data, viewMode);
  if (chartType === 'pie') return buildScalePieChartHtml(data);
  const meanTip = {
    kind: 'scale-mean',
    mean: data.mean,
    totalN: data.totalN
  };
  const chartHtml = viewMode === 'mean'
    ? buildScaleMeanOnlyHtml(data.mean, maxScore, meanTip, data.scoreResults, { hideMidpoint })
    : buildScaleDistributionBarHtml(data.scoreResults, maxScore, { hideMidpoint });
  return `<div class="scale-chart">${chartHtml}</div>`;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildDerivedScaleDataTableHtml(data, hiddenGroups = new Set()) {
  const labelHeader = data.groupResults ? '그룹명' : '문항명';
  const derivedDisplayGroups = data.groupResults
    ? (isScaleGroupSortedByMean(data.targetLabel) ? sortGroupsByMean(getDisplayGroupResults(data.groupResults, hiddenGroups)) : getDisplayGroupResults(data.groupResults, hiddenGroups))
    : [];
  const rows = data.groupResults
    ? [
        ...derivedDisplayGroups.map(group => ({
          label: group.label,
          n: group.n,
          mean: group.mean,
          min: group.min,
          q1: group.q1,
          median: group.median,
          q3: group.q3,
          max: group.max
        })),
        {
          label: '응답자 전체',
          isTotal: true,
          n: data.totalN,
          mean: data.mean,
          min: data.min,
          q1: data.q1,
          median: data.median,
          q3: data.q3,
          max: data.max
        }
      ]
    : [{
        label: data.targetLabel || '응답 전체',
        n: data.totalN,
        mean: data.mean,
        min: data.min,
        q1: data.q1,
        median: data.median,
        q3: data.q3,
        max: data.max
      }];
  const rowsHtml = rows.map(row => `
    <tr${row.isTotal ? ' class="total-row"' : ''}>
      <td>${escapeHtml(row.label)}</td>
      <td class="num metric">${formatFixedDecimal(row.min)}</td>
      <td class="num metric">${formatFixedDecimal(row.q1)}</td>
      <td class="num metric">${formatFixedDecimal(row.median)}</td>
      <td class="num metric">${formatFixedDecimal(row.q3)}</td>
      <td class="num metric">${formatFixedDecimal(row.max)}</td>
      <td class="num metric mean-value group-col">${formatFixedDecimal(row.mean)}점</td>
      <td class="num respondents group-col">${Number(row.n || 0).toLocaleString()}</td>
    </tr>
  `).join('');
  const tableHtml = `
    <table class="result-table derived-scale-table">
      <thead>
        <tr>
          <th>${labelHeader}</th>
          <th class="num metric">최소값</th>
          <th class="num metric">Q1(하위 25%)</th>
          <th class="num metric">Q2(중앙값)</th>
          <th class="num metric">Q3(상위 25%)</th>
          <th class="num metric">최대값</th>
          <th class="num metric group-col">평균</th>
          <th class="num respondents group-col">응답 수(명)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleDataTableHtml(data, hiddenGroups = new Set()) {
  if (data.isDerivedScale) return buildDerivedScaleDataTableHtml(data, hiddenGroups);
  if (!data.groupResults) {
    const rowsHtml = data.scoreResults.map(result => `
      <tr>
        <td>${formatScaleScoreLabel(result)}</td>
        <td class="num">${formatPercent(result.pct)}</td>
        <td class="num">${result.count.toLocaleString()}</td>
        <td class="num group-col">-</td>
      </tr>
    `).join("");
    const tableHtml = `
      <table class="result-table">
        <thead>
          <tr>
            <th>점수</th>
            <th class="num">응답 비율(%)</th>
            <th class="num">응답 수(명)</th>
            <th class="num group-col">평균</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="total-row">
            <td>합계</td>
            <td class="num">${formatPercent(100)}</td>
            <td class="num">${data.totalN.toLocaleString()}</td>
            <td class="num group-col">${formatScaleMeanDisplay(data.mean, { allowZero: true })}점</td>
          </tr>
        </tbody>
      </table>
    `;
    return wrapResultTable(tableHtml);
  }

  const rawDisplayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const displayGroups = isScaleGroupSortedByMean(data.targetLabel) ? sortGroupsByMean(rawDisplayGroups) : rawDisplayGroups;
  const topRow = [
    `<th rowspan="2">점수</th>`,
    `<th colspan="3">응답자 전체</th>`,
    ...displayGroups.map(group => buildGroupedCountHeader(group.label, group.n, 3))
  ].join("");
  const subRow = [
    `<th class="num">응답 비율(%)</th><th class="num">응답 수(명)</th><th class="num group-col">평균</th>`,
    ...displayGroups.map(() => `<th class="num group-col">응답 비율(%)</th><th class="num">응답 수(명)</th><th class="num group-col">평균</th>`)
  ].join("");
  const bodyRows = data.scoreResults.map(result => {
    const groupCells = displayGroups.map(group => {
      const groupResult = group.scoreResults.find(item => item.score === result.score) || { pct: 0, count: 0 };
      return `<td class="num group-col">${formatPercent(groupResult.pct)}</td><td class="num">${groupResult.count.toLocaleString()}</td><td class="num group-col">-</td>`;
    }).join("");
    return `
      <tr>
        <td>${formatScaleScoreLabel(result)}</td>
        <td class="num">${formatPercent(result.pct)}</td>
        <td class="num">${result.count.toLocaleString()}</td>
        <td class="num group-col">-</td>
        ${groupCells}
      </tr>
    `;
  }).join("");
  const totalCells = displayGroups.map(group => `<td class="num group-col">${formatPercent(100)}</td><td class="num">${group.n.toLocaleString()}</td><td class="num group-col">${formatScaleMeanDisplay(group.mean, { allowZero: true })}점</td>`).join("");
  const tableHtml = `
    <table class="result-table">
      <thead>
        <tr>${topRow}</tr>
        <tr>${subRow}</tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total-row">
          <td>합계</td>
          <td class="num">${formatPercent(100)}</td>
          <td class="num">${data.totalN.toLocaleString()}</td>
          <td class="num group-col">${formatScaleMeanDisplay(data.mean, { allowZero: true })}점</td>
          ${totalCells}
        </tr>
      </tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

/**
 * 숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.
 */
function buildNumericOpenDataTableHtml(data, hiddenGroups = new Set()) {
  const isTimeMinutes = isTimeMinutesEntry(data.codebookEntry);
  const timeFormat = isTimeMinutes ? getTimeMinutesFormat(data.codebookEntry) : '';
  const unit = isTimeMinutes ? '' : (data.codebookEntry && data.codebookEntry.numberUnit ? data.codebookEntry.numberUnit : "");
  const timeFmtFn = timeFormat === 'clock' ? formatMinutesAsClockTime : formatMinutesAsHourMin;
  const fmtStat = isTimeMinutes ? timeFmtFn : formatNumericValue;
  const fmtMean = isTimeMinutes ? timeFmtFn : (v) => formatNumericMeanDisplay(v, unit);
  const rows = data.groupResults
    ? [
        ...getDisplayGroupResults(data.groupResults, hiddenGroups).map(group => ({
          label: group.label,
          n: group.n,
          mean: group.mean,
          min: group.min,
          q1: group.q1,
          median: group.median,
          q3: group.q3,
          max: group.max
        })),
        {
          label: "응답자 전체",
          total: true,
          n: data.totalN,
          mean: data.mean,
          min: data.min,
          q1: data.q1,
          median: data.median,
          q3: data.q3,
          max: data.max
        }
      ]
    : [{
        label: data.targetLabel || "응답자 전체",
        n: data.totalN,
        mean: data.mean,
        min: data.min,
        q1: data.q1,
        median: data.median,
        q3: data.q3,
        max: data.max
      }];
  const labelHeader = data.groupResults ? '그룹명' : '문항명';
  const rowsHtml = rows.map(row => `
    <tr${row.total ? ' class="total-row"' : ''}>
      <td>${escapeHtml(row.label)}</td>
      <td class="num metric">${fmtStat(row.min)}</td>
      <td class="num metric">${fmtStat(row.q1)}</td>
      <td class="num metric">${fmtStat(row.median)}</td>
      <td class="num metric">${fmtStat(row.q3)}</td>
      <td class="num metric">${fmtStat(row.max)}</td>
      <td class="num metric mean-value group-col">${fmtMean(row.mean)}</td>
      <td class="num respondents group-col">${Number(row.n || 0).toLocaleString()}</td>
    </tr>
  `).join("");
  const tableHtml = `
    <table class="result-table derived-scale-table">
      <thead>
        <tr>
          <th>${labelHeader}</th>
          <th class="num metric">최소값</th>
          <th class="num metric">Q1(하위 25%)</th>
          <th class="num metric">Q2(중앙값)</th>
          <th class="num metric">Q3(상위 25%)</th>
          <th class="num metric">최대값</th>
          <th class="num metric group-col">평균</th>
          <th class="num respondents group-col">응답 수(명)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

/**
 * 결과 데이터 테이블 HTML을 생성합니다.
 */
function buildDataTableHtml(data, hiddenGroups = new Set(), noteHtml = '') {
  if (data.visualType === 'rank') return buildRankDataTableHtml(data, hiddenGroups);
  if (data.visualType === 'scale') return buildScaleDataTableHtml(data, hiddenGroups);
  if (data.visualType === 'numeric-open') return buildNumericOpenDataTableHtml(data, hiddenGroups);
  if (data.visualType === 'ratio-allocation') return buildRatioAllocationDataTableHtml(data, hiddenGroups);
  return buildChoiceDataTableHtml(data, noteHtml);
}

/* =========================================================
   [객관식 순위] 집계 / 렌더
   ========================================================= */

// 원 문항 라벨에서 순위별 expanded 컬럼 목록을 찾는다
// pattern: `${targetLabel}__N순위` 또는 `${targetLabel}_N순위`
/**
 * 순위 문항의 확장(세분) 열 인덱스를 찾습니다.
 */
function findRankExpandedColumns(targetLabel) {
  const headerMap = filterState.headerMap;
  if (!headerMap) return [];
  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapeRegExp(targetLabel)}(?:__|_)(\\d+)순위$`);
  return Array.from(headerMap.entries())
    .map(([label, colIdx]) => {
      const match = String(label || '').match(pattern);
      if (!match) return null;
      return {
        rank: Number(match[1]),
        label,
        colIdx
      };
    })
    .filter(item => item && Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * 순위 문항을 기준별로 순위 분포를 집계합니다.
 */
function aggregateRank(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const rawIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;

  const rankCols = findRankExpandedColumns(targetLabel);
  if (rankCols.length === 0) return null;
  const rankCount = rankCols.length;

  const optionOrder = [...entry.options];
  const optionSet = new Set(optionOrder);
  // perRankCount[rankIdx][option] = count
  const perRankCount = rankCols.map(() => {
    const m = {};
    optionOrder.forEach(o => { m[o] = 0; });
    return m;
  });
  // respondent coverage (raw 또는 any rank filled)
  let respondentN = 0;

  rows.forEach(row => {
    const raw = rawIdx !== undefined ? cleanCell((row || [])[rawIdx]) : '';
    let touched = false;
    rankCols.forEach((rc, ri) => {
      const v = cleanCell(row[rc.colIdx]);
      if (v === '') return;
      if (!optionSet.has(v)) {
        optionSet.add(v);
        optionOrder.push(v);
        perRankCount.forEach(m => { if (m[v] === undefined) m[v] = 0; });
      }
      perRankCount[ri][v] = (perRankCount[ri][v] || 0) + 1;
      touched = true;
    });
    if (touched || raw !== '') respondentN += 1;
  });

  // weighted average: 최하위 1점, 상위로 갈수록 2점씩 증가
  const weightedScore = {};
  const weightedAverage = {};
  optionOrder.forEach(o => {
    weightedScore[o] = 0;
    rankCols.forEach((rc, ri) => {
      const w = getRankWeight(rankCount, ri);
      weightedScore[o] += (perRankCount[ri][o] || 0) * w;
    });
    weightedAverage[o] = respondentN > 0 ? weightedScore[o] / respondentN : 0;
  });

  const rawOnlyCount = {};
  optionOrder.forEach(o => { rawOnlyCount[o] = 0; });
  if (rawIdx !== undefined) {
    rows.forEach(row => {
      const raw = cleanCell((row || [])[rawIdx]);
      if (!raw || raw.includes('|')) return;
      if (!Object.prototype.hasOwnProperty.call(rawOnlyCount, raw)) return;
      const hasRank = rankCols.some((rc) => cleanCell((row || [])[rc.colIdx]) !== '');
      if (!hasRank) rawOnlyCount[raw] += 1;
    });
  }

  // 0건인 보기는 숨김하되, raw 단독 응답은 순위가 없어도 유지합니다.
  const nonzeroOptionOrder = optionOrder.filter(o => {
    const hasRankCount = rankCols.some((_, ri) => (perRankCount[ri][o] || 0) > 0);
    return hasRankCount || (rawOnlyCount[o] || 0) > 0;
  });
  const visibleOptionOrder = optionOrder.filter(o => {
    if (isOtherOption(o)) return false;
    return rankCols.some((_, ri) => (perRankCount[ri][o] || 0) > 0);
  });

  // 종합 순위 계산 (내림차순, 동률이면 공동 순위)
  const sortedVisible = [...visibleOptionOrder].sort((a, b) => weightedAverage[b] - weightedAverage[a]);
  const ranking = [];
  let currentPos = 0;
  let lastScore = null;
  let seen = 0;
  sortedVisible.forEach(opt => {
    seen += 1;
    const sc = weightedAverage[opt];
    if (lastScore === null || sc !== lastScore) {
      currentPos = seen;
      lastScore = sc;
    }
    ranking.push({ option: opt, position: currentPos, score: weightedScore[opt], weightedAverage: sc });
  });

  // per-option, per-rank 비율 표 데이터
  // basis: 순위별 응답자 수가 아니라 전체 응답자 수(respondentN)
  const totalResults = nonzeroOptionOrder.map(opt => {
    const perRank = rankCols.map((rc, ri) => {
      const c = perRankCount[ri][opt] || 0;
      const pct = respondentN > 0 ? (c / respondentN) * 100 : 0;
      return { rank: rc.rank, count: c, pct };
    });
    return {
      option: opt,
      score: weightedScore[opt],
      weightedAverage: weightedAverage[opt],
      perRank,
      totalPct: perRank.reduce((s, r) => s + r.pct, 0) + (respondentN > 0 ? ((rawOnlyCount[opt] || 0) / respondentN) * 100 : 0),
      totalCount: perRank.reduce((s, r) => s + r.count, 0) + (rawOnlyCount[opt] || 0)
    };
  });

  // 그룹별 비교
  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      // per-group per-rank count
      const byGroup = new Map();
      const makeBucket = () => ({
        n: 0,
        perRankCount: rankCols.map(() => Object.fromEntries(optionOrder.map(o => [o, 0])))
      });
      groupOrder.forEach(gv => byGroup.set(gv, makeBucket()));

      rows.forEach(row => {
        const gv = cleanCell(row[cIdx]);
        if (gv === '') return;
        if (!groupSet.has(gv)) {
          groupSet.add(gv);
          groupOrder.push(gv);
          byGroup.set(gv, makeBucket());
        }
        const bucket = byGroup.get(gv);
        const raw = rawIdx !== undefined ? cleanCell((row || [])[rawIdx]) : '';
        let touched = false;
        rankCols.forEach((rc, ri) => {
          const v = cleanCell(row[rc.colIdx]);
          if (v === '') return;
          if (!optionSet.has(v)) {
            optionSet.add(v);
            optionOrder.push(v);
            byGroup.forEach(b => {
              b.perRankCount.forEach(m => { if (m[v] === undefined) m[v] = 0; });
            });
          }
          bucket.perRankCount[ri][v] = (bucket.perRankCount[ri][v] || 0) + 1;
          touched = true;
        });
        if (touched || raw !== '') bucket.n += 1;
      });

      groupResults = groupOrder.map(gv => {
        const bucket = byGroup.get(gv);
        const gRawOnlyCount = {};
        nonzeroOptionOrder.forEach(opt => { gRawOnlyCount[opt] = 0; });
        if (rawIdx !== undefined) {
          rows.forEach(row => {
            const rowGroup = cleanCell((row || [])[cIdx]);
            if (rowGroup !== gv) return;
            const raw = cleanCell((row || [])[rawIdx]);
            if (!raw || raw.includes('|')) return;
            if (!Object.prototype.hasOwnProperty.call(gRawOnlyCount, raw)) return;
            const hasRank = rankCols.some((rc) => cleanCell((row || [])[rc.colIdx]) !== '');
            if (!hasRank) gRawOnlyCount[raw] += 1;
          });
        }
        // group 내부 가중 점수
        const gScore = {};
        const gAverage = {};
        visibleOptionOrder.forEach(opt => {
          gScore[opt] = 0;
          rankCols.forEach((rc, ri) => {
            const w = getRankWeight(rankCount, ri);
            gScore[opt] += (bucket.perRankCount[ri][opt] || 0) * w;
          });
          gAverage[opt] = bucket.n > 0 ? gScore[opt] / bucket.n : 0;
        });
        const gSorted = [...visibleOptionOrder].sort((a, b) => gAverage[b] - gAverage[a]);
        const gRanking = [];
        let pos = 0; let last = null; let n = 0;
        gSorted.forEach(opt => {
          n += 1;
          const sc = gAverage[opt];
          if (last === null || sc !== last) { pos = n; last = sc; }
          gRanking.push({ option: opt, position: pos, score: gScore[opt], weightedAverage: sc });
        });
        const gPerOption = nonzeroOptionOrder.map(opt => ({
          option: opt,
          score: gScore[opt],
          weightedAverage: gAverage[opt],
          totalCount: rankCols.reduce((sum, _rc, ri) => sum + (bucket.perRankCount[ri][opt] || 0), 0) + (gRawOnlyCount[opt] || 0),
          perRank: rankCols.map((rc, ri) => {
            const c = bucket.perRankCount[ri][opt] || 0;
            const pct = bucket.n > 0 ? (c / bucket.n) * 100 : 0;
            return { rank: rc.rank, count: c, pct };
          })
        }));
        return {
          value: gv,
          label: `${critEntry.label}: ${gv}`,
          n: bucket.n,
          ranking: gRanking,
          perOption: gPerOption
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    rankCount,
    rankWeights: rankCols.map((_, idx) => getRankWeight(rankCount, idx)),
    rankLabels: rankCols.map(rc => `${rc.rank}순위`),
    respondentN,
    optionOrder: visibleOptionOrder,
    totalResults,
    ranking,
    visualType: 'rank',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

/**
 * 순위 결과 차트 유형을 반환합니다.
 */
function getRankChartType(targetLabel) {
  const stored = resultState.rankChartTypes.get(targetLabel);
  return RANK_CHART_TYPES.includes(stored) ? stored : 'lollipop';
}

/**
 * 순위 정렬이 점수 기준인지 여부/설정을 반환합니다.
 */
function getRankSortByScore(targetLabel) {
  return !!resultState.rankSortByScore.get(targetLabel);
}

/**
 * 순위 집계 데이터에 정렬 옵션을 적용합니다.
 */
function applyRankSortToData(data, sortByScore) {
  if (!sortByScore || !data) return data;
  const pinned = data.totalResults.filter(r => isPinnedSortOption(r.option));
  const sortable = data.totalResults.filter(r => !isPinnedSortOption(r.option));
  const sortedSortable = [...sortable].sort((a, b) => {
    if (b.weightedAverage !== a.weightedAverage) return b.weightedAverage - a.weightedAverage;
    return data.optionOrder.indexOf(a.option) - data.optionOrder.indexOf(b.option);
  });
  const sortedTotal = [...sortedSortable, ...pinned];
  const newOrder = sortedTotal.map(item => item.option);
  return {
    ...data,
    optionOrder: newOrder,
    totalResults: sortedTotal
  };
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankControlsHtml(targetLabel, options = {}) {
  const {
    chartType = 'lollipop',
    viewMode = 'horizontal',
    sortByScore = false,
    formulaNoteHtml = '',
    groupMode = false
  } = options;
  const safeTarget = escapeHtml(targetLabel);
  const isMenuOpen = resultState.openRankMenus.has(targetLabel);
  const directionLabel = viewMode === 'vertical' ? '세로' : '가로';
  const directionHtml = `
    <div class="viz-controls-element">
      <span class="viz-controls-label">그래프 방향 선택</span>
      <div class="viz-control-dropdown ${isMenuOpen ? 'is-open' : ''}" data-rank-view-mode-select="true">
        <button type="button"
                class="viz-control-dropdown__trigger"
                data-rank-view-mode-trigger="true"
                data-target="${safeTarget}"
                aria-haspopup="listbox"
                aria-expanded="${isMenuOpen ? 'true' : 'false'}">
          <span class="viz-control-dropdown__current">${directionLabel}</span>
          <img class="viz-control-dropdown__chevron" src="assets/icons/keyboard_arrow_down_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true">
        </button>
        <div class="viz-control-dropdown__menu" role="listbox" ${isMenuOpen ? '' : 'hidden'}>
          ${[
            { mode: 'horizontal', label: '가로' },
            { mode: 'vertical', label: '세로' }
          ].map(item => `
            <button type="button"
                    class="viz-control-dropdown__option"
                    data-rank-view-mode-option="${item.mode}"
                    data-target="${safeTarget}"
                    role="option"
                    aria-selected="${item.mode === viewMode ? 'true' : 'false'}"
                    ${groupMode && item.mode === 'vertical' ? 'disabled' : ''}>
              ${item.label}
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  const chartTypeHtml = `
    <div class="viz-controls-element">
      <div class="viz-control-toggle" role="tablist" aria-label="순위 그래프 형태">
        ${RANK_CHART_TYPES.map(type => `
          <button type="button"
                  class="viz-control-toggle__btn ${type === chartType ? 'active' : ''}"
                  data-rank-chart-type="${type}"
                  data-target="${safeTarget}"
                  role="tab"
                  aria-selected="${type === chartType ? 'true' : 'false'}"
                  ${groupMode && type === 'stacked' ? 'disabled' : ''}>
            ${escapeHtml(RANK_CHART_TYPE_LABELS[type])}
          </button>
        `).join('')}
      </div>
    </div>
  `;
  const sortHtml = `
    <label class="viz-control-checkbox">
      <input type="checkbox" data-rank-sort-by-score data-target="${safeTarget}" ${sortByScore ? 'checked' : ''}>
      <span class="viz-control-checkbox__label">가중 평균 높은 순서로 정렬</span>
    </label>
  `;
  return `<div class="viz-controls">${directionHtml}${chartTypeHtml}${sortHtml}${formulaNoteHtml}</div>`;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankFormulaNoteHtml(data) {
  return `
    <div class="viz-controls-note">
      ${escapeHtml(buildRankWeightFormulaText(data.rankCount))}
    </div>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankLollipopChartHtml(data) {
  const rows = [...(data.totalResults || [])];
  const axisMin = 0;
  const axisMax = Math.max(axisMin, ...((data.rankWeights || []).map(Number)));
  const axisTicks = [];
  for (let tick = axisMin; tick <= axisMax; tick += 1) axisTicks.push(tick);
  const pctFor = (value) => {
    const safeValue = Math.max(axisMin, Math.min(axisMax, Number(value) || 0));
    if (axisMax === axisMin) return 0;
    return ((safeValue - axisMin) / (axisMax - axisMin)) * 100;
  };
  const overlayHeight = rows.length * 40;
  const guideOverlayHtml = axisTicks.map(tick => {
    const tickPct = pctFor(tick);
    return `<span class="horizontal-chart-guide" style="left:${tickPct}%;"></span>`;
  }).join('');
  const rowHtml = rows.map((r) => {
    const rankObj = data.ranking.find(item => item.option === r.option);
    const posText = rankObj ? `${rankObj.position}위` : '-';
    const color = RANK_LOLLIPOP_COLOR;
    const valueText = formatRankAverage(r.weightedAverage);
    const leftPct = pctFor(r.weightedAverage);
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'rank-lollipop',
      option: r.option,
      weightedAverage: r.weightedAverage,
      rankPosition: posText
    }));
    return `
      <div class="lollipop-h-row">
        <div class="lollipop-h-label" title="${escapeHtml(r.option)}" data-tip="${tip}">${escapeHtml(r.option)}</div>
        <div class="lollipop-h-track" data-tip="${tip}">
          <div class="lollipop-h-line" style="width:${leftPct}%;background:${color};"></div>
          <div class="lollipop-h-dot" style="left:${leftPct}%;background:${color};"></div>
          <div class="lollipop-h-inline-label" style="left:calc(${leftPct}% + 17px);" aria-hidden="true">
            <span class="lollipop-h-value">${valueText}</span>
          </div>
        </div>
        <div class="lollipop-h-rank">${escapeHtml(posText)}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="lollipop-h-chart">
      <div class="horizontal-chart-guides" style="height:${overlayHeight}px;" aria-hidden="true">${guideOverlayHtml}</div>
      ${rowHtml}
      <div class="horizontal-chart-axis-row" aria-hidden="true">
        <div class="horizontal-chart-axis-spacer"></div>
        <div class="horizontal-chart-axis">
          ${axisTicks.map(tick => {
            const leftPct = pctFor(tick);
            const cls = tick === axisMin ? 'is-start' : (tick === axisMax ? 'is-end' : 'is-mid');
            return `<span class="horizontal-chart-axis-label ${cls}" style="left:${leftPct}%;">${tick}</span>`;
          }).join('')}
        </div>
        <div class="lollipop-h-axis-rank-spacer"></div>
      </div>
    </div>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankLollipopGroupCompareChartHtml(data, hiddenGroups = new Set()) {
  const rows = [...(data.totalResults || [])];
  const axisMin = 0;
  const axisMax = Math.max(axisMin, ...((data.rankWeights || []).map(Number)));
  const axisTicks = [];
  for (let tick = axisMin; tick <= axisMax; tick += 1) axisTicks.push(tick);
  const pctFor = (value) => {
    const safeValue = Math.max(axisMin, Math.min(axisMax, Number(value) || 0));
    if (axisMax === axisMin) return 0;
    return ((safeValue - axisMin) / (axisMax - axisMin)) * 100;
  };
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const overlayHeight = rows.length * 40;
  const guideOverlayHtml = axisTicks.map(tick => {
    const tickPct = pctFor(tick);
    return `<span class="horizontal-chart-guide" style="left:${tickPct}%;"></span>`;
  }).join('');
  const rowHtml = rows.map((r) => {
    const rankObj = data.ranking.find(item => item.option === r.option);
    const posText = rankObj ? `${rankObj.position}위` : '-';
    const color = 'var(--neutral-300)';
    const leftPct = pctFor(r.weightedAverage);
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'rank-lollipop',
      option: r.option,
      weightedAverage: r.weightedAverage,
      rankPosition: posText
    }));
    const groupDotsHtml = displayGroups.map(g => {
      const perOpt = Array.isArray(g.perOption) ? g.perOption.find(x => x.option === r.option) : null;
      if (!perOpt) return '';
      const groupColor = getGroupColor(data.groupResults, g.value);
      const groupLeft = pctFor(perOpt.weightedAverage);
      const labelSide = groupLeft > 50 ? 'left' : 'right';
      const gRank = Array.isArray(g.ranking) ? g.ranking.find(x => x.option === r.option) : null;
      const groupRankPos = gRank ? `${gRank.position}위` : '-';
      const groupTip = encodeURIComponent(JSON.stringify({
        kind: 'rank-lollipop-group',
        groupLabel: g.label,
        option: r.option,
        weightedAverage: perOpt.weightedAverage,
        rankPosition: groupRankPos
      }));
      return `<div class="group-dot-wrap" style="left:${groupLeft}%;" data-tip="${groupTip}" data-group-key="${escapeHtml(String(g.value))}" data-label-side="${labelSide}"><div class="group-dot" style="background:${groupColor};"></div><span class="group-dot-label">${formatRankAverage(perOpt.weightedAverage)}</span></div>`;
    }).join('');
    return `
      <div class="lollipop-h-row">
        <div class="lollipop-h-label" title="${escapeHtml(r.option)}" data-tip="${tip}">${escapeHtml(r.option)}</div>
        <div class="lollipop-h-track">
          <div class="lollipop-h-line" style="width:${leftPct}%;background:${color};" data-tip="${tip}"></div>
          <div class="lollipop-h-dot" style="left:${leftPct}%;background:${color};" data-tip="${tip}"></div>
          ${groupDotsHtml}
        </div>
        <div class="lollipop-h-rank">${escapeHtml(posText)}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="lollipop-h-chart group-compare">
      <div class="horizontal-chart-guides" style="height:${overlayHeight}px;" aria-hidden="true">${guideOverlayHtml}</div>
      ${rowHtml}
      <div class="horizontal-chart-axis-row" aria-hidden="true">
        <div class="horizontal-chart-axis-spacer"></div>
        <div class="horizontal-chart-axis">
          ${axisTicks.map(tick => {
            const leftPct = pctFor(tick);
            const cls = tick === axisMin ? 'is-start' : (tick === axisMax ? 'is-end' : 'is-mid');
            return `<span class="horizontal-chart-axis-label ${cls}" style="left:${leftPct}%;">${tick}</span>`;
          }).join('')}
        </div>
        <div class="lollipop-h-axis-rank-spacer"></div>
      </div>
    </div>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankDualLollipopChartHtml(data, hiddenGroups = new Set()) {
  const rows = [...(data.totalResults || [])];
  const axisMin = 0;
  const axisMax = Math.max(axisMin, ...((data.rankWeights || []).map(Number)));
  const axisTicks = [];
  for (let tick = axisMin; tick <= axisMax; tick += 1) axisTicks.push(tick);
  const pctFor = (value) => {
    const safeValue = Math.max(axisMin, Math.min(axisMax, Number(value) || 0));
    if (axisMax === axisMin) return 0;
    return ((safeValue - axisMin) / (axisMax - axisMin)) * 100;
  };
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const trackH = 32;
  const trackGap = 4;
  const rowGap = 16;
  const overlayHeight = rows.length * (displayGroups.length * trackH + (displayGroups.length - 1) * trackGap) + (rows.length - 1) * rowGap + 8;
  const guideOverlayHtml = axisTicks.map(tick => {
    const tickPct = pctFor(tick);
    return `<span class="horizontal-chart-guide" style="left:${tickPct}%;"></span>`;
  }).join('');
  const rowHtml = rows.map((r) => {
    const rankObj = data.ranking.find(item => item.option === r.option);
    const posText = rankObj ? `${rankObj.position}위` : '-';
    const labelTip = encodeURIComponent(JSON.stringify({
      kind: 'rank-lollipop',
      option: r.option,
      weightedAverage: r.weightedAverage,
      rankPosition: posText
    }));
    const tracksHtml = displayGroups.map(g => {
      const perOpt = Array.isArray(g.perOption) ? g.perOption.find(x => x.option === r.option) : null;
      const avg = perOpt ? (perOpt.weightedAverage || 0) : 0;
      const color = getGroupColor(data.groupResults, g.value);
      const leftPct = pctFor(avg);
      const gRank = Array.isArray(g.ranking) ? g.ranking.find(x => x.option === r.option) : null;
      const groupRankPos = gRank ? `${gRank.position}위` : '-';
      const groupTip = encodeURIComponent(JSON.stringify({
        kind: 'rank-lollipop-group',
        groupLabel: g.label,
        option: r.option,
        weightedAverage: avg,
        rankPosition: groupRankPos
      }));
      return `
        <div class="lollipop-h-track" data-tip="${groupTip}">
          <div class="lollipop-h-line" style="width:${leftPct}%;background:${color};"></div>
          <div class="lollipop-h-dot" style="left:${leftPct}%;background:${color};"></div>
          <div class="lollipop-h-inline-label" style="left:calc(${leftPct}% + 17px);" aria-hidden="true">
            <span class="lollipop-h-value">${formatRankAverage(avg)}</span>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="dual-lollipop-h-row">
        <div class="lollipop-h-label" title="${escapeHtml(r.option)}" data-tip="${labelTip}">${escapeHtml(r.option)}</div>
        <div class="dual-lollipop-h-bars">${tracksHtml}</div>
        <div class="lollipop-h-rank">${escapeHtml(posText)}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="dual-lollipop-h-chart">
      <div class="horizontal-chart-guides" style="height:${overlayHeight}px;" aria-hidden="true">${guideOverlayHtml}</div>
      ${rowHtml}
      <div class="horizontal-chart-axis-row" aria-hidden="true">
        <div class="horizontal-chart-axis-spacer"></div>
        <div class="horizontal-chart-axis">
          ${axisTicks.map(tick => {
            const leftPct = pctFor(tick);
            const cls = tick === axisMin ? 'is-start' : (tick === axisMax ? 'is-end' : 'is-mid');
            return `<span class="horizontal-chart-axis-label ${cls}" style="left:${leftPct}%;">${tick}</span>`;
          }).join('')}
        </div>
        <div class="lollipop-h-axis-rank-spacer"></div>
      </div>
    </div>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankVerticalAxisMeta(maxValue, step, suffix = '') {
  const safeStep = Math.max(1, Number(step) || 1);
  const safeMax = Math.max(safeStep, Number(maxValue) || 0);
  const topValue = Math.ceil(safeMax / safeStep) * safeStep;
  const ticks = [];
  for (let value = topValue; value > 0; value -= safeStep) {
    const bottomPct = topValue === 0 ? 0 : (value / topValue) * 100;
    ticks.push({
      value,
      label: `${value}${suffix}`,
      bottomPct
    });
  }
  return { topValue, ticks };
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankVerticalLollipopChartHtml(data) {
  const rows = [...(data.totalResults || [])];
  const n = rows.length;
  const axisMax = Math.max(0, ...((data.rankWeights || []).map(Number)));
  const axisMeta = buildRankVerticalAxisMeta(axisMax, 1, '');
  const itemsHtml = rows.map(row => {
    const rankObj = data.ranking.find(item => item.option === row.option);
    const posText = rankObj ? `${rankObj.position}위` : '-';
    const valueText = formatRankAverage(row.weightedAverage);
    const ratio = axisMeta.topValue > 0 ? Math.max(0, Math.min(1, (Number(row.weightedAverage) || 0) / axisMeta.topValue)) : 0;
    const bottomPct = ratio * 100;
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'rank-lollipop',
      option: row.option,
      weightedAverage: row.weightedAverage,
      rankPosition: posText
    }));
    return `
      <div class="vertical-chart-col">
        <div class="vertical-chart-metric-slot">
          <div class="lollipop-v-marker-label" style="bottom:calc(${bottomPct}% + 11px);">
            <span class="lollipop-v-rank">${escapeHtml(posText)}</span>
            <span class="lollipop-v-value">${valueText}</span>
          </div>
          <div class="lollipop-v-track" data-tip="${tip}">
            <div class="lollipop-v-line" style="height:${bottomPct}%;"></div>
            <div class="lollipop-v-dot" style="bottom:${bottomPct}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  const labelsHtml = rows.map(row => {
    const labelTip = encodeURIComponent(JSON.stringify({
      kind: 'option-label',
      option: row.option
    }));
    return `<div class="vertical-chart-label" title="${escapeHtml(row.option)}" data-tip="${labelTip}">${escapeHtml(row.option)}</div>`;
  }).join('');

  const guidesHtml = axisMeta.ticks.map(tick => `
    <div class="vertical-chart-guide" style="bottom:${tick.bottomPct}%;" aria-hidden="true">
      <span class="vertical-chart-guide-line"></span>
      <span class="vertical-chart-guide-label">${tick.label}</span>
    </div>
  `).join('');

  return `
    <div class="vertical-chart lollipop-v-chart">
      <div class="vertical-chart-plot">
        <div class="vertical-chart-guides" aria-hidden="true">${guidesHtml}</div>
        <div class="vertical-chart-track-row">
          ${itemsHtml}
        </div>
      </div>
      <div class="vertical-chart-label-row">
        ${labelsHtml}
      </div>
    </div>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankStackChartHtml(data, hiddenRanks) {
  const rows = [...(data.totalResults || [])];
  const rankLabels = data.rankLabels;
  const rowHtml = rows.map(r => {
    const labelTip = encodeURIComponent(JSON.stringify({
      kind: 'option-label',
      option: r.option
    }));
    const segments = r.perRank.map((pr, ri) => {
      if (hiddenRanks.has(ri)) return "";
      const w = Math.max(0, pr.pct);
      if (w <= 0) return "";
      const color = rankStackColor(ri);
      const labelColor = ri === 0 ? 'var(--White)' : 'var(--neutral-700)';
      const tip = encodeURIComponent(JSON.stringify({
        kind: 'rank-seg',
        option: r.option,
        rankLabel: rankLabels[ri],
        pct: pr.pct,
        count: pr.count
      }));
      const valueHtml = `<span class="stack-h-seg-value" style="color:${labelColor};">${formatPercent(pr.pct)}</span>`;
      return `<div class="stack-h-seg"
                   style="width:${w}%; background:${color};"
                   data-tip="${tip}">${valueHtml}</div>`;
    }).join("");
    const visiblePct = r.perRank.reduce((s, pr, ri) => s + (hiddenRanks.has(ri) ? 0 : pr.pct), 0);
    const totalValueHtml = `<span class="stack-h-total-value is-outside">${formatPercent(visiblePct)}</span>`;
    return `
      <div class="stack-h-row">
        <div class="stack-h-label" title="${escapeHtml(r.option)}" data-tip="${labelTip}">${escapeHtml(r.option)}</div>
        <div class="stack-h-main">
          <div class="stack-h-track">${segments}</div>
          ${totalValueHtml}
        </div>
      </div>
    `;
  }).join('');
  const overlayHeight = rows.length * 40;
  const guideHtml = [0, 20, 40, 60, 80, 100].map(t => `<span class="horizontal-chart-guide" style="left:${t}%;"></span>`).join('');
  const axisHtml = [20, 40, 60, 80, 100].map(t =>
    `<span class="horizontal-chart-axis-label" style="left:${t}%;">${t}%</span>`
  ).join('');
  return `
    <div class="stack-h-chart">
      <div class="horizontal-chart-guides" style="height:${overlayHeight}px;" aria-hidden="true">${guideHtml}</div>
      ${rowHtml}
      <div class="horizontal-chart-axis-row" aria-hidden="true">
        <div class="horizontal-chart-axis-spacer"></div>
        <div class="horizontal-chart-axis">${axisHtml}</div>
        <div></div>
      </div>
    </div>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankVerticalStackChartHtml(data, hiddenRanks) {
  const rows = [...(data.totalResults || [])];
  const n = rows.length;
  const rankLabels = data.rankLabels || [];
  const maxDisplayedPct = rows.reduce((max, row) => {
    const visiblePct = (row.perRank || []).reduce((sum, pr, ri) => sum + (hiddenRanks.has(ri) ? 0 : (pr.pct || 0)), 0);
    return Math.max(max, visiblePct);
  }, 0);
  const axisMeta = buildRankVerticalAxisMeta(Math.max(20, maxDisplayedPct), 20, '%');
  const rowHtml = rows.map(r => {
    let cumulativePct = 0;
    const segments = r.perRank.map((pr, ri) => {
      if (hiddenRanks.has(ri)) return "";
      const pct = Math.max(0, pr.pct);
      if (pct <= 0) return "";
      const heightPct = axisMeta.topValue > 0 ? (pct / axisMeta.topValue) * 100 : 0;
      if (heightPct <= 0) return "";
      cumulativePct += heightPct;
      const color = rankStackColor(ri);
      const labelColor = ri === 0 ? 'var(--White)' : 'var(--neutral-700)';
      const tip = encodeURIComponent(JSON.stringify({
        kind: 'rank-seg',
        option: r.option,
        rankLabel: rankLabels[ri],
        pct: pr.pct,
        count: pr.count
      }));
      const labelHtml = heightPct >= 6
        ? `<span class="stack-v-seg-value" style="top:4px; color:${labelColor};">${formatPercent(pr.pct)}</span>`
        : '';
      return `<div class="stack-v-seg"
                   style="height:${heightPct}%; background:${color};"
                   data-tip="${tip}">${labelHtml}</div>`;
    }).join("");
    const displayedPct = r.perRank.reduce((sum, pr, ri) => sum + (hiddenRanks.has(ri) ? 0 : (pr.pct || 0)), 0);
    const totalBottomPct = axisMeta.topValue > 0 ? (displayedPct / axisMeta.topValue) * 100 : 0;
    return `
      <div class="vertical-chart-col">
        <div class="vertical-chart-metric-slot">
          <div class="stack-v-track">
            <div class="stack-v-total-label" style="bottom:calc(${totalBottomPct}% + 2px);">${formatPercent(displayedPct)}</div>
            ${segments}
          </div>
        </div>
      </div>
    `;
  }).join('');
  const labelsHtml = rows.map(r => {
    const labelTip = encodeURIComponent(JSON.stringify({
      kind: 'option-label',
      option: r.option
    }));
    return `<div class="vertical-chart-label" title="${escapeHtml(r.option)}" data-tip="${labelTip}">${escapeHtml(r.option)}</div>`;
  }).join('');
  const guidesHtml = axisMeta.ticks.map(tick => `
    <div class="vertical-chart-guide" style="bottom:${tick.bottomPct}%;" aria-hidden="true">
      <span class="vertical-chart-guide-line"></span>
      <span class="vertical-chart-guide-label">${tick.label}</span>
    </div>
  `).join('');

  return `
    <div class="vertical-chart stack-v-chart">
      <div class="vertical-chart-plot">
        <div class="vertical-chart-guides" aria-hidden="true">${guidesHtml}</div>
        <div class="vertical-chart-track-row">
          ${rowHtml}
        </div>
      </div>
      <div class="vertical-chart-label-row">
        ${labelsHtml}
      </div>
    </div>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankLegendHtml(data, hiddenRanks) {
  const items = data.rankLabels.map((lab, ri) => {
    const isHidden = hiddenRanks.has(ri);
    const color = rankStackColor(ri);
    return `
      <label class="legend-item ${isHidden ? 'disabled' : ''}" data-rank="${ri}">
        <input type="checkbox" ${isHidden ? '' : 'checked'}>
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(lab)}</span>
      </label>
    `;
  }).join('');
  return `
    <aside class="legend-panel">
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}" data-mode="rank">${items}</div>
      <div class="legend-btn-group">
        <div class="legend-actions" data-target="${escapeHtml(data.targetLabel)}" data-mode="rank">
          <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
          <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
        </div>
      </div>
    </aside>
  `;
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankGroupLegendHtml(data, hiddenGroups, opts = {}) {
  if (!data.groupResults) return '';
  const { showDualBar = false, isDualBar = false } = opts;
  const criterionLabel = data.criterionLabel || '';
  const items = buildGroupedLegendRowsHtml(data, hiddenGroups);
  const dualBarBtnHtml = showDualBar
    ? `<button type="button" class="two-compare-btn${isDualBar ? ' is-active' : ''}" data-dual-bar-toggle="${escapeHtml(data.targetLabel)}">${isDualBar ? '기본 그래프로 보기' : '두 그룹만 비교하기'}</button>`
    : '';
  return `
    <aside class="legend-panel">
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">${items}</div>
      <div class="legend-btn-group">
        <div class="legend-actions" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">
          <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
          <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
          ${criterionLabel ? `<button type="button" class="legend-action-btn" data-open-group-config="true" data-target="${escapeHtml(data.targetLabel)}" data-criterion="${escapeHtml(criterionLabel)}">그룹 편집</button>` : ''}
        </div>
        ${dualBarBtnHtml}
      </div>
    </aside>
  `;
}

/**
 * 순위 데이터에서 1순위 비율 행만 추려 반환합니다.
 */
function getRankFirstChoiceRows(data) {
  if (!data || !Array.isArray(data.totalResults)) return [];
  const order = Array.isArray(data.optionOrder) ? data.optionOrder : [];
  return data.totalResults
    .map((r) => {
      const firstRank = Array.isArray(r.perRank) && r.perRank[0]
        ? r.perRank[0]
        : { pct: 0, count: 0 };
      return {
        option: r.option,
        pct: firstRank.pct || 0,
        count: firstRank.count || 0
      };
    })
    .sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      if (b.count !== a.count) return b.count - a.count;
      return order.indexOf(a.option) - order.indexOf(b.option);
    });
}

/**
 * 특정 그룹·선택지의 1순위 비율을 반환합니다.
 */
function getRankFirstChoiceForGroup(group, option) {
  const perOpt = group && Array.isArray(group.perOption)
    ? group.perOption.find(x => x.option === option)
    : null;
  const firstRank = perOpt && Array.isArray(perOpt.perRank) && perOpt.perRank[0]
    ? perOpt.perRank[0]
    : { pct: 0, count: 0 };
  return {
    pct: firstRank.pct || 0,
    count: firstRank.count || 0
  };
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankDataTableHtml(data, hiddenGroups = new Set()) {
  const { totalResults, rankLabels, groupResults, respondentN } = data;
  if (!groupResults) {
    const topRow = [
      `<th rowspan="2">보기</th>`,
      ...rankLabels.map(lab => `<th colspan="2" class="group-col">${escapeHtml(lab)}</th>`),
      `<th rowspan="2" class="num group-col">가중 평균</th>`,
      `<th rowspan="2" class="num">종합 순위</th>`
    ].join('');
    const subRow = [
      ...rankLabels.map(() => `<th class="num group-col">응답 비율(%)</th><th class="num">응답 수(명)</th>`)
    ].join('');
    const bodyRows = totalResults.map(r => {
      const rankObj = data.ranking.find(rk => rk.option === r.option);
      const pos = rankObj ? rankObj.position : '-';
      const rankCells = r.perRank.map(pr => `<td class="num group-col">${formatPercent(pr.pct)}</td><td class="num">${pr.count.toLocaleString()}</td>`).join('');
      return `
        <tr>
          <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
          ${rankCells}
          <td class="num group-col">${rankObj ? formatRankAverage(r.weightedAverage) : '-'}</td>
          <td class="num">${pos === '-' ? '-' : `${pos}위`}</td>
        </tr>
      `;
    }).join('');
    const totalRankCells = rankLabels.map((_, ri) => {
      const totalCount = totalResults.reduce((sum, result) => sum + ((result.perRank[ri] && result.perRank[ri].count) || 0), 0);
      const totalPct = respondentN > 0 ? (totalCount / respondentN) * 100 : 0;
      return `<td class="num group-col">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
    }).join('');
    const tableHtml = `
      <table class="result-table">
        <thead>
          <tr>${topRow}</tr>
          <tr>${subRow}</tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="total-row">
            <td>합계</td>
            ${totalRankCells}
            <td class="num group-col">-</td>
            <td class="num">-</td>
          </tr>
        </tbody>
      </table>
    `;
    return wrapResultTable(
      tableHtml,
      ``
    );
  }

  const displayGroups = getDisplayGroupResults(groupResults, hiddenGroups);
  const blockColspan = (rankLabels.length * 2) + 2;
  const topRow = [
    `<th rowspan="3">보기</th>`,
    buildGroupedCountHeader('응답자 전체', respondentN, blockColspan),
    ...displayGroups.map(g => buildGroupedCountHeader(g.label, g.n, blockColspan))
  ].join('');
  const midRow = [
      ...[null, ...displayGroups].map(() => [
        ...rankLabels.map(lab => `<th colspan="2" class="group-col">${escapeHtml(lab)}</th>`),
      `<th rowspan="2" class="num group-col">가중 평균</th>`,
      `<th rowspan="2" class="num">종합 순위</th>`
    ].join(''))
  ].join('');
  const subRow = [
    ...[null, ...displayGroups].map(() =>
      rankLabels.map(() => `<th class="num group-col">응답 비율(%)</th><th class="num">응답 수(명)</th>`).join('')
    )
  ].join('');

  const bodyRows = totalResults.map(r => {
    const totalRank = data.ranking.find(rk => rk.option === r.option);
    const totalPos = totalRank ? totalRank.position : '-';
    const rankCells = r.perRank.map(pr => `<td class="num group-col">${formatPercent(pr.pct)}</td><td class="num">${pr.count.toLocaleString()}</td>`).join('');
    const groupCells = displayGroups.map(g => {
      const perOpt = g.perOption.find(x => x.option === r.option);
      const perRankCells = (perOpt ? perOpt.perRank : rankLabels.map(() => ({ pct: 0, count: 0 })))
        .map(pr => `<td class="num group-col">${formatPercent(pr.pct)}</td><td class="num">${pr.count.toLocaleString()}</td>`)
        .join('');
      const rk = g.ranking.find(x => x.option === r.option);
      const po = rk ? rk.position : '-';
      return `${perRankCells}<td class="num group-col">${rk ? formatRankAverage(perOpt ? perOpt.weightedAverage : 0) : '-'}</td><td class="num">${po === '-' ? '-' : `${po}위`}</td>`;
    }).join('');
    return `
      <tr>
        <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
        ${rankCells}
        <td class="num group-col">${totalRank ? formatRankAverage(r.weightedAverage) : '-'}</td>
        <td class="num">${totalPos === '-' ? '-' : `${totalPos}위`}</td>
        ${groupCells}
      </tr>
    `;
  }).join('');
  const totalRankCells = rankLabels.map((_, ri) => {
    const totalCount = totalResults.reduce((sum, result) => sum + ((result.perRank[ri] && result.perRank[ri].count) || 0), 0);
    const totalPct = respondentN > 0 ? (totalCount / respondentN) * 100 : 0;
    return `<td class="num group-col">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
  }).join('');
  const totalGroupCells = displayGroups.map(g => {
    const totalPerRank = rankLabels.map((_, ri) => {
      const totalCount = totalResults.reduce((sum, result) => {
        const perOpt = g.perOption.find(x => x.option === result.option);
        return sum + ((perOpt && perOpt.perRank[ri] && perOpt.perRank[ri].count) || 0);
      }, 0);
      const totalPct = g.n > 0 ? (totalCount / g.n) * 100 : 0;
      return `<td class="num group-col">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
    }).join('');
    return `${totalPerRank}<td class="num group-col">-</td><td class="num">-</td>`;
  }).join('');
  const tableHtml = `
    <table class="result-table">
      <thead>
        <tr>${topRow}</tr>
        <tr>${midRow}</tr>
        <tr>${subRow}</tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total-row">
          <td>합계</td>
          ${totalRankCells}
          <td class="num group-col">-</td>
          <td class="num">-</td>
          ${totalGroupCells}
        </tr>
      </tbody>
    </table>
  `;
  return wrapResultTable(
    tableHtml,
    ``
  );
}

/* ---------- 순위형 1순위만 보기 ---------- */

/**
 * 1순위 합성 문항 표시용 라벨을 만듭니다.
 */
function getRank1stSyntheticLabel(targetLabel) {
  return `${targetLabel}__rank1st`;
}

/**
 * 1순위만 단일선택처럼 집계합니다.
 */
function aggregateRank1stSingle(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const firstRankColumn = findRankExpandedColumns(targetLabel)[0];
  if (!firstRankColumn) return null;
  const syntheticLabel = getRank1stSyntheticLabel(targetLabel);
  const data = aggregateSingleFromColumn(syntheticLabel, criterionLabel, rows, {
    sourceLabel: targetLabel,
    displayLabel: `${targetLabel}_1순위`,
    columnLabel: firstRankColumn.label,
    columnIndex: firstRankColumn.colIdx,
    entry
  });
  if (!data) return null;
  return {
    ...data,
    rank1stSourceLabel: targetLabel,
    rank1stColumnLabel: firstRankColumn.label
  };
}

/**
 * 순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.
 */
function buildRankSection(data, rows) {
  if (resultState.rank1stCardOpen.has(data.targetLabel)) {
    const rank1stData = aggregateRank1stSingle(data.targetLabel, data.criterionLabel, rows);
    if (rank1stData) return buildChoiceSectionHtml(rank1stData, rows);
  }

  const { codebookEntry, targetLabel, groupResults } = data;
  const hiddenRanks = resultState.hiddenRankKeys.get(targetLabel) || new Set();
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const customGroupOn = shouldApplyCustomGroup(data);
  const customGroupData = (customGroupOn && groupResults) ? buildCustomGroupData(data) : null;
  const baseData = customGroupData || data;
  const hasGroupResults = !!baseData.groupResults;
  const sortByScore = getRankSortByScore(targetLabel);
  const displayData = sortByScore ? applyRankSortToData(baseData, true) : baseData;
  const chartType = getRankChartType(targetLabel);
  const chartTypeForDisplay = hasGroupResults ? 'lollipop' : chartType; // 그룹 모드 UI는 lollipop 고정
  const viewMode = hasGroupResults ? 'horizontal' : getRankChartViewMode(targetLabel);
  const formulaNoteHtml = buildRankFormulaNoteHtml(displayData);
  const controlsHtml = buildRankControlsHtml(targetLabel, {
    chartType: chartTypeForDisplay,
    viewMode,
    sortByScore,
    formulaNoteHtml,
    groupMode: hasGroupResults
  });
  const displayGroups = hasGroupResults ? getDisplayGroupResults(baseData.groupResults, hiddenGroups) : [];
  const canDualBar = hasGroupResults && displayGroups.length === 2;
  const isDualBar = canDualBar && !!resultState.dualBarModes.get(targetLabel);
  let chartHtml = '';
  let legendHtml = '';
  if (hasGroupResults) {
    chartHtml = isDualBar
      ? buildRankDualLollipopChartHtml(displayData, hiddenGroups)
      : buildRankLollipopGroupCompareChartHtml(displayData, hiddenGroups);
    legendHtml = buildRankGroupLegendHtml(displayData, hiddenGroups, { showDualBar: canDualBar, isDualBar });
  } else {
    if (chartType === 'stacked') {
      chartHtml = viewMode === 'vertical'
        ? buildRankVerticalStackChartHtml(displayData, hiddenRanks)
        : buildRankStackChartHtml(displayData, hiddenRanks);
      legendHtml = buildRankLegendHtml(displayData, hiddenRanks);
    } else {
      chartHtml = viewMode === 'vertical'
        ? buildRankVerticalLollipopChartHtml(displayData)
        : buildRankLollipopChartHtml(displayData);
      legendHtml = '<aside class="legend-panel is-placeholder" aria-hidden="true"></aside>';
    }
  }
  const tableHtml = buildRankDataTableHtml(displayData, hiddenGroups);
  const otherTexts = getOtherResponseTexts(targetLabel, rows);
  resultState.otherResponseTexts.set(targetLabel, otherTexts);
  const fullText = buildQuestionFullHtml(codebookEntry);
  const sidePanelHtml = buildResultSidePanelHtml(legendHtml, targetLabel);
  const rank1stBtnHtml = `<button type="button" class="rank1st-card-btn" data-rank1st-card-toggle="${escapeHtml(targetLabel)}">1순위만 보기</button>`;
  const titleHtml = `<div class="result-question-label-row"><div class="result-question-label">${escapeHtml(targetLabel)}</div>${rank1stBtnHtml}</div>`;

  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="rank">
      ${buildResultHeaderHtml(titleHtml, fullText, controlsHtml)}
      <div class="result-visual has-legend">
        <div class="result-chart-col">${chartHtml}</div>
        ${sidePanelHtml}
      </div>
      ${tableHtml}
    </section>
  `;
}

/* ---------- 기타 응답 모음 ---------- */
/**
 * 기타 서술형 응답 열 인덱스를 찾습니다.
 */
function findOtherTextColumnIndex(targetLabel) {
  const header = filterState.rows && filterState.rows[0] ? filterState.rows[0] : [];
  if (!Array.isArray(header) || header.length === 0) return undefined;
  const exactCandidates = [
    `${targetLabel}__기타_텍스트`,
    `${targetLabel}__기타 텍스트`,
    `${targetLabel}_기타_텍스트`,
    `${targetLabel}_텍스트`
  ];
  for (const name of exactCandidates) {
    const idx = filterState.headerMap.get(name);
    if (idx !== undefined) return idx;
  }
  for (let i = 0; i < header.length; i++) {
    const name = cleanCell(header[i]);
    if (!name.startsWith(`${targetLabel}__`) && !name.startsWith(`${targetLabel}_`)) continue;
    if (!name.includes('기타') || !name.includes('텍스트')) continue;
    return i;
  }
  return undefined;
}

/**
 * 기타 서술형 응답 텍스트 목록을 수집합니다.
 */
function getOtherResponseTexts(targetLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry || !entry.otherInput) return [];
  const textIdx = findOtherTextColumnIndex(targetLabel);
  if (textIdx === undefined) return [];
  const texts = [];
  (rows || []).forEach(row => {
    const text = cleanCell((row || [])[textIdx]);
    if (text) texts.push(text);
  });
  return texts;
}

/**
 * 모달을 열고 초기 상태를 채웁니다.
 */
function openOtherResponsesModal(targetLabel, event) {
  const modal = document.getElementById('other-response-modal');
  const panel = modal ? modal.querySelector('.modal') : null;
  const titleEl = document.getElementById('other-response-modal-title');
  const subtitleEl = document.getElementById('other-response-modal-subtitle');
  const listEl = document.getElementById('other-response-modal-list');
  if (!modal || !panel || !titleEl || !subtitleEl || !listEl) return;

  const texts = resultState.otherResponseTexts.get(targetLabel) || [];
  titleEl.textContent = `${targetLabel} 기타 응답`;
  subtitleEl.textContent = `${texts.length}건의 직접 입력 응답`;
  listEl.innerHTML = texts.length
    ? texts.map(text => `<li>${escapeHtml(text)}</li>`).join('')
    : '<li>표시할 기타 응답이 없습니다.</li>';
  modal.classList.add('show');

  const pad = 12;
  const clickX = event && Number.isFinite(event.clientX) ? event.clientX : Math.round(window.innerWidth / 2);
  const clickY = event && Number.isFinite(event.clientY) ? event.clientY : Math.round(window.innerHeight / 2);
  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxTop = Math.max(pad, window.innerHeight - rect.height - pad);
    let left = clickX + 10;
    let top = clickY + 10;

    if (left > maxLeft) left = Math.max(pad, clickX - rect.width - 10);
    if (top > maxTop) top = Math.max(pad, clickY - rect.height - 10);

    panel.style.left = `${Math.min(left, maxLeft)}px`;
    panel.style.top = `${Math.min(top, maxTop)}px`;
  });
}

/**
 * 모달을 닫고 포커스를 복구합니다.
 */
function closeOtherResponsesModal() {
  const modal = document.getElementById('other-response-modal');
  const panel = modal ? modal.querySelector('.modal') : null;
  if (panel) {
    panel.style.left = '';
    panel.style.top = '';
  }
  if (modal) modal.classList.remove('show');
}

/**
 * 모달 DOM 이벤트와 키보드 접근성을 연결합니다.
 */
function setupOtherResponseModal() {
  const modal = document.getElementById('other-response-modal');
  const closeBtn = document.getElementById('close-other-response-btn');
  if (!modal || !closeBtn) return;
  closeBtn.addEventListener('click', closeOtherResponsesModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeOtherResponsesModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeOtherResponsesModal();
    }
  });
}

/**
 * 모달을 열고 초기 상태를 채웁니다.
 */
function openScaleCompareModal(targetLabel) {
  const modal = document.getElementById('scale-compare-modal');
  const titleEl = document.getElementById('scale-compare-modal-title');
  const noteEl = document.getElementById('scale-compare-modal-note');
  const listEl = document.getElementById('scale-compare-modal-list');
  if (!modal || !titleEl || !noteEl || !listEl) return;

  const candidates = getScaleCompareCandidateEntries(targetLabel);
  if (candidates.length === 0) {
    alert('같은 척도 길이의 비교 가능한 문항이 없습니다.');
    return;
  }

  const selected = new Set(getScaleCompareSelectedLabels(targetLabel));
  const baseEntry = resultState.codebookByLabel.get(targetLabel);
  titleEl.textContent = `${targetLabel}와 묶어 볼 문항 선택`;
  noteEl.textContent = `${baseEntry && baseEntry.valueCount ? `${baseEntry.valueCount}점 척도` : '같은 척도'} 문항만 선택할 수 있어요. 현재 문항은 기본으로 포함되며, 아래에서 추가할 문항만 고르면 됩니다.`;
  listEl.innerHTML = candidates.length > 0
    ? candidates.map(entry => `
      <label class="scale-compare-modal-item">
        <input type="checkbox" value="${escapeHtml(entry.label)}" ${selected.has(entry.label) ? 'checked' : ''}>
        <span class="scale-compare-modal-copy">
          <span class="scale-compare-modal-label">${escapeHtml(entry.label)}</span>
          ${entry.full ? `<span class="scale-compare-modal-full">${escapeHtml(entry.full)}</span>` : ''}
        </span>
      </label>
    `).join('')
    : '<div class="scale-compare-modal-empty">선택 가능한 문항이 없습니다.</div>';
  modal.dataset.target = targetLabel;
  modal.classList.add('show');
}

/**
 * 모달을 닫고 포커스를 복구합니다.
 */
function closeScaleCompareModal() {
  const modal = document.getElementById('scale-compare-modal');
  const listEl = document.getElementById('scale-compare-modal-list');
  if (listEl) listEl.innerHTML = '';
  if (!modal) return;
  modal.dataset.target = '';
  modal.classList.remove('show');
}

/**
 * 모달에서 확인한 선택을 상태에 반영합니다.
 */
function applyScaleCompareModalSelection() {
  const modal = document.getElementById('scale-compare-modal');
  const listEl = document.getElementById('scale-compare-modal-list');
  const targetLabel = modal ? cleanCell(modal.dataset.target) : '';
  if (!targetLabel || !listEl) return;
  const selectedLabels = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => cleanCell(input.value))
    .filter(Boolean);
  if (selectedLabels.length > 0) resultState.scaleCompareSelections.set(targetLabel, selectedLabels);
  else resultState.scaleCompareSelections.delete(targetLabel);
  closeScaleCompareModal();
  renderResults();
}

/**
 * 모달 DOM 이벤트와 키보드 접근성을 연결합니다.
 */
function setupScaleCompareModal() {
  const modal = document.getElementById('scale-compare-modal');
  const closeBtn = document.getElementById('close-scale-compare-btn');
  const cancelBtn = document.getElementById('cancel-scale-compare-btn');
  const applyBtn = document.getElementById('apply-scale-compare-btn');
  if (!modal || !closeBtn || !cancelBtn || !applyBtn) return;

  closeBtn.addEventListener('click', closeScaleCompareModal);
  cancelBtn.addEventListener('click', closeScaleCompareModal);
  applyBtn.addEventListener('click', applyScaleCompareModalSelection);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeScaleCompareModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeScaleCompareModal();
    }
  });
}

/* ---------- 객관식 단일: 그래프 모양 / 정렬 컨트롤 ---------- */
/**
 * 단일선택 결과의 차트 유형(파이/스택 등)을 반환합니다.
 */
function getSingleChoiceChartType(targetLabel) {
  const stored = resultState.singleChoiceChartTypes.get(targetLabel);
  const fallback = 'bar_horizontal';
  return CHOICE_CHART_TYPES.includes(stored) ? stored : fallback;
}

/**
 * 척도 결과 차트 유형을 반환합니다.
 */
function getScaleChartType(targetLabel) {
  const stored = resultState.scaleChartTypes.get(targetLabel);
  return SCALE_CHART_TYPES.includes(stored) ? stored : 'bar_horizontal_100';
}

/**
 * 비율 배분 결과 차트 유형을 반환합니다.
 */
function getRatioChartType(targetLabel) {
  const stored = resultState.ratioChartTypes.get(targetLabel);
  return RATIO_CHART_TYPES.includes(stored) ? stored : 'bar_horizontal_100';
}

/**
 * 단일선택 막대 정렬이 응답률 기준인지 반환합니다.
 */
function getSingleChoiceSortByRate(targetLabel) {
  return !!resultState.singleChoiceSortByRate.get(targetLabel);
}

/**
 * 단일선택 데이터에 정렬 옵션을 적용합니다.
 */
function applyChoiceSortToData(data, sortByRate) {
  if (!sortByRate || !data) return data;
  const pinned = data.totalResults.filter(r => isPinnedSortOption(r.option));
  const sortable = data.totalResults.filter(r => !isPinnedSortOption(r.option));
  const sortedSortable = [...sortable].sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    return data.optionOrder.indexOf(a.option) - data.optionOrder.indexOf(b.option);
  });
  const sortedTotal = [...sortedSortable, ...pinned];
  const newOrder = sortedTotal.map(r => r.option);
  const sortedGroupResults = data.groupResults
    ? data.groupResults.map(g => ({
        ...g,
        results: newOrder.map(opt => {
          const found = (g.results || []).find(r => r.option === opt);
          return found || { option: opt, count: 0, pct: 0 };
        })
      }))
    : null;
  return {
    ...data,
    originalOptionOrder: data.originalOptionOrder || data.optionOrder,
    optionOrder: newOrder,
    totalResults: sortedTotal,
    groupResults: sortedGroupResults
  };
}

/**
 * 선택지별 팔레트 색을 반환합니다.
 */
function getOptionPaletteColor(data, option) {
  const baseOrder = data.originalOptionOrder || data.optionOrder || [];
  const idx = baseOrder.indexOf(option);
  return GROUP_PALETTE[(idx < 0 ? 0 : idx) % GROUP_PALETTE.length];
}

/**
 * 단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.
 */
function buildChoiceControlsHtml(targetLabel, options) {
  const {
    showChartType = false,
    chartType = 'bar_horizontal',
    chartTypes = CHOICE_CHART_TYPES,
    disabledTypes = [],
    stateScope = 'single',
    showSort = true,
    sortByRate = false,
    isMulti = false,
    isMenuOpen = false
  } = options || {};
  const safeTarget = escapeHtml(targetLabel);
  const chevron = 'assets/icons/keyboard_arrow_down_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg';

  const chartTypeHtml = showChartType ? `
    <div class="viz-controls-element">
      <span class="viz-controls-label">그래프 모양 선택</span>
      <div class="viz-control-dropdown ${isMenuOpen ? 'is-open' : ''}" data-choice-chart-type-select data-target="${safeTarget}">
        <button type="button" class="viz-control-dropdown__trigger" data-choice-chart-type-trigger data-target="${safeTarget}" aria-haspopup="listbox" aria-expanded="${isMenuOpen ? 'true' : 'false'}">
          <span class="viz-control-dropdown__current">${escapeHtml(CHOICE_CHART_TYPE_LABELS[chartType] || CHOICE_CHART_TYPE_LABELS.bar_horizontal)}</span>
          <img class="viz-control-dropdown__chevron" src="${chevron}" alt="" aria-hidden="true">
        </button>
        <div class="viz-control-dropdown__menu" role="listbox" ${isMenuOpen ? '' : 'hidden'}>
          ${chartTypes.map(type => {
            const isDisabled = disabledTypes.includes(type);
            return `
              <button type="button"
                      class="viz-control-dropdown__option${isDisabled ? ' is-disabled' : ''}"
                      data-choice-chart-type="${type}"
                      data-choice-chart-scope="${escapeHtml(stateScope)}"
                      data-target="${safeTarget}"
                      role="option"
                      aria-selected="${type === chartType ? 'true' : 'false'}"
                      ${isDisabled ? 'disabled' : ''}>
                ${escapeHtml(CHOICE_CHART_TYPE_LABELS[type])}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  ` : '';

  const sortHtml = showSort ? `
    <label class="viz-control-checkbox">
      <input type="checkbox" data-choice-sort-by-rate ${isMulti ? 'data-is-multi="true"' : ''} data-target="${safeTarget}" ${sortByRate ? 'checked' : ''}>
      <span class="viz-control-checkbox__label">응답 비율이 높은 순서로 정렬</span>
    </label>
  ` : '';

  return `<div class="viz-controls">${chartTypeHtml}${sortHtml}</div>`;
}

/* ---------- 객관식 단일: 세로 막대 차트 ---------- */
/**
 * 단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.
 */
function buildSingleChoiceVerticalBarChartHtml(data) {
  const rows = data.totalResults;
  const maxPctValue = rows.reduce((max, row) => Math.max(max, row.pct || 0), 0);
  const axisMax = Math.max(20, Math.ceil(maxPctValue / 20) * 20);
  const guideMarks = [];
  for (let mark = 20; mark <= axisMax; mark += 20) guideMarks.push(mark);
  const colsHtml = rows.map(r => {
    const pct = Math.max(0, Math.min(axisMax, r.pct));
    const scaledPct = axisMax > 0 ? (pct / axisMax) * 100 : 0;
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'basic-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    return `
      <div class="vertical-chart-col single-vbar-col" style="--single-vbar-pct:${scaledPct}%; --single-vbar-raw-pct:${pct}%;">
        <div class="single-vbar-value">${formatPercent(r.pct)}</div>
        <div class="single-vbar-track">
          <div class="single-vbar-fill" data-tip="${tip}"></div>
        </div>
      </div>
    `;
  }).join('');
  const labelsHtml = rows.map(r => {
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'basic-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    return `<div class="vertical-chart-label" title="${escapeHtml(r.option)}" data-tip="${tip}">${escapeHtml(r.option)}</div>`;
  }).join('');
  const guidesHtml = guideMarks.map(mark => `
    <div class="vertical-chart-guide" style="bottom:${(mark / axisMax) * 100}%;">
      <span class="vertical-chart-guide-line"></span>
      <span class="vertical-chart-guide-label">${mark}%</span>
    </div>
  `).join('');
  return `
    <div class="vertical-chart single-vbar-chart">
      <div class="vertical-chart-plot single-vbar-plot">
        <div class="vertical-chart-guides" aria-hidden="true">${guidesHtml}</div>
        <div class="vertical-chart-track-row">${colsHtml}</div>
      </div>
      <div class="vertical-chart-label-row">${labelsHtml}</div>
    </div>
  `;
}

/* ---------- 객관식 단일: 가로 100% 누적 - 그룹별 ---------- */
/**
 * 그룹 간 비교(가로/세로 막대 등) HTML을 생성합니다.
 */
function buildGroupCompareStack100ChartHtml(data, hiddenGroups = new Set()) {
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const options = data.totalResults || [];
  const buildRowHtml = (groupLabel, results, totalN, isOverall = false) => {
    const widths = options.map(opt => {
      const result = (results || []).find(r => r.option === opt.option) || { pct: 0, count: 0 };
      return Math.max(0, Math.min(100, result.pct || 0));
    });
    const firstNonZero = widths.findIndex(width => width > 0);
    const lastNonZero = widths.reduce((acc, width, index) => width > 0 ? index : acc, -1);
    const segmentsHtml = options.map((opt, i) => {
      const color = getOptionPaletteColor(data, opt.option);
      const result = (results || []).find(r => r.option === opt.option) || { pct: 0, count: 0 };
      const width = widths[i];
      const tip = encodeURIComponent(JSON.stringify({
        kind: 'compare-bar',
        groupLabel,
        option: opt.option,
        pct: result.pct || 0,
        count: result.count || 0
      }));
      const valueHtml = width >= 6 ? `<span class="stack100-segment-value">${formatPercent(result.pct)}</span>` : '';
      const edgeClass = `${i === firstNonZero ? ' is-first' : ''}${i === lastNonZero ? ' is-last' : ''}`;
      return `<div class="stack100-segment ${width < 6 ? 'is-narrow' : ''}${edgeClass}" style="flex:0 0 ${width}%; background:${color};" data-tip="${tip}">${valueHtml}</div>`;
    }).join('');
    return `
      <div class="lane-group-row">
        <div class="lane-group-label">${escapeHtml(groupLabel)}</div>
        <div class="lane-group-cell">
          <div class="stack100-track">${segmentsHtml}</div>
        </div>
      </div>
    `;
  };

  const overallRowHtml = buildRowHtml('응답자 전체', data.totalResults || [], data.totalN, true);
  const groupRowsHtml = displayGroups.map(group => buildRowHtml(group.label, group.results || [], group.n || 0)).join('');

  return `
    <div class="lane-group-chart">
      ${displayGroups.length === 0
        ? '<div class="result-empty">표시할 그룹이 없습니다.</div>'
        : `${overallRowHtml}<div class="lane-group-divider"></div>${groupRowsHtml}`}
    </div>
  `;
}

/**
 * 100% 스택 막대 등 누적 비교 HTML을 생성합니다.
 */
function buildStack100GroupLegendHtml(data, hiddenGroups) {
  const options = data.totalResults || [];
  const optionItems = options.map((opt, i) => {
    const color = getOptionPaletteColor(data, opt.option);
    return `<div class="legend-item is-static"><span class="legend-swatch" style="background:${color}"></span><span title="${escapeHtml(opt.option)}">${escapeHtml(opt.option)}</span></div>`;
  }).join('');

  const groupItems = buildGroupedLegendRowsHtml(data, hiddenGroups);
  if (!groupItems) {
    return `<aside class="legend-panel"><div class="legend is-static">${optionItems}</div></aside>`;
  }

  const criterionLabel = data.criterionLabel || null;
  const groupConfigTargetLabel = getGroupConfigTargetLabel(data);

  return `
    <aside class="legend-panel">
      <div class="legend is-static">${optionItems}</div>
      <div class="lane-group-legend-divider stack100-group-section"></div>
      <div class="legend stack100-group-section" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">${groupItems}</div>
      <div class="legend-actions stack100-group-section" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">
        <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
        <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
        ${criterionLabel ? `<button type="button" class="legend-action-btn" data-open-group-config="true" data-target="${escapeHtml(groupConfigTargetLabel)}" data-criterion="${escapeHtml(criterionLabel)}">그룹 편집</button>` : ''}
      </div>
    </aside>
  `;
}

/* ---------- 객관식 단일: 가로 100% 누적 ---------- */
/**
 * 100% 스택 막대 등 누적 비교 HTML을 생성합니다.
 */
function buildStacked100ChartHtml(data) {
  const rows = data.totalResults;
  const widths = rows.map(row => Math.max(0, Math.min(100, row.pct)));
  const firstNonZero = widths.findIndex(width => width > 0);
  const lastNonZero = widths.reduce((acc, width, index) => width > 0 ? index : acc, -1);
  const segmentsHtml = rows.map((r, i) => {
    const width = widths[i];
    const color = getOptionPaletteColor(data, r.option);
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'basic-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    const valueHtml = width >= 6 ? `<span class="stack100-segment-value">${formatPercent(r.pct)}</span>` : '';
    const edgeClass = `${i === firstNonZero ? ' is-first' : ''}${i === lastNonZero ? ' is-last' : ''}`;
    return `
      <div class="stack100-segment ${width < 6 ? 'is-narrow' : ''}${edgeClass}"
           style="flex:0 0 ${width}%; background:${color};"
           data-tip="${tip}">${valueHtml}</div>
    `;
  }).join('');
  const labelHtml = rows.map((r, i) => {
    const width = Math.max(0, Math.min(100, r.pct));
    return `
      <div class="stack100-label-slot ${width < 12 ? 'is-narrow' : ''}" style="flex:0 0 ${width}%;">
        <span class="stack100-label-text">${escapeHtml(r.option)}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="stack100-chart">
      <div class="stack100-track">${segmentsHtml}</div>
      <div class="stack100-label-row">${labelHtml}</div>
    </div>
  `;
}

/**
 * 단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.
 */
function buildChoiceOptionLegendHtml(data) {
  const baseOrder = data.originalOptionOrder || data.optionOrder || [];
  const rowsByOption = new Map((data.totalResults || []).map(row => [row.option, row]));
  const legendRows = baseOrder
    .map(option => rowsByOption.get(option))
    .filter(Boolean);
  const items = legendRows.map((row) => {
    const color = getOptionPaletteColor(data, row.option);
    return `
      <div class="legend-item is-static">
        <span class="legend-swatch" style="background:${color}"></span>
        <span title="${escapeHtml(row.option)}">${escapeHtml(row.option)}</span>
      </div>
    `;
  }).join('');

  return `
    <aside class="legend-panel">
      <div class="legend is-static" data-target="${escapeHtml(data.targetLabel)}" data-mode="static">${items}</div>
    </aside>
  `;
}

/* ---------- 원/파이 공통 렌더러 ---------- */
// rows: [{ label, pct, count, color }]
/**
 * 파이 차트 SVG/HTML을 생성합니다.
 */
function buildPieChartFromRows(rows) {
  const cx = 140, cy = 140, r = 140;
  const visibleRows = rows.filter(row => (row.pct || 0) > 0);
  if (visibleRows.length === 0) return '<div class="result-empty">표시할 데이터가 없습니다.</div>';
  const totalPct = visibleRows.reduce((s, row) => s + (row.pct || 0), 0) || 100;
  let angleAcc = -Math.PI / 2;
  const slices = visibleRows.map(row => {
    const fraction = (row.pct || 0) / totalPct;
    if (!Number.isFinite(fraction) || fraction <= 0) return null;
    const startAngle = angleAcc;
    const endAngle = angleAcc + fraction * Math.PI * 2;
    angleAcc = endAngle;
    const tipPayload = Number.isFinite(Number(row.score))
      ? { kind: 'scale-segment', score: row.score, scoreLabel: row.scoreLabel != null ? row.scoreLabel : row.label, pct: row.pct, count: row.count }
      : { kind: 'basic-bar', option: row.label, pct: row.pct, count: row.count };
    const tip = encodeURIComponent(JSON.stringify(tipPayload));
    const midAngle = startAngle + ((endAngle - startAngle) / 2);
    const placeOutside = fraction < 0.08;
    const insideX = cx + (r * 0.64) * Math.cos(midAngle);
    const insideY = cy + (r * 0.64) * Math.sin(midAngle);
    const lineStartX = cx + (r * 0.9) * Math.cos(midAngle);
    const lineStartY = cy + (r * 0.9) * Math.sin(midAngle);
    const lineMidX = cx + (r + 12) * Math.cos(midAngle);
    const lineMidY = cy + (r + 12) * Math.sin(midAngle);
    const lineEndX = cx + (r + 28) * Math.cos(midAngle);
    const lineEndY = cy + (r + 28) * Math.sin(midAngle);
    const textAnchor = Math.cos(midAngle) >= 0 ? 'start' : 'end';
    const textX = lineEndX + (textAnchor === 'start' ? 4 : -4);
    const label = placeOutside
      ? `
        <g class="pie-label-group is-outside">
          <polyline class="pie-label-line" points="${lineStartX.toFixed(2)},${lineStartY.toFixed(2)} ${lineMidX.toFixed(2)},${lineMidY.toFixed(2)} ${lineEndX.toFixed(2)},${lineEndY.toFixed(2)}"></polyline>
          <text class="pie-label is-outside" x="${textX.toFixed(2)}" y="${lineEndY.toFixed(2)}" text-anchor="${textAnchor}">
            <tspan class="pie-label-value">${formatPercent(row.pct)}</tspan>
          </text>
        </g>
      `
      : `
        <text class="pie-label is-inside" x="${insideX.toFixed(2)}" y="${insideY.toFixed(2)}" text-anchor="middle">
          <tspan class="pie-label-value" x="${insideX.toFixed(2)}" dy="0.35em">${formatPercent(row.pct)}</tspan>
        </text>
      `;
    if (fraction >= 0.999) {
      return {
        slice: `<circle class="pie-slice" cx="${cx}" cy="${cy}" r="${r}" fill="${row.color}" data-tip="${tip}"></circle>`,
        label: `
          <text class="pie-label is-inside is-full" x="${cx}" y="${cy}" text-anchor="middle">
            <tspan class="pie-label-value" x="${cx}" dy="0.35em">${formatPercent(row.pct)}</tspan>
          </text>
        `
      };
    }
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
    return {
      slice: `<path class="pie-slice" d="${path}" fill="${row.color}" data-tip="${tip}"></path>`,
      label
    };
  }).filter(Boolean);
  const slicesHtml = slices.map(item => item.slice).join('');
  const labelsHtml = slices.map(item => item.label).join('');
  return `
    <div class="pie-chart">
      <div class="pie-svg-wrap">
        <svg class="pie-svg" viewBox="0 0 280 280" role="img" aria-label="원형(파이) 그래프">
          ${slicesHtml}
          ${labelsHtml}
        </svg>
      </div>
    </div>
  `;
}

/* ---------- 객관식 단일: 원/파이 ---------- */
/**
 * 파이 차트 SVG/HTML을 생성합니다.
 */
function buildPieChartHtml(data) {
  const rows = (data.totalResults || []).map((row) => ({
    label: row.option,
    pct: row.pct,
    count: row.count,
    color: getOptionPaletteColor(data, row.option)
  }));
  return buildPieChartFromRows(rows);
}

/* ---------- 객관식 척도: 원/파이 ---------- */
/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScalePieChartHtml(data) {
  const maxScore = data.scoreRange.length;
  const rows = (data.scoreResults || []).map(result => ({
    score: result.score,
    scoreLabel: result.label,
    label: result.label || `${result.score}점`,
    pct: result.pct,
    count: result.count,
    color: getScaleColor(result.score, maxScore)
  }));
  return buildPieChartFromRows(rows);
}

/* ---------- 주관식 비율 배분: 원/파이 ---------- */
/**
 * 비율 배분 문항 차트·스택·표 HTML을 생성합니다.
 */
function buildRatioAllocationPieChartHtml(data) {
  const rows = (data.totalResults || []).map((result, index) => ({
    label: result.option,
    pct: result.pct,
    count: result.count,
    color: allocationColor(index)
  }));
  return buildPieChartFromRows(rows);
}

/* ---------- 주관식 비율 배분: 파이 뷰 범례 ---------- */
/**
 * 비율 배분 문항 차트·스택·표 HTML을 생성합니다.
 */
function buildRatioAllocationItemLegendHtml(data) {
  const items = (data.totalResults || []).map((result, index) => `
    <div class="legend-item is-static">
      <span class="legend-swatch" style="background:${allocationColor(index)}"></span>
      <span title="${escapeHtml(result.option)}">${escapeHtml(result.option)}</span>
    </div>
  `).join('');
  return `
    <aside class="legend-panel">
      <div class="legend is-static" data-target="${escapeHtml(data.targetLabel)}" data-mode="static">${items}</div>
    </aside>
  `;
}

/**
 * 단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.
 */
function buildSingleChoiceChartByType(data, chartType) {
  if (chartType === 'bar_vertical') return buildSingleChoiceVerticalBarChartHtml(data);
  if (chartType === 'bar_horizontal_100') return buildStacked100ChartHtml(data);
  if (chartType === 'pie') return buildPieChartHtml(data);
  return buildBasicChartHtml(data);
}

/**
 * 필요 시 DOM 요소/전역 훅을 한 번만 생성·초기화합니다.
 */
function ensureGroupConfigModal() {
  let modal = document.getElementById('group-config-modal');
  if (modal) return modal;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal-backdrop" id="group-config-modal" role="dialog" aria-modal="true" aria-labelledby="group-config-modal-title">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" id="group-config-modal-title">범례 그룹 편집</div>
          <button class="modal-close" id="close-group-config-btn" aria-label="닫기">
            <img class="modal-close-icon" src="assets/icons/close_wght600fill1_40px.svg" alt="">
          </button>
        </div>
        <div class="modal-body">
          <div id="group-config-list" class="legend group-config-list"></div>
        </div>
        <div class="modal-footer group-config-footer">
          <button type="button" class="modal-action-btn group-config-create-btn" id="group-config-add-btn">
            <img class="group-config-create-icon" src="assets/icons/add_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="">
            <span>그룹 만들기</span>
          </button>
          <div class="group-config-footer-actions">
            <button type="button" class="modal-action-btn group-config-reset-btn" id="group-config-reset-btn">전체 해제</button>
            <button type="button" class="modal-action-btn primary group-config-apply-btn" id="group-config-apply-btn">편집 완료</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper.firstElementChild);
  return document.getElementById('group-config-modal');
}

/**
 * 그룹 정의 배열을 깊은 복사합니다.
 */
function cloneGroupDefs(defs) {
  return Array.isArray(defs) ? defs.map(def => ({ ...def })) : [];
}

/**
 * 응답→그룹 배정 맵을 복제합니다.
 */
function cloneGroupAssignments(assignments) {
  return new Map(assignments ? Array.from(assignments.entries()) : []);
}

/**
 * 새 그룹의 기본 표시 이름을 만듭니다.
 */
function getDefaultGroupName(defs) {
  const used = new Set((defs || []).map(def => String(def.name || '').trim()).filter(Boolean));
  let index = 1;
  while (used.has(`그룹${index}`)) index += 1;
  return `그룹${index}`;
}

/**
 * 모달에서 비교/저장할 그룹 설정 상태 객체를 만듭니다.
 */
function buildComparableGroupConfigState(defs, assignments) {
  const normalizedDefs = (defs || []).map((def, index) => ({
    id: String(def.id || ''),
    name: String(def.name || '').trim() || `그룹${index + 1}`
  }));
  const allowedIds = new Set(normalizedDefs.map(def => def.id));
  const normalizedAssignments = Array.from(assignments ? assignments.entries() : [])
    .filter(([groupValue, groupId]) => groupValue && groupId && allowedIds.has(groupId))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ko'));
  return JSON.stringify({
    defs: normalizedDefs,
    assignments: normalizedAssignments
  });
}

/**
 * 그룹 ID에 배정된 응답 값 목록을 반환합니다.
 */
function getGroupMembers(state, groupId) {
  if (!state || !groupId) return [];
  return (state.groupOptions || []).filter(option => state.draftAssignments.get(option.value) === groupId);
}

/**
 * 편집 중인 그룹 색상을 반환합니다.
 */
function getDraftGroupColor(state, groupId) {
  if (!state || !groupId) return CUSTOM_GROUP_PALETTE[0];
  const defs = state.draftDefs || [];
  const index = defs.findIndex(def => def.id === groupId);
  return CUSTOM_GROUP_PALETTE[(index < 0 ? 0 : index) % CUSTOM_GROUP_PALETTE.length];
}

/**
 * 그룹 이름 입력을 확정(트림·빈 이름 처리)합니다.
 */
function finalizeGroupConfigGroupName(state, groupId) {
  if (!state || !groupId) return;
  const target = (state.draftDefs || []).find(def => def.id === groupId);
  if (!target) return;
  const trimmed = String(target.name || '').trim();
  target.name = trimmed || getDefaultGroupName((state.draftDefs || []).filter(def => def.id !== groupId));
}

/**
 * 저장 전 그룹 설정에 변경이 있는지 검사합니다.
 */
function hasGroupConfigChanges(state) {
  if (!state) return false;
  return buildComparableGroupConfigState(state.initialDefs, state.initialAssignments) !== buildComparableGroupConfigState(state.draftDefs, state.draftAssignments);
}

/**
 * 그룹 이름 입력란에 포커스를 둡니다.
 */
function focusGroupConfigNameInput(state) {
  if (!state || !state.focusGroupId) return;
  const input = document.querySelector(`#group-config-list input[data-group-name-input="${CSS.escape(state.focusGroupId)}"]`);
  if (!input) return;
  input.focus();
  if (state.selectOnFocus !== false) input.select();
  state.focusGroupId = null;
  state.selectOnFocus = false;
}

/**
 * 모달을 닫고 포커스를 복구합니다.
 */
function closeGroupConfigModal() {
  const modal = document.getElementById('group-config-modal');
  if (!modal) return;
  modal.classList.remove('show');
  resultState.groupConfigModalState = null;
}

/**
 * 같은 기준으로 묶인 결과 대상 문항 라벨들을 반환합니다.
 */
function getCurrentResultTargetLabelsForCustomGroup(criterionLabel) {
  if (!criterionLabel) return [];
  const targetLabels = getTargetChipLabels();
  if (!Array.isArray(targetLabels) || targetLabels.length === 0) return [];
  const filteredRowIndexes = getFilteredRowIndexes();
  const filteredRows = getFilteredLabelDataRows();
  const filteredValueRows = getFilteredValueDataRows();
  return targetLabels.filter(label => {
    const data = aggregateResultQuestion(label, criterionLabel, filteredRows, filteredValueRows, filteredRowIndexes);
    return !!(data && data.groupResults && data.criterionLabel === criterionLabel);
  });
}

/**
 * 드래그 하이라이트 클래스를 제거합니다.
 */
function clearGroupConfigDropHighlight(root = document) {
  root.querySelectorAll('.group-config-group.is-drop-target').forEach(el => {
    el.classList.remove('is-drop-target');
  });
}

/**
 * 사용자 정의 그룹 설정 모달 내용을 DOM에 그립니다.
 */
function renderGroupConfigModal() {
  const state = resultState.groupConfigModalState;
  const modal = ensureGroupConfigModal();
  const listEl = document.getElementById('group-config-list');
  const addBtn = document.getElementById('group-config-add-btn');
  const applyBtn = document.getElementById('group-config-apply-btn');
  const resetBtn = document.getElementById('group-config-reset-btn');
  if (!modal || !listEl || !state) return;

  const assignedByGroupId = new Map();
  for (const def of (state.draftDefs || [])) {
    assignedByGroupId.set(def.id, getGroupMembers(state, def.id));
  }
  const groupedOptionValues = new Set();
  const listParts = [];

  (state.groupOptions || []).forEach(option => {
    const groupId = state.draftAssignments.get(option.value);
    if (groupId) {
      if (groupedOptionValues.has(option.value)) return;
      const def = (state.draftDefs || []).find(item => item.id === groupId);
      const members = assignedByGroupId.get(groupId) || [];
      members.forEach(member => groupedOptionValues.add(member.value));
      if (!def || members.length === 0) return;

      const isEditing = state.editingGroupId === def.id;
      const isCollapsed = state.collapsedGroupIds.has(def.id);
      const nameValue = escapeHtml(String(def.name || ''));
      const groupColor = getDraftGroupColor(state, def.id);
      const membersHtml = members.map(member => `
        <div class="group-config-group-member legend-item is-static">
          <span class="group-config-group-member-main">
            <span class="legend-swatch" style="background:${member.color}"></span>
            <span title="${escapeHtml(member.label)}">${escapeHtml(member.label)}</span>
          </span>
          <button type="button" class="group-config-icon-btn" data-group-config-remove-member="${escapeHtml(def.id)}" data-group-config-member-value="${escapeHtml(member.value)}" aria-label="항목 삭제" title="그룹에서 제외하기">
            <img src="assets/icons/remove_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="">
          </button>
        </div>
      `).join('');

      listParts.push(`
        <div class="group-config-group ${isCollapsed ? 'is-collapsed' : ''}" data-group-id="${escapeHtml(def.id)}">
          <div class="group-config-group-header">
            <div class="group-config-group-main">
              <button type="button" class="group-config-accordion-btn" data-group-config-toggle="${escapeHtml(def.id)}" aria-label="그룹 접기">
                <img class="group-config-accordion-icon" src="assets/icons/keyboard_arrow_down_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="">
              </button>
              <span class="legend-swatch group-config-group-swatch" style="background:${groupColor}"></span>
              ${isEditing
                ? `<input type="text" class="group-config-group-name-input" data-group-name-input="${escapeHtml(def.id)}" value="${nameValue}" maxlength="20">`
                : `<div class="group-config-group-name" title="${nameValue}">${nameValue || escapeHtml(getDefaultGroupName((state.draftDefs || []).filter(item => item.id !== def.id)))}</div>`}
              <button type="button" class="group-config-icon-btn" data-group-config-edit="${escapeHtml(def.id)}" aria-label="이름 수정" title="이름 수정">
                <img src="assets/icons/edit_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="">
              </button>
            </div>
            <button type="button" class="group-config-icon-btn" data-group-config-delete="${escapeHtml(def.id)}" aria-label="그룹 해제" title="그룹 해제하기">
              <img src="assets/icons/link_off_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="">
            </button>
          </div>
          <div class="group-config-group-body">
            ${membersHtml}
          </div>
        </div>
      `);
      return;
    }

    const selected = state.selectedValues.has(option.value);
    listParts.push(`
      <div class="group-config-option-row" draggable="true" data-group-config-drag-option="${escapeHtml(option.value)}">
        <label class="legend-item" data-group-config-option="${escapeHtml(option.value)}">
          <input type="checkbox" data-group-config-select="${escapeHtml(option.value)}" ${selected ? 'checked' : ''}>
          <span class="legend-swatch" style="background:${option.color}"></span>
          <span title="${escapeHtml(option.label)}">${escapeHtml(option.label)}</span>
        </label>
      </div>
    `);
  });

  listEl.innerHTML = listParts.join('') || '<div class="group-config-empty">표시할 범례 항목이 없습니다.</div>';

  listEl.querySelectorAll('[data-group-config-select]').forEach(input => {
    input.addEventListener('change', () => {
      const groupValue = input.dataset.groupConfigSelect;
      if (!groupValue) return;
      if (input.checked) state.selectedValues.add(groupValue);
      else state.selectedValues.delete(groupValue);
      renderGroupConfigModal();
    });
  });

  listEl.querySelectorAll('[data-group-config-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.groupConfigToggle;
      if (!groupId) return;
      if (state.collapsedGroupIds.has(groupId)) state.collapsedGroupIds.delete(groupId);
      else state.collapsedGroupIds.add(groupId);
      renderGroupConfigModal();
    });
  });

  listEl.querySelectorAll('[data-group-config-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.groupConfigEdit;
      if (!groupId) return;
      if (state.editingGroupId && state.editingGroupId !== groupId) {
        finalizeGroupConfigGroupName(state, state.editingGroupId);
      }
      state.editingGroupId = groupId;
      state.focusGroupId = groupId;
      state.selectOnFocus = true;
      state.collapsedGroupIds.delete(groupId);
      renderGroupConfigModal();
    });
  });

  listEl.querySelectorAll('[data-group-config-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.groupConfigDelete;
      if (!groupId) return;
      state.draftDefs = (state.draftDefs || []).filter(def => def.id !== groupId);
      for (const [groupValue, assignedId] of Array.from(state.draftAssignments.entries())) {
        if (assignedId === groupId) state.draftAssignments.delete(groupValue);
      }
      state.selectedValues.clear();
      state.collapsedGroupIds.delete(groupId);
      if (state.editingGroupId === groupId) state.editingGroupId = null;
      renderGroupConfigModal();
    });
  });

  listEl.querySelectorAll('[data-group-config-remove-member]').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.groupConfigRemoveMember;
      const groupValue = btn.dataset.groupConfigMemberValue;
      if (!groupId || !groupValue) return;
      state.draftAssignments.delete(groupValue);
      state.selectedValues.delete(groupValue);
      if (getGroupMembers(state, groupId).length === 0) {
        state.draftDefs = (state.draftDefs || []).filter(def => def.id !== groupId);
        state.collapsedGroupIds.delete(groupId);
        if (state.editingGroupId === groupId) state.editingGroupId = null;
      }
      renderGroupConfigModal();
    });
  });

  listEl.querySelectorAll('[data-group-config-drag-option]').forEach(row => {
    row.addEventListener('dragstart', e => {
      const optionValue = row.dataset.groupConfigDragOption;
      if (!optionValue) return;
      state.draggingOptionValue = optionValue;
      row.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', optionValue);
        applyDragImage(e, row);
      }
    });
    row.addEventListener('dragend', () => {
      state.draggingOptionValue = null;
      row.classList.remove('is-dragging');
      clearGroupConfigDropHighlight(listEl);
    });
  });

  listEl.querySelectorAll('.group-config-group').forEach(groupEl => {
    groupEl.addEventListener('dragover', e => {
      if (!state.draggingOptionValue) return;
      e.preventDefault();
      clearGroupConfigDropHighlight(listEl);
      groupEl.classList.add('is-drop-target');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    groupEl.addEventListener('dragleave', e => {
      if (!groupEl.contains(e.relatedTarget)) {
        groupEl.classList.remove('is-drop-target');
      }
    });
    groupEl.addEventListener('drop', e => {
      if (!state.draggingOptionValue) return;
      e.preventDefault();
      const groupId = groupEl.dataset.groupId;
      const optionValue = state.draggingOptionValue;
      clearGroupConfigDropHighlight(listEl);
      if (!groupId || !optionValue) return;
      state.draftAssignments.set(optionValue, groupId);
      state.selectedValues.delete(optionValue);
      state.draggingOptionValue = null;
      state.collapsedGroupIds.delete(groupId);
      renderGroupConfigModal();
    });
  });

  listEl.querySelectorAll('[data-group-name-input]').forEach(input => {
    const groupId = input.dataset.groupNameInput;
    if (!groupId) return;
    input.addEventListener('input', () => {
      const target = (state.draftDefs || []).find(def => def.id === groupId);
      if (target) target.name = input.value;
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      finalizeGroupConfigGroupName(state, groupId);
      state.editingGroupId = null;
      renderGroupConfigModal();
    });
    input.addEventListener('blur', () => {
      finalizeGroupConfigGroupName(state, groupId);
      if (state.editingGroupId === groupId) state.editingGroupId = null;
      renderGroupConfigModal();
    });
  });

  if (addBtn) addBtn.disabled = state.selectedValues.size === 0;
  if (applyBtn) applyBtn.disabled = !hasGroupConfigChanges(state);
  if (resetBtn) resetBtn.disabled = ((state.draftDefs || []).length === 0 && state.draftAssignments.size === 0);

  setTimeout(() => focusGroupConfigNameInput(state), 0);
}

/**
 * 모달을 열고 초기 상태를 채웁니다.
 */
function openGroupConfigModal(targetLabel, criterionLabel) {
  if (!targetLabel || !criterionLabel) return;
  const data = aggregateResultQuestion(targetLabel, criterionLabel, getFilteredLabelDataRows(), getFilteredValueDataRows(), getFilteredRowIndexes());
  const groupOptions = (data && Array.isArray(data.groupResults))
    ? data.groupResults
        .filter(group => group && group.value)
        .map(group => ({
          value: group.value,
          label: group.label || group.value,
          color: getGroupColor(data.groupResults, group.value)
        }))
    : [];
  const defs = cloneGroupDefs(resultState.customGroupDefs.get(criterionLabel) || []);
  const assignments = cloneGroupAssignments(resultState.customGroupAssignments.get(criterionLabel) || new Map());
  const validOptionValues = new Set(groupOptions.map(option => option.value));
  for (const [groupValue, groupId] of Array.from(assignments.entries())) {
    if (!validOptionValues.has(groupValue) || !defs.some(def => def.id === groupId)) assignments.delete(groupValue);
  }
  const usedGroupIds = new Set(assignments.values());
  const activeDefs = defs.filter(def => usedGroupIds.has(def.id));
  resultState.groupConfigModalState = {
    targetLabel,
    criterionLabel,
    groupOptions,
    initialDefs: cloneGroupDefs(activeDefs),
    initialAssignments: cloneGroupAssignments(assignments),
    draftDefs: cloneGroupDefs(activeDefs),
    draftAssignments: cloneGroupAssignments(assignments),
    selectedValues: new Set(),
    editingGroupId: null,
    draggingOptionValue: null,
    collapsedGroupIds: new Set(),
    focusGroupId: null,
    selectOnFocus: false
  };
  const modal = ensureGroupConfigModal();
  renderGroupConfigModal();
  modal.classList.add('show');
}

/**
 * 모달 DOM 이벤트와 키보드 접근성을 연결합니다.
 */
function setupGroupConfigModal() {
  const modal = ensureGroupConfigModal();
  const closeBtn = document.getElementById('close-group-config-btn');
  const addBtn = document.getElementById('group-config-add-btn');
  const applyBtn = document.getElementById('group-config-apply-btn');
  const resetBtn = document.getElementById('group-config-reset-btn');

  if (closeBtn) closeBtn.addEventListener('click', closeGroupConfigModal);
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeGroupConfigModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeGroupConfigModal();
  });

  if (addBtn) addBtn.addEventListener('click', () => {
    const state = resultState.groupConfigModalState;
    if (!state) return;
    if (state.editingGroupId) {
      finalizeGroupConfigGroupName(state, state.editingGroupId);
      state.editingGroupId = null;
    }
    if (state.selectedValues.size === 0) return;
    const nextId = nextCustomGroupId(state.criterionLabel, state.draftDefs);
    const nextName = getDefaultGroupName(state.draftDefs);
    state.draftDefs.push({ id: nextId, name: nextName });
    state.selectedValues.forEach(groupValue => state.draftAssignments.set(groupValue, nextId));
    state.selectedValues.clear();
    state.collapsedGroupIds.delete(nextId);
    state.editingGroupId = nextId;
    state.focusGroupId = nextId;
    state.selectOnFocus = true;
    renderGroupConfigModal();
  });

  if (resetBtn) resetBtn.addEventListener('click', () => {
    const state = resultState.groupConfigModalState;
    if (!state) return;
    state.draftDefs = [];
    state.draftAssignments = new Map();
    state.selectedValues.clear();
    state.editingGroupId = null;
    state.draggingOptionValue = null;
    state.collapsedGroupIds.clear();
    state.focusGroupId = null;
    state.selectOnFocus = false;
    renderGroupConfigModal();
  });

  if (applyBtn) applyBtn.addEventListener('click', () => {
    const state = resultState.groupConfigModalState;
    if (!state) return;
    if (state.editingGroupId) {
      finalizeGroupConfigGroupName(state, state.editingGroupId);
      state.editingGroupId = null;
    }
    const appliedDefs = cloneGroupDefs(state.draftDefs).filter(def => getGroupMembers(state, def.id).length > 0);
    appliedDefs.forEach(def => {
      def.name = String(def.name || '').trim() || getDefaultGroupName(appliedDefs.filter(item => item.id !== def.id));
    });
    const allowedIds = new Set(appliedDefs.map(def => def.id));
    const appliedAssignments = new Map();
    for (const [groupValue, groupId] of state.draftAssignments.entries()) {
      if (allowedIds.has(groupId)) appliedAssignments.set(groupValue, groupId);
    }
    resultState.customGroupDefs.set(state.criterionLabel, appliedDefs);
    resultState.customGroupAssignments.set(state.criterionLabel, appliedAssignments);
    const hasAny = appliedAssignments.size > 0;
    const affectedTargetLabels = getCurrentResultTargetLabelsForCustomGroup(state.criterionLabel);
    const fallbackTargets = affectedTargetLabels.length > 0 ? affectedTargetLabels : [state.targetLabel];
    fallbackTargets.forEach(targetLabel => {
      if (hasAny) resultState.customGroupModes.add(targetLabel);
      else resultState.customGroupModes.delete(targetLabel);
      resultState.hiddenGroupKeys.set(targetLabel, new Set());
    });
    closeGroupConfigModal();
    renderResults();
  });
}

/* ---------- 섹션 dispatch ---------- */
/**
 * 사용자 정의 그룹으로 groupResults를 합산하는 헬퍼
 * - single-choice: group.results 합산
 * - multi-choice:  group.perOption 합산
 * - 그룹에 배정되지 않은 항목은 원본 범례로 유지됨
 */
function buildCustomGroupData(data) {
  const { criterionLabel, groupResults, optionOrder } = data;
  if (!criterionLabel || !groupResults || groupResults.length === 0) return null;
  const defs = resultState.customGroupDefs.get(criterionLabel) || [];
  const assignments = resultState.customGroupAssignments.get(criterionLabel) || new Map();
  if (defs.length === 0) return null;
  // 최소 1개 이상 배정된 그룹만 포함
  const hasAny = [...assignments.values()].some(v => v);
  if (!hasAny) return null;

  function mergeIntoGroup(groups, groupValue, label, color) {
    if (groups.length === 0) return null;
    const n = groups.reduce((s, g) => s + (g.n || 0), 0);
    const opts = optionOrder || [];
    // ratio-allocation
    if (data.visualType === 'ratio-allocation' && groups[0] && Array.isArray(groups[0].results)) {
      const results = opts.map(opt => {
        const pctSum = groups.reduce((sum, group) => {
          const found = Array.isArray(group.results)
            ? group.results.find(item => item.option === opt)
            : null;
          const groupN = Number(group.n || 0);
          return sum + (Number(found ? (found.pct || 0) : 0) * groupN);
        }, 0);
        return {
          option: opt,
          pct: n > 0 ? pctSum / n : 0,
          count: n
        };
      });
      return { value: groupValue, label, n, results, _customColor: color };
    }
    // rank
    if (data.visualType === 'rank' && groups[0] && Array.isArray(groups[0].ranking) && Array.isArray(groups[0].perOption)) {
      const rankCount = Number(data.rankCount || 0);
      const rankLabels = Array.isArray(data.rankLabels) ? data.rankLabels : [];
      const visibleOptions = Array.isArray(data.optionOrder) ? data.optionOrder : [];
      const perOption = visibleOptions.map(opt => {
        const perRank = Array.from({ length: rankCount }, (_, ri) => {
          const count = groups.reduce((sum, group) => {
            const found = Array.isArray(group.perOption)
              ? group.perOption.find(item => item.option === opt)
              : null;
            const rankEntry = found && Array.isArray(found.perRank) ? found.perRank[ri] : null;
            return sum + Number(rankEntry ? (rankEntry.count || 0) : 0);
          }, 0);
          return {
            rank: rankLabels[ri] || `${ri + 1}순위`,
            count,
            pct: n > 0 ? (count / n) * 100 : 0
          };
        });
        const score = perRank.reduce((sum, item, ri) => sum + (Number(item.count || 0) * getRankWeight(rankCount, ri)), 0);
        const totalCount = groups.reduce((sum, group) => {
          const found = Array.isArray(group.perOption)
            ? group.perOption.find(item => item.option === opt)
            : null;
          return sum + Number(found ? (found.totalCount || 0) : 0);
        }, 0);
        return {
          option: opt,
          score,
          weightedAverage: n > 0 ? score / n : 0,
          totalCount,
          totalPct: n > 0 ? (totalCount / n) * 100 : 0,
          perRank
        };
      });
      const sorted = [...visibleOptions].sort((a, b) => {
        const aAvg = (perOption.find(item => item.option === a) || {}).weightedAverage || 0;
        const bAvg = (perOption.find(item => item.option === b) || {}).weightedAverage || 0;
        if (bAvg !== aAvg) return bAvg - aAvg;
        return visibleOptions.indexOf(a) - visibleOptions.indexOf(b);
      });
      const ranking = [];
      let currentPos = 0;
      let lastScore = null;
      let seen = 0;
      sorted.forEach(opt => {
        seen += 1;
        const item = perOption.find(entry => entry.option === opt);
        const avg = item ? item.weightedAverage : 0;
        const score = item ? item.score : 0;
        if (lastScore === null || avg !== lastScore) {
          currentPos = seen;
          lastScore = avg;
        }
        ranking.push({ option: opt, position: currentPos, score, weightedAverage: avg });
      });
      return {
        value: groupValue,
        label,
        n,
        ranking,
        perOption,
        _customColor: color
      };
    }
    // single-choice
    if (groups[0] && Array.isArray(groups[0].results)) {
      const results = opts.map(opt => {
        const count = groups.reduce((s, g) => {
          const r = g.results.find(r => r.option === opt);
          return s + (r ? (r.count || 0) : 0);
        }, 0);
        return { option: opt, count, pct: n > 0 ? (count / n) * 100 : 0 };
      });
      return { value: groupValue, label, n, results, _customColor: color };
    }
    // multi-choice
    if (groups[0] && Array.isArray(groups[0].perOption)) {
      const perOption = opts.map(opt => {
        const count = groups.reduce((s, g) => {
          const r = g.perOption.find(r => r.option === opt);
          return s + (r ? (r.count || 0) : 0);
        }, 0);
        return { option: opt, count, pct: n > 0 ? (count / n) * 100 : 0 };
      });
      return { value: groupValue, label, n, perOption, _customColor: color };
    }
    // scale (raw)
    if (groups[0] && Array.isArray(groups[0].scoreResults) && !Array.isArray(groups[0].values)) {
      const scoreRange = Array.isArray(data.scoreRange) ? data.scoreRange : [];
      const scoreResults = scoreRange.map(score => {
        const first = groups.find(group => Array.isArray(group.scoreResults) && group.scoreResults.some(item => Number(item.score) === Number(score)));
        const sourceLabel = first
          ? (first.scoreResults.find(item => Number(item.score) === Number(score)) || {}).label
          : String(score);
        const count = groups.reduce((sum, group) => {
          const found = Array.isArray(group.scoreResults)
            ? group.scoreResults.find(item => Number(item.score) === Number(score))
            : null;
          return sum + Number(found ? (found.count || 0) : 0);
        }, 0);
        return {
          score,
          label: sourceLabel,
          count,
          pct: n > 0 ? (count / n) * 100 : 0
        };
      });
      const weightedSum = scoreResults.reduce((sum, item) => sum + (Number(item.score) * Number(item.count || 0)), 0);
      return {
        value: groupValue,
        label,
        n,
        mean: n > 0 ? weightedSum / n : 0,
        scoreResults,
        _customColor: color
      };
    }
    // scale (derived) / numeric-open
    if (groups[0] && Array.isArray(groups[0].values)) {
      const mergedValues = groups.flatMap(group => Array.isArray(group.values) ? group.values : []);
      if (data.visualType === 'scale' && data.isDerivedScale) {
        const derived = buildDerivedScaleResult(mergedValues, data.scoreRange || []);
        return {
          value: groupValue,
          label,
          n: derived.n,
          mean: derived.mean,
          min: derived.min,
          q1: derived.q1,
          median: derived.median,
          q3: derived.q3,
          max: derived.max,
          values: derived.values,
          scoreResults: derived.scoreResults,
          _customColor: color
        };
      }
      if (data.visualType === 'numeric-open') {
        const histogram = buildNumericHistogram(
          mergedValues,
          { interval: data.interval, start: data.start },
          { min: data.domainMin, max: data.domainMax }
        );
        return {
          value: groupValue,
          label,
          ...histogram,
          values: mergedValues,
          _customColor: color
        };
      }
    }
    return null;
  }

  const mergedById = new Map(defs.map(def => {
    const color = getCustomGroupColor(criterionLabel, def.id);
    const members = groupResults.filter(g => assignments.get(g.value) === def.id);
    return [def.id, mergeIntoGroup(members, def.id, def.name, color)];
  }).filter(([, group]) => !!group));

  const insertedGroupIds = new Set();
  const mergedGroupResults = groupResults.reduce((acc, group) => {
    const assignedId = assignments.get(group.value);
    if (!assignedId) {
      acc.push(group);
      return acc;
    }
    if (insertedGroupIds.has(assignedId)) return acc;
    const merged = mergedById.get(assignedId);
    if (merged) {
      acc.push(merged);
      insertedGroupIds.add(assignedId);
    }
    return acc;
  }, []);

  if (mergedGroupResults.length === 0) return null;
  return { ...data, groupResults: mergedGroupResults, originalGroupResults: groupResults, isCustomGroupView: true };
}

/**
 * 사용자 정의 그룹이 반영된 척도 비교 데이터를 만듭니다.
 */
function buildCustomScaleCompareData(compareData) {
  if (!compareData || !compareData.criterionLabel || !Array.isArray(compareData.groups) || compareData.groups.length === 0) return null;
  const defs = resultState.customGroupDefs.get(compareData.criterionLabel) || [];
  const assignments = resultState.customGroupAssignments.get(compareData.criterionLabel) || new Map();
  if (defs.length === 0) return null;
  const hasAny = [...assignments.values()].some(Boolean);
  if (!hasAny) return null;

  const mergedById = new Map(defs.map(def => {
    const members = compareData.groups.filter(group => assignments.get(group.value) === def.id);
    if (members.length === 0) return [def.id, null];
    const points = (compareData.questions || []).map((question, idx) => {
      const mergedPoint = members.reduce((acc, group) => {
        const point = Array.isArray(group.points) ? group.points[idx] : null;
        const pointN = Number(point ? (point.n || 0) : 0);
        const pointMean = Number(point ? (point.mean || 0) : 0);
        acc.n += pointN;
        acc.sum += pointMean * pointN;
        return acc;
      }, { n: 0, sum: 0 });
      return {
        questionLabel: question.label,
        mean: mergedPoint.n > 0 ? mergedPoint.sum / mergedPoint.n : 0,
        n: mergedPoint.n
      };
    });
    return [def.id, {
      value: def.id,
      label: def.name,
      color: getCustomGroupColor(compareData.criterionLabel, def.id),
      points
    }];
  }).filter(([, group]) => !!group));

  const insertedGroupIds = new Set();
  const groups = compareData.groups.reduce((acc, group) => {
    const assignedId = assignments.get(group.value);
    if (!assignedId) {
      acc.push(group);
      return acc;
    }
    if (insertedGroupIds.has(assignedId)) return acc;
    const merged = mergedById.get(assignedId);
    if (merged) {
      acc.push(merged);
      insertedGroupIds.add(assignedId);
    }
    return acc;
  }, []);

  if (groups.length === 0) return null;
  return { ...compareData, groups };
}

/**
 * 이 결과 데이터에 사용자 정의 그룹 합산을 적용할지 판단합니다.
 */
function shouldApplyCustomGroup(data) {
  if (!data || !data.criterionLabel || !Array.isArray(data.groupResults) || data.groupResults.length === 0) return false;
  const defs = resultState.customGroupDefs.get(data.criterionLabel) || [];
  const assignments = resultState.customGroupAssignments.get(data.criterionLabel) || new Map();
  if (defs.length === 0) return false;
  return [...assignments.values()].some(Boolean);
}


/**
 * 단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.
 */
function buildChoiceSectionHtml(data, rows) {
  if (!data) return '';
  const { codebookEntry, targetLabel, groupResults } = data;
  const displayLabel = data.displayLabel || targetLabel;
  const rank1stSourceLabel = data.rank1stSourceLabel || '';

  // 사용자 정의 그룹 보기 모드: 활성화 시 그룹을 사용자 정의 그룹으로 합산
  const customGroupOn = shouldApplyCustomGroup(data);
  const customGroupData = (customGroupOn && groupResults) ? buildCustomGroupData(data) : null;
  const baseData = customGroupData || data;

  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const displayHidden = hiddenGroups;

  const isSingleWithoutGroup = !data.isMulti && !groupResults;
  const sortByRate = data.isMulti
    ? !!resultState.multiChoiceSortByRate.get(targetLabel)
    : getSingleChoiceSortByRate(targetLabel);
  const displayData = sortByRate ? applyChoiceSortToData(baseData, true) : baseData;

  const showControls = isSingleWithoutGroup || data.isMulti || !!groupResults;
  const chartTypes = data.isMulti ? ['bar_horizontal', 'bar_vertical'] : CHOICE_CHART_TYPES;
  const chartType = getSingleChoiceChartType(targetLabel);
  const isMenuOpen = resultState.openChoiceMenus.has(targetLabel);
  const controlsHtml = showControls
    ? buildChoiceControlsHtml(targetLabel, {
        showChartType: true,
        chartType,
        chartTypes,
        disabledTypes: groupResults ? ['bar_vertical', 'pie'] : [],
        stateScope: 'single',
        showSort: true,
        sortByRate,
        isMulti: !!data.isMulti,
        isMenuOpen
      })
    : '';

  const legendData = customGroupData || data;
  const displayGroupsForBtn = legendData.groupResults ? getDisplayGroupResults(legendData.groupResults, displayHidden) : [];
  const canDualBar = !!groupResults && chartType === 'bar_horizontal' && displayGroupsForBtn.length === 2;
  const isDualBar = canDualBar && !!resultState.dualBarModes.get(targetLabel);

  const chartHtml = groupResults
    ? (chartType === 'bar_horizontal_100'
        ? buildGroupCompareStack100ChartHtml(displayData, displayHidden)
        : isDualBar
          ? buildDualHbarChartHtml(displayData, displayHidden)
          : buildGroupCompareChartHtml(displayData, displayHidden))
    : buildSingleChoiceChartByType(displayData, chartType);
  const legendHtml = groupResults
    ? (chartType === 'bar_horizontal_100'
        ? buildStack100GroupLegendHtml(legendData, hiddenGroups)
        : buildLegendHtml(legendData, hiddenGroups, { showDualBar: canDualBar, isDualBar }))
    : (isSingleWithoutGroup && chartType === 'pie' ? buildChoiceOptionLegendHtml(displayData) : '');
  const sidePanelHtml = buildResultSidePanelHtml(legendHtml, targetLabel);
  const tableNoteHtml = data.isMulti
    ? '<div class="result-table-note">객관식 중복 응답 문항으로, 보기별 비율 합계는 100%를 초과할 수 있습니다.</div>'
    : '';
  const tableHtml = buildDataTableHtml(displayData, displayHidden, tableNoteHtml);
  const otherResponseTarget = rank1stSourceLabel || targetLabel;
  const otherTexts = getOtherResponseTexts(otherResponseTarget, rows);
  resultState.otherResponseTexts.set(targetLabel, otherTexts);
  const fullText = buildQuestionFullHtml(codebookEntry);
  const visualClass = getResultVisualClass(!!groupResults || (isSingleWithoutGroup && chartType === 'pie'));
  const choiceActionsHtml = rank1stSourceLabel
    ? `<button type="button" class="rank1st-card-btn is-active" data-rank1st-card-toggle="${escapeHtml(rank1stSourceLabel)}">모든 순위 보기</button>`
    : '';
  const titleHtml = rank1stSourceLabel
    ? `<div class="result-question-label-row"><div class="result-question-label rank1st-derived-title">${escapeHtml(displayLabel)}</div>${choiceActionsHtml}</div>`
    : `<div class="result-question-label">${escapeHtml(displayLabel)}</div>`;

  return `
    <section class="result-section${rank1stSourceLabel ? ' rank1st-derived-section' : ''}" data-target="${escapeHtml(targetLabel)}" data-type="${data.isMulti ? 'multiple' : 'single'}"${rank1stSourceLabel ? ` data-rank1st-source="${escapeHtml(rank1stSourceLabel)}"` : ''}>
      ${buildResultHeaderHtml(titleHtml, fullText, controlsHtml)}
      <div class="${visualClass}">
        <div class="result-chart-col">${chartHtml}</div>
        ${sidePanelHtml}
      </div>
      ${tableHtml}
    </section>
  `;
}

/**
 * 단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.
 */
function buildScaleSection(data, rows) {
  if (!data) return '';
  const { codebookEntry, targetLabel, groupResults } = data;
  const customGroupOn = shouldApplyCustomGroup(data);
  const customGroupData = (customGroupOn && groupResults) ? buildCustomGroupData(data) : null;
  const baseData = customGroupData || data;
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const showTable = true;
  const viewMode = getScaleViewMode(targetLabel);
  const hideMidpoint = isScaleMidpointHidden(targetLabel);
  const showChartType = !baseData.isDerivedScale && !groupResults;
  const chartType = showChartType ? getScaleChartType(targetLabel) : 'bar_horizontal_100';
  const chartHtml = buildScaleChartHtml(baseData, hiddenGroups, viewMode, chartType);
  const showLegend = !baseData.isDerivedScale && !groupResults && (chartType === 'pie' || viewMode === 'distribution');
  const legendHtml = groupResults
    ? buildScaleGroupLegendHtml(baseData, hiddenGroups, viewMode)
    : (showLegend ? buildScaleLegendHtml(baseData) : '');
  const tableHtml = showTable ? buildDataTableHtml(baseData, hiddenGroups) : '';
  const fullText = buildQuestionFullHtml(codebookEntry);
  const sortByMeanGroup = isScaleGroupSortedByMean(targetLabel);
  const toggleHtml = baseData.isDerivedScale
    ? `<div class="viz-controls">${baseData.groupResults ? `<label class="viz-control-checkbox"><input type="checkbox" data-scale-group-sort-mean="true" data-target="${escapeHtml(targetLabel)}" ${sortByMeanGroup ? 'checked' : ''}><span class="viz-control-checkbox__label">평균값이 높은 순서로 정렬</span></label>` : ''}<div class="viz-controls-note">박스플롯 차트 보는 법: 수염은 응답값의 전체 범위, 박스는 전체 응답 중 가운데 50%가 모인 구간, 박스 중앙 마커(Q2)는 중앙값입니다.</div></div>`
    : buildScaleToggleHtml(targetLabel, viewMode, {
      showMidpointOption: canHideScaleMidpoint(baseData),
      hideMidpoint,
      showChartType,
      chartType,
      showMeanSortOption: !!baseData.groupResults,
      sortByMean: sortByMeanGroup,
      isGroupSort: true
    });
  const sidePanelHtml = buildResultSidePanelHtml(legendHtml, targetLabel);
  const visualClass = getResultVisualClass(true);

  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="scale">
      ${buildResultHeaderHtml(`<div class="result-question-label">${escapeHtml(targetLabel)}</div>`, fullText, toggleHtml)}
      <div class="${visualClass}">
        <div class="result-chart-col">${chartHtml}</div>
        ${sidePanelHtml}
      </div>
      ${tableHtml}
    </section>
  `;
}

/**
 * 여러 척도 문항 비교 표/차트 HTML을 생성합니다.
 */
function buildTargetScaleCompareSection(compareData) {
  if (!compareData || !compareData.baseData) return '';
  const customGroupOn = shouldApplyCustomGroup(compareData.baseData);
  const customCompareData = customGroupOn ? buildCustomScaleCompareData(compareData) : null;
  const baseCompareData = customCompareData || compareData;
  const displayCompareData = resultState.targetScaleCompareSortByMean
    ? sortScaleCompareQuestionsByMean(baseCompareData)
    : baseCompareData;
  const hiddenGroups = resultState.hiddenGroupKeys.get(displayCompareData.targetLabel) || new Set();
  const tableKey = TARGET_SCALE_COMPARE_VIEW_KEY;
  const showTable = true;
  const hasGroups = Array.isArray(displayCompareData.groups) && displayCompareData.groups.length > 0;
  let viewMode = resultState.scaleViewModes.get(TARGET_SCALE_COMPARE_VIEW_KEY) || 'mean';
  if (hasGroups && viewMode === 'distribution') {
    viewMode = 'mean';
    resultState.scaleViewModes.set(TARGET_SCALE_COMPARE_VIEW_KEY, 'mean');
  }
  const hideMidpoint = isScaleMidpointHidden(TARGET_SCALE_COMPARE_VIEW_KEY);
  const toggleHtml = buildScaleToggleHtml(TARGET_SCALE_COMPARE_VIEW_KEY, viewMode, {
    showMidpointOption: canHideScaleMidpoint(displayCompareData.baseData),
    hideMidpoint,
    disabledModes: hasGroups ? ['distribution'] : [],
    showMeanSortOption: true,
    sortByMean: !!resultState.targetScaleCompareSortByMean
  });
  const visibleGroupsForBtn = hasGroups ? getDisplayScaleCompareGroups(displayCompareData.groups, hiddenGroups) : [];
  const canDualBar = hasGroups && visibleGroupsForBtn.length === 2;
  const isDualBar = canDualBar && !!resultState.dualBarModes.get(displayCompareData.targetLabel);
  const compareSectionHtml = viewMode === 'distribution'
    ? buildScaleCompareDistributionSectionHtml(displayCompareData)
    : buildScaleCompareSectionHtml(displayCompareData, hiddenGroups, { showHeader: false, flush: true, isDualBar, showDualBar: canDualBar });
  const tableHtml = showTable ? buildScaleCompareDataTableHtml(displayCompareData, hiddenGroups) : '';
  return `
    <section class="result-section" data-target="${escapeHtml(displayCompareData.targetLabel)}" data-type="scale-compare">
      ${buildResultHeaderHtml('<div class="result-question-label">여러 문항 한 번에 비교하기</div>', '', toggleHtml)}
      ${compareSectionHtml}
      ${tableHtml}
    </section>
  `;
}

/**
 * 결과 패널에서 문항별 섹션(차트+표) HTML을 생성합니다.
 */
function buildResultSection(data, rows) {
  if (!data) return '';
  if (data.visualType === 'rank') return buildRankSection(data, rows);
  if (data.visualType === 'scale') return buildScaleSection(data, rows);
  if (data.visualType === 'numeric-open') return buildNumericOpenSection(data, rows);
  if (data.visualType === 'ratio-allocation') return buildRatioAllocationSection(data);
  if (data.visualType === 'text-open') return buildTextOpenSection(data);
  return buildChoiceSectionHtml(data, rows);
}

/**
 * 결과 패널에서 문항별 섹션(차트+표) HTML을 생성합니다.
 */
function buildUnsupportedSection(label, entry) {
  const fullText = buildQuestionFullHtml(entry);
  const typeText = entry ? entry.type : '알 수 없음';
  const messageHtml = `이 문항 유형(<strong>${escapeHtml(typeText)}</strong>)의 시각화는 아직 준비 중이에요.`;
  return `
    <section class="result-section" data-target="${escapeHtml(label)}">
      ${buildResultHeaderHtml(`<div class="result-question-label">${escapeHtml(label)}</div>`, fullText)}
      <div class="result-unsupported">
        ${messageHtml} 현재는 <strong>객관식 단일</strong>, <strong>객관식 중복</strong>, <strong>객관식 순위</strong>, <strong>객관식 척도</strong>, <strong>주관식 숫자</strong>, <strong>주관식 시간</strong>, <strong>주관식 비율 배분</strong> 문항을 지원합니다.
      </div>
    </section>
  `;
}

/**
 * 필요 시 DOM 요소/전역 훅을 한 번만 생성·초기화합니다.
 */
async function ensureCodebookIndexLoaded() {
  if (resultState.codebookByLabel && resultState.codebookByLabel.size > 0) return;
  const currentId = sessionStorage.getItem('survey.currentId');
  if (!currentId) return;
  const surveys = loadSurveys();
  const cur = surveys.find(s => s.id === currentId);
  if (!cur || !cur.files || !cur.files.codebook) return;
  try {
    const rows = await loadCodebookRows(cur.files.codebook);
    if (rows) resultState.codebookByLabel = buildCodebookIndex(rows);
  } catch (_) {}
}

/**
 * 필터·선택 상태에 맞춰 전체 결과 패널을 다시 그립니다.
 */
async function renderResults() {
  const container = document.getElementById('result-container');
  if (!container) return;
  resultState.otherResponseTexts = new Map();

  const targetLabels = getTargetChipLabels();
  if (targetLabels.length === 0) {
    resultState.vizLabelColWidths.clear();
    container.innerHTML = '<div class="result-empty">보고 싶은 문항을 드래그하면 차트가 생성됩니다</div>';
    return;
  }
  pruneVizLabelColWidths(targetLabels);

  await ensureCodebookIndexLoaded();
  refreshTargetScaleCompareControl();

  if (!filterState.rows || filterState.rows.length < 2) {
    container.innerHTML = '<div class="result-empty">응답 데이터가 아직 준비되지 않아 결과를 표시할 수 없어요.</div>';
    return;
  }

  const criterionLabel = getCriterionChipLabel();
  const filteredRowIndexes = getFilteredRowIndexes();
  const filteredRows = getFilteredLabelDataRows();
  const filteredValueRows = getFilteredValueDataRows();

  if (resultState.targetScaleCompareMode) {
    const compareData = aggregateTargetScaleCompareData(targetLabels, criterionLabel, filteredRows);
    if (compareData) {
      container.innerHTML = buildTargetScaleCompareSection(compareData);
      attachVizLabelColResizers(container);
      alignScaleCompareCharts(container);
      attachResultEventListeners(container);
      addExportButtons(container);
      return;
    }
    resultState.targetScaleCompareMode = false;
    refreshTargetScaleCompareControl();
  }

  const sections = targetLabels.map(label => {
    const entry = resultState.codebookByLabel.get(label);
    if (!entry) return buildUnsupportedSection(label, null);
    if (!supportsResultEntry(entry)) return buildUnsupportedSection(label, entry);
    const data = aggregateResultQuestion(label, criterionLabel, filteredRows, filteredValueRows, filteredRowIndexes);
    if (!data) return buildUnsupportedSection(label, entry);
    return buildResultSection(data, filteredRows);
  }).join('');

  container.innerHTML = sections;
  attachVizLabelColResizers(container);
  alignGroupCompareCharts(container);
  alignScaleCompareCharts(container);
  attachResultEventListeners(container);
  addExportButtons(container);
}

/**
 * 라벨 열 너비를 허용 범위로 클램프합니다.
 */
function clampVizLabelColWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(VIZ_LABEL_COL_WIDTH_MIN, Math.min(VIZ_LABEL_COL_WIDTH_MAX, Math.round(numeric)));
}

/**
 * 문항 라벨 열 너비를 localStorage에 저장할 키를 반환합니다.
 */
function getVizLabelColWidthKey(section) {
  const target = section && section.dataset ? (section.dataset.target || '') : '';
  const type = section && section.dataset ? (section.dataset.type || '') : '';
  return `${type}:${target}`;
}

/**
 * 사라진 문항에 대한 저장된 라벨 열 너비를 정리합니다.
 */
function pruneVizLabelColWidths(targetLabels) {
  const activeLabels = new Set(targetLabels || []);
  resultState.vizLabelColWidths.forEach((_, key) => {
    const target = key.slice(key.indexOf(':') + 1);
    if (target && !activeLabels.has(target)) resultState.vizLabelColWidths.delete(key);
  });
}

/**
 * 섹션의 문항 라벨 열 너비를 설정·저장합니다.
 */
function setSectionVizLabelColWidth(section, width, remember = false) {
  const clamped = clampVizLabelColWidth(width);
  if (!section || clamped === null) return;
  section.style.setProperty('--viz-label-col-width', `${clamped}px`);
  if (remember) resultState.vizLabelColWidths.set(getVizLabelColWidthKey(section), clamped);
}

/**
 * 저장된 라벨 열 너비를 섹션에 적용합니다.
 */
function applyRememberedSectionVizLabelColWidth(section) {
  if (!section) return;
  const remembered = resultState.vizLabelColWidths.get(getVizLabelColWidthKey(section));
  if (remembered !== undefined) setSectionVizLabelColWidth(section, remembered, false);
}

/**
 * 결과 컨테이너에 리사이저·이벤트 등을 연결합니다.
 */
function attachVizLabelColResizers(container) {
  if (!container) return;
  container.querySelectorAll(VIZ_LABEL_COL_RESIZE_SELECTORS).forEach(chart => {
    if (chart.querySelector(':scope > .viz-label-col-resizer')) return;
    const section = chart.closest('.result-section');
    applyRememberedSectionVizLabelColWidth(section);
    chart.classList.add('viz-label-col-resizable');

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'viz-label-col-resizer';
    handle.setAttribute('aria-label', '보기명 영역 너비 조절');
    handle.addEventListener('pointerdown', event => {
      if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('is-viz-label-col-resizing');

      const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--viz-label-bar-gap')) || 0;
      const update = clientX => {
        const rect = chart.getBoundingClientRect();
        setSectionVizLabelColWidth(section, clientX - rect.left - gap + 8, true);
        alignGroupCompareCharts(container);
        alignScaleCompareCharts(container);
      };
      update(event.clientX);

      const onMove = moveEvent => update(moveEvent.clientX);
      const onUp = upEvent => {
        try { handle.releasePointerCapture(upEvent.pointerId); } catch (_) {}
        document.body.classList.remove('is-viz-label-col-resizing');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
    chart.appendChild(handle);
  });
}

/**
 * 그룹/척도 비교 차트들의 레이아웃을 맞춥니다.
 */
function alignGroupCompareCharts(container) {
  if (!container) return;
  container.querySelectorAll('.single-hbar-chart.group-compare').forEach(chart => {
    const overlay = chart.querySelector('.hbar-group-overlay');
    const rows = Array.from(chart.querySelectorAll('.single-hbar-row'));
    if (!overlay || rows.length === 0) return;

    const overlayRect = overlay.getBoundingClientRect();
    const width = overlay.clientWidth;
    if (!width) return;

    const trackMetrics = rows.map(row => {
      const track = row.querySelector('.single-hbar-track');
      const rect = (track || row).getBoundingClientRect();
      return {
        centerY: (rect.top + (rect.height / 2)) - overlayRect.top,
        left: rect.left - overlayRect.left,
        width: rect.width
      };
    });

    chart.querySelectorAll('.group-dot').forEach(dot => {
      const rowIndex = Number(dot.dataset.rowIndex || 0);
      const metric = trackMetrics[rowIndex] || { centerY: 0, left: 0, width: 0 };
      const pct = Math.max(0, Math.min(100, Number(dot.style.left.replace('%', '')) || 0));
      const x = metric.left + ((pct / 100) * metric.width);
      const y = metric.centerY;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
    });
  });
}

/**
 * 그룹/척도 비교 차트들의 레이아웃을 맞춥니다.
 */
function alignScaleCompareCharts(container) {
  if (!container) return;
  container.querySelectorAll('.scale-compare-chart.is-group').forEach(chart => {
    const overlay = chart.querySelector('.scale-compare-overlay');
    const svg = chart.querySelector('.scale-compare-line-svg');
    const plots = Array.from(chart.querySelectorAll('.scale-compare-plot'));
    const maxScore = Number(chart.dataset.maxScore || 0);
    if (!overlay || !svg || plots.length === 0 || !Number.isFinite(maxScore) || maxScore <= 1) return;

    const overlayRect = overlay.getBoundingClientRect();
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    if (!width || !height) return;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    svg.querySelectorAll('.scale-compare-line').forEach(path => {
      const means = String(path.dataset.means || '').split('|').map(value => {
        const trimmed = cleanCell(value);
        return trimmed === '' ? NaN : Number(trimmed);
      });
      let started = false;
      const commands = [];
      means.forEach((mean, index) => {
        if (!Number.isFinite(mean)) {
          started = false;
          return;
        }
        const plot = plots[index];
        if (!plot) {
          started = false;
          return;
        }
        const rect = plot.getBoundingClientRect();
        const leftPct = getScaleMeanLeftPct(mean, maxScore);
        if (!Number.isFinite(leftPct)) {
          started = false;
          return;
        }
        const plotStyles = getComputedStyle(plot.parentElement || plot);
        const trackTop = Number.parseFloat(plotStyles.getPropertyValue('--scale-compare-track-top')) || (rect.height * 0.46);
        const x = (rect.left - overlayRect.left) + ((leftPct / 100) * rect.width);
        const y = (rect.top - overlayRect.top) + trackTop;
        commands.push(`${started ? 'L' : 'M'} ${x} ${y}`);
        started = true;
      });
      path.setAttribute('d', commands.join(' '));
    });
  });
}

/**
 * 데이터 테이블 접기/펼치기 상태를 적용합니다.
 */
function applyDataTableCollapsed(wrapper, btn, collapsed) {
  if (!wrapper || !btn) return;
  wrapper.classList.toggle('is-collapsed', !!collapsed);
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const labelEl = btn.querySelector('.result-table-toggle-label');
  if (labelEl) {
    const expandedText = labelEl.dataset.labelExpanded || '데이터 테이블 숨기기';
    const collapsedText = labelEl.dataset.labelCollapsed || '데이터 테이블 펼치기';
    labelEl.textContent = collapsed ? collapsedText : expandedText;
  }
}

/**
 * 테이블 DOM을 TSV(탭 구분) 문자열로 직렬화합니다.
 */
function tableToTsv(table) {
  if (!table) return '';
  return Array.from(table.querySelectorAll('tr')).map(row => {
    return Array.from(row.children).map(cell => {
      return cleanCell(cell.innerText || cell.textContent || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    }).join('\t');
  }).join('\n');
}

/**
 * 복사용으로 테이블 셀을 행 단위 엔트리로 나눕니다.
 */
function getTableSectionCellEntries(rows) {
  const activeRowSpans = [];
  return Array.from(rows || []).map(row => {
    const entries = [];
    let colIndex = 0;
    Array.from(row.children).forEach(cell => {
      while ((activeRowSpans[colIndex] || 0) > 0) colIndex += 1;
      const colSpan = Math.max(1, Number(cell.colSpan) || 1);
      const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);
      entries.push({
        cell,
        start: colIndex,
        end: colIndex + colSpan,
        colSpan
      });
      if (rowSpan > 1) {
        for (let offset = 0; offset < colSpan; offset += 1) {
          activeRowSpans[colIndex + offset] = Math.max(activeRowSpans[colIndex + offset] || 0, rowSpan);
        }
      }
      colIndex += colSpan;
    });
    for (let index = 0; index < activeRowSpans.length; index += 1) {
      if (activeRowSpans[index] > 0) activeRowSpans[index] -= 1;
    }
    return entries;
  });
}

/**
 * 표 헤더 셀이 응답 수 열인지 판별합니다.
 */
function isResponseCountHeaderCell(cell) {
  if (!cell) return false;
  const text = cleanCell(cell.innerText || cell.textContent || '').replace(/\s+/g, '');
  return text.includes('응답수');
}

/**
 * 표에서 응답 수(n) 열 인덱스를 찾습니다.
 */
function getResponseCountColumnIndexes(table) {
  const rows = table && table.tHead
    ? Array.from(table.tHead.rows)
    : Array.from(table ? table.querySelectorAll('thead tr') : []);
  const columns = new Set();
  getTableSectionCellEntries(rows).forEach(entries => {
    entries.forEach(({ cell, start, end }) => {
      if (!isResponseCountHeaderCell(cell)) return;
      for (let col = start; col < end; col += 1) columns.add(col);
    });
  });
  return columns;
}

/**
 * 구간 내에서 제거 대상 열이 몇 개 겹치는지 셉니다.
 */
function countRemovedColumns(start, end, columnsToRemove) {
  let count = 0;
  for (let col = start; col < end; col += 1) {
    if (columnsToRemove.has(col)) count += 1;
  }
  return count;
}

/**
 * 행 배열에서 지정 인덱스 열들을 삭제합니다.
 */
function removeColumnsFromRows(rows, columnsToRemove) {
  const cellsToRemove = [];
  getTableSectionCellEntries(rows).forEach(entries => {
    entries.forEach(({ cell, start, end, colSpan }) => {
      const removeCount = countRemovedColumns(start, end, columnsToRemove);
      if (removeCount <= 0) return;
      if (removeCount >= colSpan) {
        cellsToRemove.push(cell);
      } else {
        cell.colSpan = colSpan - removeCount;
      }
    });
  });
  cellsToRemove.forEach(cell => cell.remove());
}

/**
 * 복사 시 제외할 열을 반영해 테이블 데이터를 정리합니다.
 */
function prepareResultTableForCopy(table) {
  if (!table) return null;
  const copyTable = table.cloneNode(true);
  const columnsToRemove = getResponseCountColumnIndexes(copyTable);
  if (columnsToRemove.size === 0) return copyTable;

  if (copyTable.tHead) removeColumnsFromRows(copyTable.tHead.rows, columnsToRemove);
  Array.from(copyTable.tBodies || []).forEach(tbody => removeColumnsFromRows(tbody.rows, columnsToRemove));
  if (copyTable.tFoot) removeColumnsFromRows(copyTable.tFoot.rows, columnsToRemove);
  return copyTable;
}

/**
 * 클립보드 API 실패 시 대체 복사를 시도합니다.
 */
function copyTextFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('Copy command failed');
}

/**
 * 짧은 토스트 메시지를 표시합니다.
 */
function showDashboardToast(message) {
  let toast = document.querySelector('[data-dashboard-toast]');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'dashboard-toast';
    toast.dataset.dashboardToast = 'true';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove('is-visible');
  window.clearTimeout(showDashboardToast._timer);
  window.requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });
  showDashboardToast._timer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 1800);
}

/**
 * 결과 테이블을 클립보드로 비동기 복사합니다.
 */
async function copyResultTable(btn) {
  const section = btn ? btn.closest('[data-data-table-section]') : null;
  const table = section ? section.querySelector('.result-table') : null;
  if (!table) return;

  const copyTable = prepareResultTableForCopy(table);
  const tableHtml = copyTable.outerHTML;
  const tableText = tableToTsv(copyTable);
  try {
    let copied = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            'text/html': new Blob([tableHtml], { type: 'text/html' }),
            'text/plain': new Blob([tableText], { type: 'text/plain' })
          })
        ]);
        copied = true;
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(tableText);
        copied = true;
      }
    } catch (_) {}
    if (!copied) {
      copyTextFallback(tableText);
    }
    showDashboardToast('데이터 테이블이 복사되었습니다');
    btn.classList.add('is-copied');
    btn.setAttribute('aria-label', '데이터 테이블 복사 완료');
    btn.title = '복사 완료';
    window.setTimeout(() => {
      btn.classList.remove('is-copied');
      btn.setAttribute('aria-label', '데이터 테이블 복사하기');
      btn.title = '데이터 테이블 복사하기';
    }, 1200);
  } catch (_) {
    alert('테이블을 복사하지 못했어요. 브라우저 권한을 확인한 뒤 다시 시도해 주세요.');
  }
}

/**
 * 필요 시 DOM 요소/전역 훅을 한 번만 생성·초기화합니다.
 */
function ensureHbarDotOutsideReset() {
  if (resultState._hbarDotOutsideBound) return;
  resultState._hbarDotOutsideBound = true;
  document.addEventListener('click', (e) => {
    if (!document.querySelector('.group-dot-wrap.is-dimmed')) return;
    if (e.target && e.target.closest && e.target.closest('.group-dot-wrap')) return;
    document.querySelectorAll('.group-dot-wrap').forEach(w => {
      w.classList.remove('is-dimmed');
      w.classList.remove('is-highlighted');
    });
    document.querySelectorAll('.group-compare').forEach(c => {
      c.classList.remove('has-highlight');
    });
  });
}

function ensureBoxPlotQOutsideReset() {
  if (resultState._boxPlotQOutsideBound) return;
  resultState._boxPlotQOutsideBound = true;
  document.addEventListener('click', (e) => {
    if (!document.querySelector('.box-plot-q-item.is-dimmed')) return;
    if (e.target && e.target.closest && e.target.closest('.box-plot-q-item')) return;
    document.querySelectorAll('.box-plot-q-item').forEach(i => {
      i.classList.remove('is-dimmed');
      i.classList.remove('is-highlighted');
    });
  });
}

/**
 * 필요 시 DOM 요소/전역 훅을 한 번만 생성·초기화합니다.
 */
function ensureChoiceMenuOutsideClose() {
  if (resultState._choiceMenuOutsideBound) return;
  resultState._choiceMenuOutsideBound = true;
  document.addEventListener('click', (e) => {
    if (resultState.openChoiceMenus.size === 0 && resultState.openRankMenus.size === 0) return;
    const within = e.target && e.target.closest && (e.target.closest('[data-choice-chart-type-select]') || e.target.closest('[data-rank-view-mode-select]') || e.target.closest('[data-rank-chart-type-select]'));
    if (within) return;
    resultState.openChoiceMenus.clear();
    resultState.openRankMenus.clear();
    renderResults();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (resultState.openChoiceMenus.size === 0 && resultState.openRankMenus.size === 0) return;
    resultState.openChoiceMenus.clear();
    resultState.openRankMenus.clear();
    renderResults();
  });
}

/**
 * 결과 컨테이너에 리사이저·이벤트 등을 연결합니다.
 */
function attachResultEventListeners(container) {
  ensureTooltip();
  ensureChoiceMenuOutsideClose();
  ensureHbarDotOutsideReset();
  container.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', onTipEnter);
    el.addEventListener('mousemove', onTipMove);
    el.addEventListener('mouseleave', onTipLeave);
  });
  container.querySelectorAll('[data-open-other]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openOtherResponsesModal(btn.dataset.openOther || '', e);
    });
  });
  container.querySelectorAll('[data-data-table-toggle]').forEach(btn => {
    const section = btn.closest('.result-section');
    const wrapper = btn.closest('[data-data-table-section]');
    if (!section || !wrapper) return;
    const targetLabel = section.dataset.target || '';
    const sectionType = section.dataset.type || '';
    const stateKey = `${sectionType}::${targetLabel}`;
    const initiallyCollapsed = !!resultState.dataTableCollapsed.get(stateKey);
    applyDataTableCollapsed(wrapper, btn, initiallyCollapsed);
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const next = !(resultState.dataTableCollapsed.get(stateKey) || false);
      resultState.dataTableCollapsed.set(stateKey, next);
      applyDataTableCollapsed(wrapper, btn, next);
    });
  });
  container.querySelectorAll('[data-data-table-copy]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      copyResultTable(btn);
    });
  });
  container.querySelectorAll('[data-viz-control-search]').forEach(input => {
    input.addEventListener('input', () => {
      const query = input.value.toLowerCase();
      const target = input.dataset.target;
      const responsesEl = container.querySelector(`[data-text-open-responses][data-target="${target}"]`);
      if (!responsesEl) return;
      responsesEl.querySelectorAll('.open-text-item').forEach(item => {
        const text = item.dataset.text || '';
        item.classList.toggle('is-hidden', query.length > 0 && !text.includes(query));
      });
    });
  });
  container.querySelectorAll('[data-scale-mode]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const mode = btn.dataset.scaleMode;
      const targetLabel = btn.dataset.target;
      if (!mode || !targetLabel) return;
      resultState.scaleViewModes.set(targetLabel, mode);
      renderResults();
    });
  });
  container.querySelectorAll('[data-scale-hide-midpoint]').forEach(input => {
    input.addEventListener('change', e => {
      e.stopPropagation();
      const targetLabel = input.dataset.target;
      if (!targetLabel) return;
      resultState.scaleMidpointHidden.set(targetLabel, !!input.checked);
      renderResults();
    });
  });
  container.querySelectorAll('[data-scale-compare-sort-mean]').forEach(input => {
    input.addEventListener('change', e => {
      e.stopPropagation();
      resultState.targetScaleCompareSortByMean = !!input.checked;
      renderResults();
    });
  });
  container.querySelectorAll('[data-scale-group-sort-mean]').forEach(input => {
    input.addEventListener('change', e => {
      e.stopPropagation();
      const targetLabel = input.dataset.target;
      if (!targetLabel) return;
      resultState.scaleGroupSortByMean.set(targetLabel, !!input.checked);
      renderResults();
    });
  });

  const bindNumericCommit = (selector, key, normalize) => {
    container.querySelectorAll(selector).forEach(input => {
      const commit = () => {
        const targetLabel = input.dataset.target;
        if (!targetLabel) return;
        const current = resultState.numericHistogramConfigs.get(targetLabel) || {};
        const nextValue = normalize(input.value);
        input.value = nextValue;
        resultState.numericHistogramConfigs.set(targetLabel, { ...current, [key]: nextValue });
        renderResults();
      };
      input.addEventListener('change', e => {
        e.stopPropagation();
        commit();
      });
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        commit();
      });
    });
  };
  bindNumericCommit('[data-numeric-interval]', 'interval', clampNumericHistogramStep);
  bindNumericCommit('[data-numeric-start]', 'start', normalizeNumericHistogramStart);
  container.querySelectorAll('[data-numeric-view]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      const mode = btn.dataset.numericView;
      if (!targetLabel || !mode) return;
      resultState.numericOpenViewModes.set(targetLabel, mode === 'box' ? 'box' : 'histogram');
      renderResults();
    });
  });
  container.querySelectorAll('[data-open-scale-compare]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.openScaleCompare;
      if (!targetLabel) return;
      openScaleCompareModal(targetLabel);
    });
  });
  // 그래프 모양 드롭다운 트리거 (객관식 단일 / 척도 / 비율 배분 공통)
  container.querySelectorAll('[data-choice-chart-type-trigger]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      const scope = btn.dataset.scope || '';
      if (!targetLabel) return;
      const menuKey = scope ? `${scope}:${targetLabel}` : targetLabel;
      const wasOpen = resultState.openChoiceMenus.has(menuKey);
      resultState.openChoiceMenus.clear();
      if (!wasOpen) resultState.openChoiceMenus.add(menuKey);
      renderResults();
    });
  });
  // 그래프 모양 옵션 선택 (객관식 단일 / 척도 / 비율 배분 공통)
  container.querySelectorAll('[data-choice-chart-type]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      const type = btn.dataset.choiceChartType;
      const scope = btn.dataset.choiceChartScope;
      if (!targetLabel) return;
      if (scope === 'scale') {
        if (!SCALE_CHART_TYPES.includes(type)) return;
        resultState.scaleChartTypes.set(targetLabel, type);
        resultState.openChoiceMenus.delete(`scale:${targetLabel}`);
      } else if (scope === 'ratio') {
        if (!RATIO_CHART_TYPES.includes(type)) return;
        resultState.ratioChartTypes.set(targetLabel, type);
        resultState.openChoiceMenus.delete(`ratio:${targetLabel}`);
      } else {
        if (!CHOICE_CHART_TYPES.includes(type)) return;
        resultState.singleChoiceChartTypes.set(targetLabel, type);
        resultState.openChoiceMenus.delete(targetLabel);
      }
      renderResults();
    });
  });
  // 객관식 단일/중복: 응답 비율 정렬 체크박스
  container.querySelectorAll('[data-choice-sort-by-rate]').forEach(input => {
    input.addEventListener('change', e => {
      e.stopPropagation();
      const targetLabel = input.dataset.target;
      if (!targetLabel) return;
      if (input.dataset.isMulti) {
        resultState.multiChoiceSortByRate.set(targetLabel, !!input.checked);
      } else {
        resultState.singleChoiceSortByRate.set(targetLabel, !!input.checked);
      }
      renderResults();
    });
  });
  container.querySelectorAll('[data-rank-view-mode-trigger]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      if (!targetLabel) return;
      const wasOpen = resultState.openRankMenus.has(targetLabel);
      resultState.openRankMenus.clear();
      if (!wasOpen) resultState.openRankMenus.add(targetLabel);
      renderResults();
    });
  });
  container.querySelectorAll('[data-rank-view-mode-option]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      const mode = btn.dataset.rankViewModeOption === 'vertical' ? 'vertical' : 'horizontal';
      if (!targetLabel) return;
      resultState.rankViewModes.set(targetLabel, mode);
      resultState.openRankMenus.delete(targetLabel);
      renderResults();
    });
  });
  container.querySelectorAll('[data-rank-chart-type]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      const type = btn.dataset.rankChartType;
      if (!targetLabel || !RANK_CHART_TYPES.includes(type)) return;
      resultState.rankChartTypes.set(targetLabel, type);
      renderResults();
    });
  });
  container.querySelectorAll('[data-rank-view-mode]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      const mode = btn.dataset.rankViewMode === 'vertical' ? 'vertical' : 'horizontal';
      if (!targetLabel) return;
      resultState.rankViewModes.set(targetLabel, mode);
      renderResults();
    });
  });
  container.querySelectorAll('[data-rank-sort-by-score]').forEach(input => {
    input.addEventListener('change', e => {
      e.stopPropagation();
      const targetLabel = input.dataset.target;
      if (!targetLabel) return;
      resultState.rankSortByScore.set(targetLabel, !!input.checked);
      renderResults();
    });
  });
  container.querySelectorAll('.legend').forEach(legend => {
    const targetLabel = legend.dataset.target;
    const mode = legend.dataset.mode; // 'group' or 'rank'
    legend.querySelectorAll('.legend-item, .scale-compare-legend-item').forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.addEventListener('change', () => {
        if (mode === 'rank') {
          const hidden = resultState.hiddenRankKeys.get(targetLabel) || new Set();
          const ri = Number(item.dataset.rank);
          if (cb.checked) hidden.delete(ri);
          else hidden.add(ri);
          resultState.hiddenRankKeys.set(targetLabel, hidden);
        } else {
          const hidden = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
          if (cb.checked) hidden.delete(item.dataset.group);
          else hidden.add(item.dataset.group);
          resultState.hiddenGroupKeys.set(targetLabel, hidden);
        }
        renderResults();
      });
    });
  });
  container.querySelectorAll('.legend-actions').forEach(actions => {
    const targetLabel = actions.dataset.target;
    const mode = actions.dataset.mode;
    actions.querySelectorAll('.legend-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.legendAction;
        const legendPanel = actions.closest('.legend-panel');
        if (mode === 'rank') {
          const legend = legendPanel ? legendPanel.querySelector('.legend[data-mode="rank"]') : null;
          const rankIndexes = legend
            ? Array.from(legend.querySelectorAll('.legend-item')).map(item => Number(item.dataset.rank)).filter(Number.isFinite)
            : [];
          const nextHidden = action === 'all-off' ? new Set(rankIndexes) : new Set();
          resultState.hiddenRankKeys.set(targetLabel, nextHidden);
        } else {
          const legend = legendPanel ? legendPanel.querySelector('.legend[data-mode="group"]') : null;
          const groupValues = legend
            ? Array.from(legend.querySelectorAll('.legend-item, .scale-compare-legend-item')).map(item => item.dataset.group).filter(Boolean)
            : [];
          resultState.hiddenGroupKeys.set(targetLabel, action === 'all-off' ? new Set(groupValues) : new Set());
        }
        renderResults();
      });
    });
  });
  container.querySelectorAll('[data-open-group-config]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openGroupConfigModal(btn.dataset.target, btn.dataset.criterion);
    });
  });
  container.querySelectorAll('[data-dual-bar-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.dualBarToggle;
      if (!targetLabel) return;
      resultState.dualBarModes.set(targetLabel, !resultState.dualBarModes.get(targetLabel));
      renderResults();
    });
  });
  container.querySelectorAll('[data-rank1st-card-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.rank1stCardToggle;
      if (!targetLabel) return;
      if (resultState.rank1stCardOpen.has(targetLabel)) {
        resultState.rank1stCardOpen.delete(targetLabel);
      } else {
        resultState.rank1stCardOpen.add(targetLabel);
      }
      renderResults();
    });
  });
  container.querySelectorAll('.group-dot-wrap').forEach(wrap => {
    wrap.addEventListener('click', e => {
      e.stopPropagation();
      const chart = wrap.closest('.group-compare');
      if (!chart) return;
      const allWraps = chart.querySelectorAll('.group-dot-wrap');
      const clickedKey = wrap.dataset.groupKey;
      const isActive = wrap.classList.contains('is-highlighted');
      if (isActive) {
        allWraps.forEach(w => { w.classList.remove('is-dimmed'); w.classList.remove('is-highlighted'); });
        chart.classList.remove('has-highlight');
      } else {
        allWraps.forEach(w => {
          const same = w.dataset.groupKey === clickedKey;
          w.classList.toggle('is-dimmed', !same);
          w.classList.toggle('is-highlighted', same);
        });
        chart.classList.add('has-highlight');
      }
    });
  });
  container.querySelectorAll('.box-plot-q-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      const layer = item.closest('.box-plot-q-label-layer');
      if (!layer) return;
      const allItems = layer.querySelectorAll('.box-plot-q-item');
      const isActive = item.classList.contains('is-highlighted');
      if (isActive) {
        allItems.forEach(i => { i.classList.remove('is-dimmed'); i.classList.remove('is-highlighted'); });
      } else {
        allItems.forEach(i => {
          const same = i === item;
          i.classList.toggle('is-dimmed', !same);
          i.classList.toggle('is-highlighted', same);
        });
      }
    });
  });
  ensureBoxPlotQOutsideReset();
}

/**
 * 필요 시 DOM 요소/전역 훅을 한 번만 생성·초기화합니다.
 */
function ensureTooltip() {
  if (resultState.tooltipEl && document.body.contains(resultState.tooltipEl)) {
    return resultState.tooltipEl;
  }
  const el = document.createElement('div');
  el.className = 'result-tooltip';
  document.body.appendChild(el);
  resultState.tooltipEl = el;
  return el;
}

/**
 * 차트 툴팁 마우스 이벤트 핸들러입니다.
 */
function onTipEnter(e) {
  const tip = ensureTooltip();
  const raw = e.currentTarget.dataset.tip;
  if (!raw) return;
  let data;
  try { data = JSON.parse(decodeURIComponent(raw)); } catch (_) { return; }
  tip.innerHTML = formatTooltipHtml(data);
  tip.style.display = 'block';
  tip.style.whiteSpace = data.kind === 'rank-group-text' ? 'normal' : 'nowrap';
  tip.style.maxWidth = data.kind === 'rank-group-text' ? '280px' : 'none';
  positionTooltip(tip, e);
}
/**
 * 차트 툴팁 마우스 이벤트 핸들러입니다.
 */
function onTipMove(e) {
  const tip = resultState.tooltipEl;
  if (!tip || tip.style.display === 'none') return;
  positionTooltip(tip, e);
}
/**
 * 차트 툴팁 마우스 이벤트 핸들러입니다.
 */
function onTipLeave() {
  const tip = resultState.tooltipEl;
  if (tip) tip.style.display = 'none';
}
/**
 * 툴팁 요소를 포인터 근처로 이동시킵니다.
 */
function positionTooltip(tip, e) {
  const pad = 12;
  const rect = tip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + rect.width > window.innerWidth - 4) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 4) y = e.clientY - rect.height - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

/**
 * 차트 툴팁에 넣을 HTML 문자열을 데이터 객체로부터 만듭니다.
 */
function formatTooltipHtml(d) {
  const pct = (v) => formatPercent(v);
  const n = (v) => "N=" + Number(v || 0).toLocaleString();
  const line = (s) => `<div>${s}</div>`;
  switch (d.kind) {
    case "option-label":
      return [line(escapeHtml(d.option))].join("");
    case "question-full":
      return [line(escapeHtml(d.label || "")), d.full ? line(`Q. ${escapeHtml(d.full)}`) : ""].join("");
    case "basic-bar":
      return [line(escapeHtml(d.option)), line(pct(d.pct)), line(n(d.count))].join("");
    case "compare-bar":
    case "group-dot":
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : "",
        line(escapeHtml(d.option)),
        line(pct(d.pct)),
        line(n(d.count))
      ].filter(Boolean).join("");
    case "rank-seg":
    case "rank-nonranked":
      return [line(escapeHtml(d.option)), line(escapeHtml(d.rankLabel)), line(pct(d.pct)), line(n(d.count))].join("");
    case "rank-lollipop":
      return [line(escapeHtml(d.option)), line(`가중 평균 점수: ${escapeHtml(formatRankAverage(d.weightedAverage))}`), line(`종합 순위: ${escapeHtml(d.rankPosition)}`)].join("");
    case "rank-lollipop-group":
      return [
        line(escapeHtml(d.groupLabel)),
        line(escapeHtml(d.option)),
        line(`가중 평균 점수: ${escapeHtml(formatRankAverage(d.weightedAverage))}`),
        line(`그룹 내 순위: ${escapeHtml(d.rankPosition || '-')}`)
      ].join("");
    case "rank-group-text": {
      const head = [line(escapeHtml(d.groupLabel)), line(escapeHtml(d.option))];
      const perRank = (d.perRank || []).map(pr => line(`${escapeHtml(pr.rankLabel)}: ${pct(pr.pct)}`));
      return [...head, ...perRank, line(n(d.count))].join("");
    }
    case "scale-segment":
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : "",
        line(escapeHtml(formatScaleScoreTooltipTitle(d.score, d.scoreLabel))),
        line(pct(d.pct)),
        line(n(d.count))
      ].join("");
    case "scale-mean":
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : "",
        d.questionLabel ? line(escapeHtml(d.questionLabel)) : "",
        line(`평균값 ${formatScaleMeanDisplay(d.mean, { allowZero: true }) || '0.00'}점`),
        line(n(d.totalN))
      ].join("");
    case "derived-scale-quartile":
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : "",
        line(escapeHtml(d.label || "")),
        line(`사분위값 ${formatFixedDecimal(d.value)}점`)
      ].join("");
    case "numeric-hist-bin":
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : "",
        line(`구간 범위 ${escapeHtml(d.rangeLabel || "")}`),
        line(pct(d.pct)),
        line(n(d.count))
      ].join("");
    case "numeric-mean": {
      const tfmt = d.valueFormat === 'time-clock' ? formatMinutesAsClockTime : d.valueFormat === 'time-duration' ? formatMinutesAsHourMin : null;
      if (tfmt) return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(`평균값 ${tfmt(Number(d.mean))}`), line(n(d.totalN))].join("");
      if (d.fixedDecimals) {
        const meanText = formatFixedDecimal(d.mean, d.decimalDigits || 2);
        const suffix = d.unit || '';
        return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(`평균값 ${meanText}${suffix}`), line(n(d.totalN))].join("");
      }
      return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(`평균값 ${formatNumericMeanDisplay(d.mean, d.unit || "")}`), line(n(d.totalN))].join("");
    }
    case "numeric-quartile": {
      const tfmt = d.valueFormat === 'time-clock' ? formatMinutesAsClockTime : d.valueFormat === 'time-duration' ? formatMinutesAsHourMin : null;
      if (tfmt) return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(escapeHtml(d.tooltipLabel || d.label || "")), line(`사분위값 ${tfmt(Number(d.value))}`)].join("");
      if (d.fixedDecimals) {
        return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(escapeHtml(d.tooltipLabel || d.label || "")), line(`사분위값 ${formatFixedDecimal(d.value, d.decimalDigits || 2)}${d.unit || ''}`)].join("");
      }
      return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(escapeHtml(d.tooltipLabel || d.label || "")), line(`사분위값 ${formatNumericValueWithUnit(Number(d.value), d.unit || "")}`)].join("");
    }
    case "numeric-boxplot-stat": {
      const tfmt = d.valueFormat === 'time-clock' ? formatMinutesAsClockTime : d.valueFormat === 'time-duration' ? formatMinutesAsHourMin : null;
      if (tfmt) return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(escapeHtml(d.label || "")), line(tfmt(Number(d.value)))].join("");
      if (d.fixedDecimals) {
        return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(escapeHtml(d.label || "")), line(`${formatFixedDecimal(d.value, d.decimalDigits || 2)}${d.unit || ''}`)].join("");
      }
      return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(escapeHtml(d.label || "")), line(formatNumericValueWithUnit(Number(d.value), d.unit || ""))].join("");
    }
    case "numeric-whisker-range": {
      const tfmt = d.valueFormat === 'time-clock' ? formatMinutesAsClockTime : d.valueFormat === 'time-duration' ? formatMinutesAsHourMin : null;
      if (tfmt) return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(`최소값 ${tfmt(Number(d.min))}`), line(`최대값 ${tfmt(Number(d.max))}`), line(n(d.totalN))].join("");
      return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(`최소값 ${formatNumericValueWithUnit(Number(d.min), d.unit || "")}`), line(`최대값 ${formatNumericValueWithUnit(Number(d.max), d.unit || "")}`), line(n(d.totalN))].join("");
    }
    case "numeric-whisker-box": {
      const tfmt = d.valueFormat === 'time-clock' ? formatMinutesAsClockTime : d.valueFormat === 'time-duration' ? formatMinutesAsHourMin : null;
      if (tfmt) return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(`Q1(하위 25%) ${tfmt(Number(d.q1))}`), line(`Q2(중앙값) ${tfmt(Number(d.median))}`), line(`Q3(상위 25%) ${tfmt(Number(d.q3))}`), line(n(d.totalN))].join("");
      return [d.groupLabel ? line(escapeHtml(d.groupLabel)) : "", line(`Q1(하위 25%) ${formatNumericValueWithUnit(Number(d.q1), d.unit || "")}`), line(`Q2(중앙값) ${formatNumericValueWithUnit(Number(d.median), d.unit || "")}`), line(`Q3(상위 25%) ${formatNumericValueWithUnit(Number(d.q3), d.unit || "")}`), line(n(d.totalN))].join("");
    }
    case "ratio-allocation":
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : "",
        line(escapeHtml(d.option || "")),
        line(`평균 비중 ${pct(d.pct)}`),
        line(n(d.count))
      ].join("");
    case "scale-compare-group-dot":
      return [
        d.questionLabel ? line(escapeHtml(d.questionLabel)) : "",
        line(escapeHtml(d.groupLabel)),
        line(`평균값 ${formatScaleMeanDisplay(d.mean, { allowZero: true }) || '0.00'}점`),
        d.totalN !== undefined ? line(n(d.totalN)) : ""
      ].join("");
    default:
      return "";
  }
}

/* =====================================================================
   3) UI Binding (events / modals / init)
   ===================================================================== */

/**
 * 드롭존 등 DOM 변화를 관찰해 UI를 갱신합니다.
 */
function observeDropZones() {
  ['drop-target', 'drop-criterion'].forEach(id => {
    const zone = document.getElementById(id);
    if (!zone) return;
    const obs = new MutationObserver(() => { renderResults(); });
    obs.observe(zone, { childList: true, subtree: false });
  });
}

/**
 * 필터 변경 등에 결과 리렌더를 후킹합니다.
 */
function hookFilterUpdates() {
  if (typeof updateFilterCount !== 'function') return;
  const original = updateFilterCount;
  window.updateFilterCount = function() {
    let ret;
    try { ret = original.apply(this, arguments); }
    finally { renderResults(); }
    return ret;
  };
}

/**
 * 결과 탭 기능을 초기화하고 첫 렌더를 수행합니다.
 */
async function initResultFeature() {
  if (resultState.initialized) return;
  resultState.initialized = true;

  const shareToken = new URLSearchParams(location.search).get('share');
  try { await loadSurveysFromServer(shareToken || undefined); } catch (_) {}

  const currentId = sessionStorage.getItem('survey.currentId');
  if (currentId) {
    const surveys = loadSurveys();
    const cur = surveys.find(s => s.id === currentId);
    if (cur && cur.files && cur.files.codebook) {
      try {
        const rows = await loadCodebookRows(cur.files.codebook);
        if (rows) {
          resultState.codebookByLabel = buildCodebookIndex(rows);
          try { renderTree(buildQuestionTree(rows)); } catch (_) {}
        }
      } catch (_) {}
    }
    const titleEl = document.getElementById('project-title');
    if (titleEl && cur && cur.title) {
      try { titleEl.textContent = cur.title; } catch (_) {}
    }
  }

  try { setupAccordion && setupAccordion(); } catch (_) {}
  try { setupSearch && setupSearch(); } catch (_) {}
  try { setupPanelToggle && setupPanelToggle(); } catch (_) {}
  try { setupSelectionAndDragDrop && setupSelectionAndDragDrop(); } catch (_) {}
  try { setupOtherResponseModal && setupOtherResponseModal(); } catch (_) {}
  try { setupScaleCompareModal && setupScaleCompareModal(); } catch (_) {}
  try { setupGroupConfigModal && setupGroupConfigModal(); } catch (_) {}
  try { setupTitleRename && setupTitleRename(); } catch (_) {}
  try { setupSavedModal && setupSavedModal(); } catch (_) {}
  try { await setupFilters(); } catch (_) {}

  hookFilterUpdates();
  observeDropZones();
  window.addEventListener('resize', () => {
    const container = document.getElementById('result-container');
    alignGroupCompareCharts(container);
    alignScaleCompareCharts(container);
  });
  renderResults();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initResultFeature(); });
} else {
  setTimeout(() => { initResultFeature(); }, 0);
}


const EXPORT_LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA14AAAB/CAYAAAD/wBP8AAAACXBIWXMAAAsTAAALEwEAmpwYAAAFxmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgOS4xLWMwMDIgNzkuYjdjNjRjY2Y5LCAyMDI0LzA3LzE2LTEyOjM5OjA0ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdFJlZj0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlUmVmIyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIiB4bWxuczpwaG90b3Nob3A9Imh0dHA6Ly9ucy5hZG9iZS5jb20vcGhvdG9zaG9wLzEuMC8iIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDI2LjEgKE1hY2ludG9zaCkiIHhtcDpDcmVhdGVEYXRlPSIyMDI0LTEyLTAzVDE0OjA3OjUxKzA5OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyNC0xMi0xMlQxMzo1MTozNyswOTowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyNC0xMi0xMlQxMzo1MTozNyswOTowMCIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo1MTY2MjBmMy1jMjExLTQ0MTItYWMwMy03Mjg5Mjg5MDVmNTMiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6M0Y3MjgzNEJBOTU4MTFFRkI2QTdDNDc4QTZEOEJGNzMiIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDozRjcyODM0QkE5NTgxMUVGQjZBN0M0NzhBNkQ4QkY3MyIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDozRjcyODM0OEE5NTgxMUVGQjZBN0M0NzhBNkQ4QkY3MyIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDozRjcyODM0OUE5NTgxMUVGQjZBN0M0NzhBNkQ4QkY3MyIvPiA8eG1wTU06SGlzdG9yeT4gPHJkZjpTZXE+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJzYXZlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDo1MTY2MjBmMy1jMjExLTQ0MTItYWMwMy03Mjg5Mjg5MDVmNTMiIHN0RXZ0OndoZW49IjIwMjQtMTItMTJUMTM6NTE6MzcrMDk6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyNi4xIChNYWNpbnRvc2gpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDwvcmRmOlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PuGs6fwAADN5SURBVHic7Z13uFxV1Yff9AqZQAKYBLiEANITaYIiF1AEKV7AQrEhRbFxLZ/ipwiCBfwsF1CwoMYGIiBRQJrgpYgUpSbUECchoYWQkEISUub7Y82QYTJ3yllrn33m3vU+z34IkLP2b07da++11wLHcRzHcRzHcRwnKP1iC3Acp08zANhRcfxrwONGWhzHcRwnKZsDoxXHLwVmKTVsCLQpjn8JeFapwXEcx8koOaCgaPm0BTuZYSRy/2wQWYfjOA7AVHTfs24DDR1KDV0GGpwaDIwtwHEcx3F6YCNgf2BPYDtgW2A8MqtbyfPAbGAGcB9wR/HPjuM4jpMJ3PFy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';
// === A4 세로 추출 사양 (300 DPI) ===
// docs/image-export-spec.md 기준
const EXPORT_DPI = 300;

const EXPORT_PAGE_W = 2480;            // A4 width: 210mm @ 300DPI
const EXPORT_PAGE_H = 3508;            // A4 height: 297mm @ 300DPI

const EXPORT_MARGIN_X = 118;           // 좌우 여백 10mm
const EXPORT_MARGIN_TOP = 118;         // 상단 여백 10mm
const EXPORT_MARGIN_BOTTOM = 0;        // 푸터가 페이지 하단까지 뻗어있어 별도 하단 여백 없음
const EXPORT_FOOTER_H = 177;           // 푸터 영역 높이 15mm — 푸터 콘텐츠 + 상단 구분선이 모두 이 영역 안에 위치

// 캡처(헤더 + 콘텐츠)가 들어가는 가용 영역
const EXPORT_CONTENT_W = EXPORT_PAGE_W - EXPORT_MARGIN_X * 2;                      // 2244px (190mm)
const EXPORT_CONTENT_H = EXPORT_PAGE_H - EXPORT_MARGIN_TOP - EXPORT_FOOTER_H - EXPORT_MARGIN_BOTTOM; // 3213px (272mm)

const EXPORT_FOOTER_PAD = EXPORT_MARGIN_X; // 푸터 좌우 패딩 = 좌우 여백과 동일 (10mm)

// 캡처 시 강제할 .result-section 너비 (px). 작을수록 인쇄 시 글자/차트가 시각적으로 커짐.
// 800px → 콘텐츠 폭 2244px(190mm)에 맞춰 약 2.81배 확대 → 14px 본문 폰트가 인쇄 시 약 3.3mm
const EXPORT_CAPTURE_WIDTH = 800;

const EXPORT_HIDE_SELECTORS = [
  '.chart-view-controls',
  '.viz-controls',
  '.viz-label-col-resizer',
  '[data-data-table-toggle]',
  '[data-data-table-copy]',
  '.result-export-btn',
  '.stack100-group-section',
  '.scale-group-section',
  '[data-type="numeric-open"] .legend-panel',
];

// 캡처 전용 — display:none으로 공간까지 제거할 셀렉터
const CAPTURE_HIDE_SELECTORS = [
  '.chart-view-controls',
  '.group-compare-controls',
  '.rank-controls',
  '.scale-toggle',
  '.viz-controls',
  '.viz-label-col-resizer',
  '[data-data-table-toggle]',
  '[data-data-table-copy]',
  '.result-export-btn',
  '.legend-actions',
  '.legend-item input[type="checkbox"]',
  '.two-compare-btn',
  '.rank1st-card-btn',
  '.stack100-group-section',
  '.scale-group-section',
  '[data-type="numeric-open"] .legend-panel',
];

// PPT 슬라이드 레이아웃 상수 (SAMPLE.pptx 기준, 단위: inches)
const PPTX_MARGIN_L   = 0.406;
const PPTX_CONTENT_W  = 12.127;
const PPTX_BOX_Y      = 2.490;
const PPTX_BOX_H      = 4.608;

/**
 * result-section 캡처 — 컨트롤 헤더를 display:none으로 제거 후 PNG canvas 반환
 */
async function captureSectionForClipboard(section) {
  const hiddenEls = [];
  const overflowEls = [];
  const pieViewBoxEls = [];
  try {
    CAPTURE_HIDE_SELECTORS.forEach(function(sel) {
      section.querySelectorAll(sel).forEach(function(el) {
        hiddenEls.push({ el: el, prev: el.style.display });
        el.style.display = 'none';
      });
    });
    // 체크 해제된 범례 항목 숨기기
    section.querySelectorAll('.legend-item').forEach(function(item) {
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) {
        hiddenEls.push({ el: item, prev: item.style.display });
        item.style.display = 'none';
      }
    });
    // 데이터 테이블 스크롤바 숨기기 — domtoimage 렌더링 시 스크롤바가 그려지는 것을 방지
    // overflow-x: hidden 설정 시 CSS 스펙에 의해 overflow-y가 auto로 승격되므로 함께 처리
    section.querySelectorAll('.result-table-wrap').forEach(function(el) {
      overflowEls.push({ el: el, prevX: el.style.overflowX, prevY: el.style.overflowY });
      el.style.overflowX = 'hidden';
      el.style.overflowY = 'hidden';
    });
    // 파이 차트 외부 레이블 클리핑 방지 — 캡처 시에만 viewBox·크기 확장
    section.querySelectorAll('.pie-svg').forEach(function(svg) {
      pieViewBoxEls.push({ el: svg, prevViewBox: svg.getAttribute('viewBox'), prevW: svg.style.width, prevH: svg.style.height });
      svg.setAttribute('viewBox', '-60 -60 400 400');
      svg.style.width = '400px';
      svg.style.height = '400px';
    });
    void section.offsetHeight;
    await document.fonts.ready;

    const scale = Math.max(window.devicePixelRatio || 1, 3);
    return await domtoimage.toCanvas(section, {
      bgcolor: '#ffffff',
      scale,
    });
  } finally {
    hiddenEls.forEach(function(item) { item.el.style.display = item.prev; });
    overflowEls.forEach(function(item) { item.el.style.overflowX = item.prevX; item.el.style.overflowY = item.prevY; });
    pieViewBoxEls.forEach(function(item) { item.el.setAttribute('viewBox', item.prevViewBox); item.el.style.width = item.prevW; item.el.style.height = item.prevH; });
  }
}

/**
 * 결과 섹션에 이미지/PPTX 내보내기 버튼을 붙입니다.
 */
function addExportButtons(container) {
  container.querySelectorAll('.result-section').forEach(function(section) {
    var header = section.querySelector('.result-header');
    if (!header) return;
    if (header.querySelector('.result-export-btn')) return;
    var row = header.querySelector('.result-header-top');
    if (!row) {
      var titleEl = header.querySelector('.result-question-label');
      if (!titleEl) return;
      row = document.createElement('div');
      row.className = 'result-header-top';
      titleEl.replaceWith(row);
      var main = document.createElement('div');
      main.className = 'result-title';
      row.appendChild(main);
      main.appendChild(titleEl);

      var subEl = header.querySelector('.result-question-full');
      if (subEl) main.appendChild(subEl);
    } else if (!row.querySelector('.result-title')) {
      var existingTitle = row.querySelector('.result-question-label');
      if (existingTitle) {
        var headerMain = document.createElement('div');
        headerMain.className = 'result-title';
        existingTitle.replaceWith(headerMain);
        headerMain.appendChild(existingTitle);

        var existingSub = header.querySelector('.result-question-full');
        if (existingSub) headerMain.appendChild(existingSub);
      }
    }
    var actions = row.querySelector('.result-header-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'result-header-actions';
      row.appendChild(actions);
    }

    var imgBtn = document.createElement('button');
    imgBtn.type = 'button';
    imgBtn.className = 'result-export-btn';
    imgBtn.innerHTML = '<img class="result-export-icon" src="assets/icons/add_photo_alternate_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true"> 이미지로 저장';
    imgBtn.addEventListener('click', function() { exportSectionAsImage(section, imgBtn); });
    actions.appendChild(imgBtn);

    var captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'result-export-btn';
    captureBtn.innerHTML = '<span class="material-symbols-rounded result-export-icon">crop</span> 캡처';
    captureBtn.addEventListener('click', async function() {
      captureBtn.disabled = true;
      captureBtn.innerHTML = '<span class="material-symbols-rounded result-export-icon">autorenew</span> 캡처 중...';
      try {
        const canvas = await captureSectionForClipboard(section);
        const blobPromise = new Promise(function(resolve, reject) {
          canvas.toBlob(function(blob) { blob ? resolve(blob) : reject(new Error('toBlob failed')); }, 'image/png');
        });
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blobPromise })
        ]);
        showDashboardToast('클립보드에 복사되었습니다');
      } catch (err) {
        console.error('[캡처 오류]', err);
        alert('[캡처 오류]\n' + (err && err.message ? err.message : String(err)));
      } finally {
        captureBtn.disabled = false;
        captureBtn.innerHTML = '<span class="material-symbols-rounded result-export-icon">crop</span> 캡처';
      }
    });
    actions.appendChild(captureBtn);

    /* PPT 내보내기 버튼 — 추후 활성화
    if (section.dataset.type === 'single') {
      var pptBtn = document.createElement('button');
      pptBtn.type = 'button';
      pptBtn.className = 'result-export-btn export-ppt-btn';
      pptBtn.innerHTML = '<img class="result-export-icon" src="assets/icons/add_chart_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true"> PPT로 내보내기';
      pptBtn.addEventListener('click', function() { exportSingleChoiceAsPptx(section, pptBtn); });
      actions.appendChild(pptBtn);
    }
    */
  });
}

/**
 * 단일선택 결과 섹션용 표시 데이터를 준비합니다.
 */
function getSingleChoiceSectionData(section, filteredRows, criterionLabel) {
  if (!section) return null;
  const targetLabel = section.dataset.target;
  if (!targetLabel) return null;
  const rank1stSourceLabel = section.dataset.rank1stSource;
  if (rank1stSourceLabel) {
    return aggregateRank1stSingle(rank1stSourceLabel, criterionLabel, filteredRows);
  }
  return aggregateSingle(targetLabel, criterionLabel, filteredRows);
}

/**
 * 결과를 PPTX·PNG 등으로 비동기 내보냅니다.
 */
async function exportAllSectionsAsPptx(btn) {
  if (typeof PptxGenJS === 'undefined') {
    alert('[오류] PptxGenJS 라이브러리가 로드되지 않았습니다.');
    return;
  }
  if (typeof domtoimage === 'undefined') {
    alert('[오류] dom-to-image-more 라이브러리가 로드되지 않았습니다.');
    return;
  }

  const container = document.getElementById('result-container');
  if (!container) return;

  const sections = Array.from(container.querySelectorAll('.result-section'));
  if (sections.length === 0) {
    alert('현재 화면에 결과 섹션이 없습니다.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<img class="dashboard-header-btn-icon" src="assets/icons/autorenew_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt=""> 저장 중...';
  }

  try {
    const surveyTitle = sessionStorage.getItem('survey.title') || '';
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';

    for (const section of sections) {
      const targetLabel = section.dataset.target || '';
      const sourceLabel = section.dataset.rank1stSource || targetLabel;
      const entry = (resultState.codebookByLabel && resultState.codebookByLabel.get(sourceLabel)) || {};
      const cat1     = entry.category1 || '';
      const fullText = entry.full ? 'Q. ' + entry.full : '';

      const { dataUrl, w: imgW, h: imgH } = await captureSectionForPpt(section);

      // 박스(12.127" × 4.608") 안에 비례 맞춤
      let dispW = PPTX_CONTENT_W;
      let dispH = imgH * (PPTX_CONTENT_W / imgW);
      if (dispH > PPTX_BOX_H) {
        dispH = PPTX_BOX_H;
        dispW = imgW * (PPTX_BOX_H / imgH);
      }
      const imgX = PPTX_MARGIN_L + (PPTX_CONTENT_W - dispW) / 2;
      const imgY = PPTX_BOX_Y   + (PPTX_BOX_H   - dispH) / 2;

      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };

      // 설문 제목
      slide.addText(surveyTitle, {
        x: PPTX_MARGIN_L, y: 0.372, w: PPTX_CONTENT_W, h: 0.168,
        fontSize: 10, color: '808080', valign: 'middle',
      });

      // SURVEY RAW DATA
      slide.addText('SURVEY RAW DATA', {
        x: PPTX_MARGIN_L, y: 0.575, w: PPTX_CONTENT_W, h: 0.202,
        fontSize: 12, color: '404040', valign: 'middle',
      });

      // 카테고리 1
      if (cat1) {
        slide.addText(cat1, {
          x: PPTX_MARGIN_L, y: 1.033, w: PPTX_CONTENT_W, h: 0.337,
          fontSize: 20, color: '151515', valign: 'middle',
        });
      }

      // 문항 라벨
      if (targetLabel) {
        slide.addText(targetLabel, {
          x: PPTX_MARGIN_L, y: 1.771, w: PPTX_CONTENT_W, h: 0.185,
          fontSize: 11, color: '404040', valign: 'middle',
        });
      }

      // 문항 전문
      if (fullText) {
        slide.addText(fullText, {
          x: PPTX_MARGIN_L, y: 2.038, w: PPTX_CONTENT_W, h: 0.168,
          fontSize: 10, color: '404040', valign: 'middle',
        });
      }

      // 차트 이미지
      slide.addImage({ data: dataUrl, x: imgX, y: imgY, w: dispW, h: dispH });
    }

    const safeTitle = (surveyTitle || '대시보드').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    await pptx.writeFile({ fileName: safeTitle + '_appendix.pptx' });
  } catch (e) {
    console.error('[PPT 전체 내보내기 오류]', e);
    alert('PPT 저장 중 오류가 발생했습니다: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<img class="dashboard-header-btn-icon" src="assets/icons/arrow_downward_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt=""> PPT로 내보내기';
    }
  }
}

const PPTX_PALETTE = [
  '577a9a','c67b7b','6e9a78','9a82bc','b89a62',
  '5e9898','bc8098','62906e','8284bc','a8924e',
  '5e88a8','a87cb0','82986a','7a7ab8','b88868',
  '5a9488','b07a9a','c08878','6a9880','7a9870'
];

/**
 * PPTX용 RGB 색 객체를 팔레트 인덱스로 반환합니다.
 */
function pptxPaletteColor(index) {
  return PPTX_PALETTE[index % PPTX_PALETTE.length];
}

/**
 * PPTX 슬라이드에 단일선택 차트/표를 배치합니다.
 */
function addSingleChoiceChartToSlide(pptx, slide, chartType, rows, displayData, targetLabel) {
  const CHART_X = 0.4, CHART_Y = 1.5, CHART_W = 12;

  if (chartType === 'bar_horizontal') {
    const chartData = [{
      name: targetLabel,
      labels: rows.map(r => r.option),
      values: rows.map(r => Math.round(r.pct * 10) / 10),
    }];
    slide.addChart(pptx.ChartType.bar, chartData, {
      x: CHART_X, y: CHART_Y, w: CHART_W,
      h: Math.max(2.5, Math.min(5.5, rows.length * 0.55 + 0.8)),
      barDir: 'bar', barGrouping: 'clustered',
      chartColors: ['525252'],
      showValue: true, dataLabelFormatCode: '0.0"%"',
      dataLabelFontSize: 9, dataLabelColor: '151515',
      valAxisMaxVal: 100, valAxisMajorUnit: 20,
      valGridLine: { style: 'none' },
      catAxisLabelFontSize: 10, catAxisLabelColor: '151515',
      showLegend: false, plotAreaBorderColor: 'FFFFFF',
    });

  } else if (chartType === 'bar_vertical') {
    const maxPct = rows.reduce((m, r) => Math.max(m, r.pct), 0);
    const axisMax = Math.max(20, Math.ceil(maxPct / 20) * 20);
    const chartData = [{
      name: targetLabel,
      labels: rows.map(r => r.option),
      values: rows.map(r => Math.round(r.pct * 10) / 10),
    }];
    slide.addChart(pptx.ChartType.bar, chartData, {
      x: CHART_X, y: CHART_Y, w: CHART_W,
      h: Math.max(3, Math.min(5, 4.5 - rows.length * 0.05)),
      barDir: 'col', barGrouping: 'clustered',
      chartColors: ['525252'],
      showValue: true, dataLabelFormatCode: '0.0"%"',
      dataLabelFontSize: 9, dataLabelColor: '151515',
      valAxisMaxVal: axisMax, valAxisMajorUnit: 20,
      valGridLine: { style: 'none' },
      catAxisLabelFontSize: 10, catAxisLabelColor: '151515',
      showLegend: false, plotAreaBorderColor: 'FFFFFF',
    });

  } else if (chartType === 'bar_horizontal_100') {
    const baseOrder = displayData.originalOptionOrder || displayData.optionOrder || [];
    const chartData = rows.map(r => ({
      name: r.option,
      labels: ['전체'],
      values: [Math.round(r.pct * 10) / 10],
    }));
    const colors = rows.map((r, i) => {
      const idx = baseOrder.indexOf(r.option);
      return pptxPaletteColor(idx < 0 ? i : idx);
    });
    slide.addChart(pptx.ChartType.bar, chartData, {
      x: CHART_X, y: CHART_Y, w: CHART_W, h: 1.4,
      barDir: 'bar', barGrouping: 'percentStacked',
      chartColors: colors,
      showValue: true, dataLabelFormatCode: '0.0"%"',
      dataLabelFontSize: 9, dataLabelColor: 'FFFFFF',
      valAxisHidden: true, catAxisHidden: true,
      valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
      showLegend: true, legendPos: 'b', legendFontSize: 9,
      plotAreaBorderColor: 'FFFFFF',
    });

  } else if (chartType === 'pie') {
    const baseOrder = displayData.originalOptionOrder || displayData.optionOrder || [];
    const chartData = [{
      name: targetLabel,
      labels: rows.map(r => r.option),
      values: rows.map(r => Math.round(r.pct * 10) / 10),
    }];
    const colors = rows.map((r, i) => {
      const idx = baseOrder.indexOf(r.option);
      return pptxPaletteColor(idx < 0 ? i : idx);
    });
    slide.addChart(pptx.ChartType.pie, chartData, {
      x: CHART_X, y: CHART_Y, w: 5.5, h: 4.5,
      chartColors: colors,
      showValue: false, showPercent: true,
      dataLabelFormatCode: '0.0%',
      dataLabelFontSize: 9, dataLabelColor: 'FFFFFF',
      dataLabelPosition: 'ctr',
      showLegend: true, legendPos: 'r', legendFontSize: 9,
      plotAreaBorderColor: 'FFFFFF',
    });
  }
}

/**
 * 결과를 PPTX·PNG 등으로 비동기 내보냅니다.
 */
async function exportSingleChoiceAsPptx(section, btn) {
  if (typeof PptxGenJS === 'undefined') {
    alert('[오류] PptxGenJS 라이브러리가 로드되지 않았습니다.');
    return;
  }

  const targetLabel = section.dataset.target;
  if (!targetLabel) return;
  const sourceLabel = section.dataset.rank1stSource || targetLabel;

  const entry = resultState.codebookByLabel.get(sourceLabel);
  if (!entry) return;

  const criterionLabel = getCriterionChipLabel();
  const filteredRows = getFilteredLabelDataRows();
  const data = getSingleChoiceSectionData(section, filteredRows, criterionLabel);
  if (!data || !data.totalResults || data.totalResults.length === 0) {
    alert('차트 데이터가 없습니다.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<img class="result-export-icon" src="assets/icons/autorenew_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true"> 저장 중...';
  }

  try {
    const chartType = getSingleChoiceChartType(targetLabel);
    const sortByRate = getSingleChoiceSortByRate(targetLabel);
    const displayData = sortByRate ? applyChoiceSortToData(data, true) : data;
    const rows = displayData.totalResults;

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';

    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    slide.addText(data.displayLabel || sourceLabel, {
      x: 0.4, y: 0.3, w: 12, h: 0.4,
      fontSize: 13, bold: true, color: '151515',
    });
    if (entry.full && entry.full.trim()) {
      slide.addText('Q. ' + entry.full, {
        x: 0.4, y: 0.75, w: 12, h: 0.35,
        fontSize: 10, color: '555555',
      });
    }
    slide.addText('N = ' + data.totalN, {
      x: 0.4, y: 1.1, w: 3, h: 0.3,
      fontSize: 9, color: '888888',
    });

    addSingleChoiceChartToSlide(pptx, slide, chartType, rows, displayData, targetLabel);

    const exportLabel = data.displayLabel || sourceLabel;
    const safeLabel = exportLabel.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    await pptx.writeFile({ fileName: safeLabel + '.pptx' });
  } catch (e) {
    console.error('[PPT 내보내기 오류]', e);
    alert('PPT 저장 중 오류가 발생했습니다: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<img class="result-export-icon" src="assets/icons/arrow_downward_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true"> PPT로 내보내기';
    }
  }
}

/* 이미지 추출 기능 */
/**
 * 결과를 PPTX·PNG 등으로 비동기 내보냅니다.
 */
async function exportSectionAsImage(section, btn) {
  // 라이브러리 로드 확인
  if (typeof domtoimage === 'undefined') {
    alert('[오류] 이미지 추출 라이브러리(dom-to-image-more)가 로드되지 않았습니다.\nassets/libs/dom-to-image-more.min.js 파일이 있는지 확인해 주세요.');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<img class="result-export-icon" src="assets/icons/autorenew_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true"> 저장 중...';
  }
  try {
    // 파일명 미리 추출
    var titleEl = section.querySelector('.result-question-label');
    var rawTitle = titleEl
      ? (titleEl.firstChild && titleEl.firstChild.nodeType === Node.TEXT_NODE
          ? titleEl.firstChild.textContent : titleEl.textContent)
      : '차트';
    var title = rawTitle.trim().replace(/[\/:*?"<>|]/g, '_') || '차트';
    var filename = title + '.png';

    // 1차 시도: 현재 화면 상태 그대로 (데이터 테이블 펼침 여부 유지)
    var result = await captureSectionToA4(section, false);

    if (result.overflow) {
      // A4 한 페이지에 안 들어감 → 데이터 테이블 펼침 여부 확인
      var dataTableEl = section.querySelector('[data-data-table-section]');
      var tableExpanded = dataTableEl && !dataTableEl.classList.contains('is-collapsed');

      if (tableExpanded) {
        // 데이터 테이블이 펼쳐진 상태 → 사용자에게 숨기고 추출할지 묻기
        var confirmed = window.confirm('추출할 수 있는 페이지 영역을 초과합니다.\n데이터 테이블을 숨기고 추출할까요?');
        if (!confirmed) {
          console.log('[이미지 추출] 사용자 취소');
          return;
        }
        // 데이터 테이블 강제 숨김 후 재시도
        result = await captureSectionToA4(section, true);
        if (result.overflow) {
          // 숨겼는데도 초과 (미정의 케이스 — § 8 미결사항)
          alert('데이터 테이블을 숨겼지만 여전히 페이지 영역을 초과합니다.\n(현재 spec 미결사항 — 추후 처리 방식 정의 필요)');
          return;
        }
      } else {
        // 데이터 테이블이 이미 숨겨진 상태인데도 초과 (미정의 케이스 — § 8 미결사항)
        alert('차트 콘텐츠가 A4 한 페이지를 초과합니다.\n(현재 spec 미결사항 — 추후 처리 방식 정의 필요)');
        return;
      }
    }

    downloadCanvas(result.canvas, filename);
    console.log('[이미지 추출] 완료:', filename);
  } catch (err) {
    console.error('[이미지 추출] 오류:', err);
    alert('[이미지 추출 오류]\n' + (err && err.message ? err.message : String(err)) + '\n\n브라우저 콘솔(F12)에서 상세 내용을 확인해 주세요.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<img class="result-export-icon" src="assets/icons/add_photo_alternate_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true"> 이미지로 저장';
    }
  }
}

// 섹션을 A4 한 페이지 캔버스에 합성. 영역 초과 시 { overflow: true } 반환
/**
 * 결과를 PPTX·PNG 등으로 비동기 내보냅니다.
 */
async function captureSectionToA4(section, forceHideDataTable) {
  var hiddenEls = [];
  var displayHiddenEls = [];  // display:none 처리한 요소 (높이 영향)
  var widthRestore = null;    // 너비 강제 변경 복원용
  var pieViewBoxEls = [];

  try {
    // 제외 대상 UI 컨트롤 visibility:hidden (높이는 유지)
    EXPORT_HIDE_SELECTORS.forEach(function(sel) {
      section.querySelectorAll(sel).forEach(function(el) {
        el.style.visibility = 'hidden';
        hiddenEls.push(el);
      });
    });
    // 파이 차트 외부 레이블 클리핑 방지 — 캡처 시에만 viewBox·크기 확장
    section.querySelectorAll('.pie-svg').forEach(function(svg) {
      pieViewBoxEls.push({ el: svg, prevViewBox: svg.getAttribute('viewBox'), prevW: svg.style.width, prevH: svg.style.height });
      svg.setAttribute('viewBox', '-60 -60 400 400');
      svg.style.width = '400px';
      svg.style.height = '400px';
    });

    // 데이터 테이블 처리:
    //  - collapsed 상태 또는 forceHideDataTable일 때 → display:none (높이까지 제거)
    section.querySelectorAll('[data-data-table-section]').forEach(function(tableEl) {
      var isCollapsed = tableEl.classList.contains('is-collapsed');
      if (isCollapsed || forceHideDataTable) {
        displayHiddenEls.push({ el: tableEl, original: tableEl.style.display });
        tableEl.style.display = 'none';
      }
    });

    // 시안 비율(인쇄 시 적정 글자 크기) 매칭을 위해 캡처 직전에 .result-section 너비를 강제로 줄임.
    // 작은 너비에서 캡처 → 콘텐츠 폭(2126px)에 맞춰 큰 비율로 확대됨 → 폰트/차트가 시각적으로 커짐.
    widthRestore = {
      width: section.style.width,
      maxWidth: section.style.maxWidth,
      minWidth: section.style.minWidth,
      flex: section.style.flex,
    };
    section.style.width = EXPORT_CAPTURE_WIDTH + 'px';
    section.style.maxWidth = EXPORT_CAPTURE_WIDTH + 'px';
    section.style.minWidth = EXPORT_CAPTURE_WIDTH + 'px';
    section.style.flex = '0 0 ' + EXPORT_CAPTURE_WIDTH + 'px';
    void section.offsetHeight; // reflow 강제

    await document.fonts.ready;

    var naturalWidth = section.offsetWidth;
    var naturalHeight = section.offsetHeight;
    console.log('[이미지 추출] 캡처 시작 — 강제 너비:', EXPORT_CAPTURE_WIDTH,
                '/ 측정 너비:', naturalWidth, 'x', naturalHeight,
                '/ forceHideDataTable:', forceHideDataTable);

    // dom-to-image-more로 캡처 (html2canvas는 CSS color() 함수 미지원)
    var canvas = await domtoimage.toCanvas(section, {
      bgcolor: '#ffffff',
      width: naturalWidth,
      height: naturalHeight
    });
    console.log('[이미지 추출] 캡처 완료 — canvas:', canvas.width, 'x', canvas.height);

    // 콘텐츠 가용 폭(2126px)에 맞춰 비례 축소율 계산
    var scale = EXPORT_CONTENT_W / canvas.width;
    var scaledH = canvas.height * scale;
    console.log('[이미지 추출] 축소율:', scale.toFixed(4),
                '/ 축소 후 높이:', scaledH.toFixed(0),
                '/ 가용 높이:', EXPORT_CONTENT_H);

    // A4 한 페이지에 안 들어가면 overflow 반환
    if (scaledH > EXPORT_CONTENT_H) {
      return { overflow: true };
    }

    // 로고 로드 (base64 내장)
    var logoImg = null;
    try { logoImg = await loadImage(EXPORT_LOGO_DATA_URI); } catch(_) {}

    // A4 캔버스에 합성
    var out = document.createElement('canvas');
    out.width = EXPORT_PAGE_W;
    out.height = EXPORT_PAGE_H;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, EXPORT_PAGE_W, EXPORT_PAGE_H);

    // 캡처 이미지를 좌측 정렬 + 비례 축소해서 콘텐츠 영역에 그림
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      canvas,
      0, 0, canvas.width, canvas.height,
      EXPORT_MARGIN_X, EXPORT_MARGIN_TOP, EXPORT_CONTENT_W, scaledH
    );

    // 푸터 합성
    addFooterToCanvas(out, logoImg);

    return { overflow: false, canvas: out };
  } finally {
    // 복원
    try { hiddenEls.forEach(function(el) { el.style.visibility = ''; }); } catch(_) {}
    try { displayHiddenEls.forEach(function(item) { item.el.style.display = item.original; }); } catch(_) {}
    try { pieViewBoxEls.forEach(function(item) { item.el.setAttribute('viewBox', item.prevViewBox); item.el.style.width = item.prevW; item.el.style.height = item.prevH; }); } catch(_) {}
    try {
      if (widthRestore) {
        section.style.width = widthRestore.width;
        section.style.maxWidth = widthRestore.maxWidth;
        section.style.minWidth = widthRestore.minWidth;
        section.style.flex = widthRestore.flex;
      }
    } catch(_) {}
  }
}

// 로고 이미지 로더
/**
 * 이미지 URL을 로드해 HTMLImageElement로 반환합니다(Promise).
 */
function loadImage(src) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() { resolve(img); };
    img.onerror = function() { reject(new Error('이미지 로드 실패: ' + src)); };
    img.src = src;
  });
}

// A4 캔버스 하단 푸터 영역에 가로 구분선 + 로고 + 카피라이트 합성
// docs/image-export-spec.md § 4-4 기준
//
// 푸터 영역 = 페이지 하단 15mm (177px @ 300DPI). 다음 요소가 이 안에 모두 위치:
//   1) 푸터 영역 상단(=콘텐츠 영역 종료점)에 가로 구분선
//   2) 좌측 로고 + 우측 카피라이트 (구분선 아래, 푸터 영역 가운데 정렬)
/**
 * 내보내기 이미지 캔버스 하단에 푸터(로고 등)를 그립니다.
 */
function addFooterToCanvas(canvas, logoImg) {
  var ctx = canvas.getContext('2d');
  var footerY = EXPORT_PAGE_H - EXPORT_MARGIN_BOTTOM - EXPORT_FOOTER_H; // 푸터 영역 상단 Y (= 구분선 위치)
  var centerY = footerY + EXPORT_FOOTER_H / 2;                          // 로고/텍스트 세로 중앙

  // 1) 가로 구분선 (좌우 여백 적용, 얇은 회색)
  var lineThickness = 2; // 약 0.17mm
  ctx.fillStyle = '#e3e3e3'; // --neutral-200
  ctx.fillRect(EXPORT_FOOTER_PAD, footerY, EXPORT_PAGE_W - EXPORT_FOOTER_PAD * 2, lineThickness);

  // 2) 좌측: purple6studio 로고
  if (logoImg) {
    // 푸터 영역(177px ≈ 15mm) 안에서 약 60px (≈ 5mm) 높이
    var logoH = 60;
    var ratio = (logoImg.naturalWidth || logoImg.width) / (logoImg.naturalHeight || logoImg.height);
    var logoW = Math.round(logoH * ratio);
    ctx.drawImage(logoImg, EXPORT_FOOTER_PAD, centerY - logoH / 2, logoW, logoH);
  }

  // 3) 우측: 카피라이트 텍스트
  // Caption-1 (12px Regular) — 96 DPI 기준 → 300 DPI 캔버스에서 시각 크기 동일하게 환산
  // 12 * (300 / 96) ≈ 37.5px
  var fontSize = Math.round(12 * (EXPORT_DPI / 96));
  ctx.font = '400 ' + fontSize + 'px "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#000000'; // --Black (디자인 시스템 토큰 중 가장 진한 검정)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('© 2026 퍼플식스 스튜디오 (주)퍼시스. All rights reserved',
    EXPORT_PAGE_W - EXPORT_FOOTER_PAD, centerY);
}

/**
 * 캔버스를 PNG 파일로 저장 트리거합니다.
 */
function downloadCanvas(canvas, filename) {
  function triggerDownload(href) {
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  try {
    canvas.toBlob(function(blob) {
      if (blob) {
        var url = URL.createObjectURL(blob);
        triggerDownload(url);
        setTimeout(function() { URL.revokeObjectURL(url); }, 15000);
      } else {
        console.warn('[downloadCanvas] toBlob null, toDataURL fallback');
        triggerDownload(canvas.toDataURL('image/png'));
      }
    }, 'image/png');
  } catch (e) {
    console.warn('[downloadCanvas] toBlob threw, toDataURL fallback:', e);
    try {
      triggerDownload(canvas.toDataURL('image/png'));
    } catch (e2) {
      console.error('[downloadCanvas] both failed:', e2);
      alert('다운로드 실패. 브라우저 콘솔(F12)을 확인해 주세요.');
    }
  }
}
