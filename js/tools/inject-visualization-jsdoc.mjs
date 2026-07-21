/**
 * visualizations.js 최상위 함수 선언 위에 JSDoc 블록을 한 번에 삽입합니다.
 * 실행: node js/tools/inject-visualization-jsdoc.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(__dirname, '..', 'visualizations.js');

function hasJSDocAbove(lines, idx) {
  let j = idx - 1;
  while (j >= 0 && lines[j].trim() === '') j--;
  if (j < 0) return false;
  if (!lines[j].trim().endsWith('*/')) return false;
  for (let k = j - 1; k >= 0; k--) {
    const t = lines[k].trim();
    if (t.startsWith('/**')) return true;
    if (/^function\s+\w+/.test(lines[k])) return false;
  }
  return false;
}

function describeFunction(name) {
  const n = name;
  if (n === 'readAsText') return 'File을 UTF-8 텍스트로 읽어 Promise로 반환합니다.';
  if (n === 'escapeHtml') return 'HTML 삽입용으로 &, <, 따옴표 등을 이스케이프합니다.';
  if (n === 'parseCSV') return 'CSV 문자열을 따옴표/쉼표 규칙에 맞게 2차원 배열로 파싱합니다.';
  if (n === 'readTabularFile') return '업로드 파일(현재 CSV)을 읽어 행 배열과 원문을 반환합니다.';
  if (n === 'normalizeHeader') return '열 이름 비교용으로 앞뒤 공백·BOM을 제거하고 소문자로 맞춥니다.';
  if (n === 'cleanCell') return '셀 값을 문자열로 정리(트림)합니다.';
  if (n === 'checkColumns') return '헤더 행에 필수 컬럼이 모두 있는지 검사합니다.';
  if (n === 'validateFileForKey') return '코드북/값/라벨 파일 종류별로 행 구조가 올바른지 검증합니다.';
  if (n === 'getCodebookQuestionLabels') return '코드북 시트에서 question_label 열 값 목록을 추출합니다.';
  if (n === 'getResponseQuestionHeaders') return '응답 시트 헤더에서 survey_year, respondent_no 뒤의 문항 열명을 반환합니다.';
  if (n === 'arraysEqualNormalized') return '두 배열을 cleanCell 기준으로 같은지 비교합니다.';
  if (n === 'findFirstHeaderMismatch') return '두 헤더 배열에서 처음 어긋나는 인덱스와 값을 반환합니다.';
  if (n === 'validateCodebookAgainstResponse') return '코드북 문항 순서/이름이 응답 데이터 열과 맞는지 검증합니다.';
  if (n === 'validateResponsePair') return '값 시트와 라벨 시트의 행·열 구조 일관성을 검증합니다.';
  if (n === 'detectValueLabelSwap') return '값/라벨 파일이 서로 뒤바뀌었는지 코드북 힌트로 추정합니다.';
  if (n === 'validateBundleConsistency') return '로드된 코드북·값·라벨 묶음 전체를 교차 검증합니다.';
  if (n === 'loadCodebookRows') return '저장된 코드북 파일 레코드에서 행 배열을 비동기로 불러옵니다.';
  if (n === 'buildQuestionTree') return '코드북 행으로 문항 계층(섹션/문항) 트리 구조를 만듭니다.';
  if (n === 'renderTree') return '문항 트리를 HTML 목록으로 렌더링합니다.';
  if (n === 'setupAccordion') return '문항 목록 아코디언(접기/펼치기) 동작을 연결합니다.';
  if (n === 'setupSearch') return '문항 검색 입력과 필터링 UI를 연결합니다.';
  if (n === 'setupPanelToggle') return '좌우 패널 토글 버튼 동작을 연결합니다.';
  if (n === 'setupSelectionAndDragDrop') return '문항 선택, 드래그앤드롭, 비교/기준 영역 한도 등을 연결합니다.';
  if (n === 'buildFilterCandidates') return '코드북·라벨 데이터로 필터 후보(연도·응답값 등)를 구성합니다.';
  if (n === 'getDefaultFilterKeys') return '필터 후보에서 기본으로 켤 필터 키 목록을 반환합니다.';
  if (n === 'getActiveFilterItems') return '현재 활성화된 필터 슬롯 항목을 반환합니다.';
  if (n === 'getSelectedValues') return '특정 필터 키에 선택된 값 집합을 반환합니다.';
  if (n === 'getCandidateByKey') return '필터 키에 해당하는 후보 메타데이터를 반환합니다.';
  if (n === 'getFilteredRowIndexes') return '현재 필터에 통과한 응답 행 인덱스 배열을 반환합니다.';
  if (n === 'getFilteredRowCount') return '필터 통과 행 수를 반환합니다.';
  if (n === 'getRowsByIndexes') return '행 배열에서 주어진 인덱스만 골라 부분 배열을 만듭니다.';
  if (n === 'updateFilterCount') return '필터 UI의 응답 수 표시를 갱신합니다.';
  if (n === 'renderFilterSummary') return '필터 한 줄 요약 HTML을 생성합니다.';
  if (n === 'renderFilters') return '필터 패널 전체 DOM을 다시 그립니다.';
  if (n === 'moveActiveFilter') return '활성 필터 순서를 바꿉니다(드래그 정렬 등).';
  if (n === 'positionPopupWithinMainArea') return '앵커 기준으로 팝업 메뉴 위치를 메인 영역 안에 맞춥니다.';
  if (n === 'updateCriterionYearButtonVisibility') return '기준(분모) 연도 버튼 표시 여부를 현재 상태에 맞게 조정합니다.';
  if (n === 'setupFilters') return '필터 UI를 초기화하고 후보를 채운 뒤 이벤트를 연결합니다.';
  if (n === 'setupFilterListeners') return '필터 변경 시 결과 갱신 등 리스너를 등록합니다.';
  if (n === 'renameSurvey') return '저장된 설문 이름을 바꿉니다(스토리지 반영).';
  if (n === 'setupTitleRename') return '설문 제목 인라인 편집 UI를 연결합니다.';
  if (n === 'setupSavedModal') return '저장된 설문 목록 모달을 구성하고 이벤트를 연결합니다.';
  if (n === 'getNumberTagDigitClass') return '숫자 자릿수에 맞는 CSS 클래스 이름을 반환합니다.';
  if (n === 'setNumberTagValue') return '숫자 태그 요소의 텍스트와 자릿수 클래스를 갱신합니다.';
  if (n === 'isFreeTextHeaderName') return '열 이름이 기타 서술형(기타 텍스트) 컬럼인지 판별합니다.';
  if (n === 'parseValueCodeMap') return '코드북의 value_code_map 문자열을 코드→라벨 맵으로 파싱합니다.';
  if (n === 'buildCodebookIndex') return '코드북 행으로 문항 메타데이터 인덱스(맵/배열)를 구축합니다.';
  if (n === 'getTargetChipLabels') return '비교 대상으로 선택된 문항 라벨 목록을 반환합니다.';
  if (n === 'getCriterionChipLabel') return '기준(분모) 문항 라벨을 반환합니다.';
  if (n === 'getScaleCompareGroupKey') return '척도 다문항 비교 UI에서 그룹 식별 키를 만듭니다.';
  if (n === 'getTargetScaleCompareLabels') return '척도 비교에 쓸 대상 문항 라벨 목록을 반환합니다.';
  if (n === 'refreshTargetScaleCompareControl') return '척도 비교 대상 선택 컨트롤 표시를 최신 상태로 맞춥니다.';
  if (n === 'clearDropZone') return '지정 드롭존의 선택 칩을 비웁니다.';
  if (n === 'getFilteredLabelDataRows') return '필터가 적용된 라벨(텍스트) 응답 행을 반환합니다.';
  if (n === 'getFilteredValueDataRows') return '필터가 적용된 값(코드) 응답 행을 반환합니다.';
  if (n === 'getCriterionEntry') return '기준 문항 라벨에 해당하는 코드북 엔트리를 찾습니다.';
  if (n === 'getExpandedMultiOptionItems') return '다중선택 문항의 선택지 목록(확장 포함)을 반환합니다.';
  if (n === 'getMultiSelectionsFromRow') return '한 행에서 다중선택 값을 파싱해 선택지 배열로 만듭니다.';
  if (n === 'getRatioAllocationDataSource') return '비율 배분 집계에 쓸 라벨/값 행 소스를 고릅니다.';
  if (n === 'getExpandedRatioAllocationItems') return '비율 배분 하위 항목(열) 목록을 헤더 맵과 함께 확장합니다.';
  if (n === 'getRatioAllocationValuesFromRaw') return '원시 행에서 비율 배분 숫자 배열을 추출합니다.';
  if (n === 'getRatioAllocationValues') return '확장 항목 순서에 맞게 행에서 비율 값 배열을 만듭니다.';
  if (n === 'summarizeRatioAllocationRecords') return '비율 배분 레코드를 옵션 순서대로 합산·요약합니다.';
  if (n === 'aggregateResultQuestion') return '문항 유형에 따라 단일/다중/척도 등 적절한 집계 함수로 위임합니다.';
  if (n === 'aggregateTargetScaleCompareData') return '여러 대상 척도 문항을 같은 기준으로 묶어 비교용 데이터를 집계합니다.';
  if (n === 'sortScaleCompareQuestionsByMean') return '척도 비교 표에서 문항을 평균 기준으로 정렬합니다.';
  if (n === 'getDisplayScaleCompareGroups') return '숨김 처리 반영 후 실제로 그릴 척도 비교 그룹 목록을 반환합니다.';
  if (n === 'findRankExpandedColumns') return '순위 문항의 확장(세분) 열 인덱스를 찾습니다.';
  if (n === 'applyRankSortToData') return '순위 집계 데이터에 정렬 옵션을 적용합니다.';
  if (n === 'getRankFirstChoiceRows') return '순위 데이터에서 1순위 비율 행만 추려 반환합니다.';
  if (n === 'getRankFirstChoiceForGroup') return '특정 그룹·선택지의 1순위 비율을 반환합니다.';
  if (n === 'getRank1stSyntheticLabel') return '1순위 합성 문항 표시용 라벨을 만듭니다.';
  if (n === 'aggregateRank1stSingle') return '1순위만 단일선택처럼 집계합니다.';
  if (n === 'findOtherTextColumnIndex') return '기타 서술형 응답 열 인덱스를 찾습니다.';
  if (n === 'getOtherResponseTexts') return '기타 서술형 응답 텍스트 목록을 수집합니다.';
  if (n === 'getSingleChoiceSectionData') return '단일선택 결과 섹션용 표시 데이터를 준비합니다.';
  if (n === 'addSingleChoiceChartToSlide') return 'PPTX 슬라이드에 단일선택 차트/표를 배치합니다.';
  if (n === 'composePage') return '원본 캔버스의 일부 영역을 한 페이지 캔버스로 복사합니다.';
  if (n === 'addFooterToCanvas') return '내보내기 이미지 캔버스 하단에 푸터(로고 등)를 그립니다.';
  if (n === 'downloadCanvas') return '캔버스를 PNG 파일로 저장 트리거합니다.';
  if (n === 'tableToTsv') return '테이블 DOM을 TSV(탭 구분) 문자열로 직렬화합니다.';
  if (n === 'getTableSectionCellEntries') return '복사용으로 테이블 셀을 행 단위 엔트리로 나눕니다.';
  if (n === 'getResponseCountColumnIndexes') return '표에서 응답 수(n) 열 인덱스를 찾습니다.';
  if (n === 'prepareResultTableForCopy') return '복사 시 제외할 열을 반영해 테이블 데이터를 정리합니다.';
  if (n === 'getVizLabelColWidthKey') return '문항 라벨 열 너비를 localStorage에 저장할 키를 반환합니다.';
  if (n === 'pruneVizLabelColWidths') return '사라진 문항에 대한 저장된 라벨 열 너비를 정리합니다.';
  if (n === 'applyRememberedSectionVizLabelColWidth') return '저장된 라벨 열 너비를 섹션에 적용합니다.';
  if (n === 'getGroupConfigTargetLabel') return '사용자 정의 그룹 설정이 묶인 대상 문항 라벨을 반환합니다.';
  if (n === 'getDisplayGroupResults') return '숨긴 그룹을 제외한 그룹별 결과 배열을 반환합니다.';
  if (n === 'getCustomGroupLegendMembers') return '범례 한 줄에 표시할 사용자 정의 그룹 구성원을 반환합니다.';
  if (n === 'getCurrentResultTargetLabelsForCustomGroup') return '같은 기준으로 묶인 결과 대상 문항 라벨들을 반환합니다.';
  if (n === 'shouldApplyCustomGroup') return '이 결과 데이터에 사용자 정의 그룹 합산을 적용할지 판단합니다.';
  if (n === 'buildCustomScaleCompareData') return '사용자 정의 그룹이 반영된 척도 비교 데이터를 만듭니다.';
  if (n === 'getChoiceChartRows') return '단일선택 차트용 행 데이터(비율 등)를 만듭니다.';
  if (n === 'getScaleDisplayResults') return '척도 막대/트랙에 쓸 점수별 표시용 결과를 가공합니다.';
  if (n === 'getScaleCompareCandidateEntries') return '척도 다문항 비교 후보 엔트리 목록을 반환합니다.';
  if (n === 'getScaleCompareSelectedLabels') return '비교 모달에서 선택된 척도 문항 라벨을 반환합니다.';
  if (n === 'collectFiniteNumericValues') return '열에서 유한한 숫자만 모아 배열로 반환합니다.';
  if (n === 'getNumericHistogramDomain') return '히스토그램 축 범위(최소·최대)를 추정합니다.';
  if (n === 'getNumericOpenValueFormatter') return '숫자/시간 단위에 맞는 값 포맷 함수를 반환합니다.';
  if (n === 'getScaleScoreRange') return '코드북 엔트리에서 척도 점수 범위 배열을 반환합니다.';
  if (n === 'getScaleScoreLabel') return '점수값에 해당하는 라벨을 코드북에서 찾습니다.';
  if (n === 'getScaleMeanLeftPct') return '평균 점수를 0–100% 트랙 상의 좌표로 변환합니다.';
  if (n === 'getScalePolaritySummary') return '척도 응답의 긍·부정 요약 통계를 냅니다.';
  if (n === 'getScaleValueStats') return '척도 원시 값 배열의 평균·분산 등 기초 통계를 냅니다.';
  if (n === 'getDefaultNumericHistogramStep') return '히스토그램 구간 폭 기본값을 데이터에서 추천합니다.';
  if (n === 'getDefaultNumericHistogramStart') return '히스토그램 시작값 기본값을 데이터에서 추천합니다.';
  if (n === 'getNumericValueLeftPct') return '숫자 값을 축 범위 내 백분율 위치로 변환합니다.';
  if (n === 'getSingleChoiceChartType') return '단일선택 결과의 차트 유형(파이/스택 등)을 반환합니다.';
  if (n === 'getScaleChartType') return '척도 결과 차트 유형을 반환합니다.';
  if (n === 'getRatioChartType') return '비율 배분 결과 차트 유형을 반환합니다.';
  if (n === 'getRankChartType') return '순위 결과 차트 유형을 반환합니다.';
  if (n === 'getRankSortByScore') return '순위 정렬이 점수 기준인지 여부/설정을 반환합니다.';
  if (n === 'getSingleChoiceSortByRate') return '단일선택 막대 정렬이 응답률 기준인지 반환합니다.';
  if (n === 'getScaleViewMode') return '척도 시각화 보기 모드(분포/평균 등)를 반환합니다.';
  if (n === 'getChoiceChartSortMode') return '단일선택 차트 정렬 모드를 반환합니다.';
  if (n === 'getRankChartViewMode') return '순위 차트 보기 모드를 반환합니다.';
  if (n === 'getRankChartSortMode') return '순위 차트 정렬 모드를 반환합니다.';
  if (n === 'canHideScaleMidpoint') return '척도 중립점 숨김을 지원하는지 데이터를 보고 판단합니다.';
  if (n === 'isScaleMidpointHidden') return '해당 문항에서 척도 중립점이 숨겨졌는지 상태를 반환합니다.';
  if (n === 'isDerivedScaleEntry') return '코드북 엔트리가 파생(연산) 척도인지 판별합니다.';
  if (n === 'isValidRatioAllocationValues') return '비율 배분 값 배열이 유효한지 검사합니다.';
  if (n === 'isMarkedMultiSelected') return '다중선택 표기 문자열이 선택됨을 나타내는지 판별합니다.';
  if (n === 'isOtherOption') return '선택지가 기타(직접입력) 옵션인지 판별합니다.';
  if (n === 'isPinnedSortOption') return '정렬 시 항상 끝/앞에 고정되는 옵션인지 판별합니다.';
  if (n === 'isResponseCountHeaderCell') return '표 헤더 셀이 응답 수 열인지 판별합니다.';
  if (n === 'countRemovedColumns') return '구간 내에서 제거 대상 열이 몇 개 겹치는지 셉니다.';
  if (n === 'removeColumnsFromRows') return '행 배열에서 지정 인덱스 열들을 삭제합니다.';
  if (n === 'clampVizLabelColWidth') return '라벨 열 너비를 허용 범위로 클램프합니다.';
  if (n === 'nextCustomGroupId') return '새 사용자 정의 그룹 ID를 발급합니다.';
  if (n === 'cloneGroupDefs') return '그룹 정의 배열을 깊은 복사합니다.';
  if (n === 'cloneGroupAssignments') return '응답→그룹 배정 맵을 복제합니다.';
  if (n === 'getDefaultGroupName') return '새 그룹의 기본 표시 이름을 만듭니다.';
  if (n === 'buildComparableGroupConfigState') return '모달에서 비교/저장할 그룹 설정 상태 객체를 만듭니다.';
  if (n === 'getGroupMembers') return '그룹 ID에 배정된 응답 값 목록을 반환합니다.';
  if (n === 'getDraftGroupColor') return '편집 중인 그룹 색상을 반환합니다.';
  if (n === 'finalizeGroupConfigGroupName') return '그룹 이름 입력을 확정(트림·빈 이름 처리)합니다.';
  if (n === 'hasGroupConfigChanges') return '저장 전 그룹 설정에 변경이 있는지 검사합니다.';
  if (n === 'focusGroupConfigNameInput') return '그룹 이름 입력란에 포커스를 둡니다.';
  if (n === 'clearGroupConfigDropHighlight') return '드래그 하이라이트 클래스를 제거합니다.';
  if (n === 'pptxPaletteColor') return 'PPTX용 RGB 색 객체를 팔레트 인덱스로 반환합니다.';
  if (n === 'loadImage') return '이미지 URL을 로드해 HTMLImageElement로 반환합니다(Promise).';

  const isType =
    n.startsWith('is') &&
    (n.includes('Type') || n === 'isTimeMinutesEntry' || n === 'isNumericOpenEntry' || n === 'isTimeOpenRawEntry');
  if (isType) return `코드북 response_type 등에서 "${n.replace(/^is/, '').replace(/Type$/, '')}" 유형 여부를 판별합니다.`;

  if (n.startsWith('is') && n.includes('Entry')) return '코드북 엔트리(문항 정의)가 특정 하위 유형인지 판별합니다.';

  if (n.startsWith('supports')) return '해당 문항 유형/엔트리가 결과 패널에서 지원되는지 판별합니다.';

  if (n.startsWith('format') && n.includes('Rank')) return '순위 평균/가중 등 표시용 문자열로 포맷합니다.';
  if (n.startsWith('format') && (n.includes('Scale') || n === 'formatScaleCompareMean'))
    return '척도 점수·평균 등 표시용 문자열로 포맷합니다.';
  if (n.startsWith('format') && n.includes('Numeric')) return '숫자/단위 포함 표시 문자열로 포맷합니다.';
  if (n.startsWith('format') && (n.includes('Percent') || n.includes('Decimal'))) return '퍼센트·소수 표시 형식으로 포맷합니다.';
  if (n.startsWith('formatTooltip')) return '차트 툴팁에 넣을 HTML 문자열을 데이터 객체로부터 만듭니다.';

  if (n.startsWith('aggregate') && n.includes('Single')) return '단일선택 문항을 기준(교차)별로 응답 분포를 집계합니다.';
  if (n.startsWith('aggregate') && n.includes('Multi')) return '다중선택 문항을 기준별로 선택 비율을 집계합니다.';
  if (n.startsWith('aggregate') && n.includes('Scale')) return '척도 문항을 기준별로 점수 분포·평균 등을 집계합니다.';
  if (n.startsWith('aggregate') && n.includes('Rank')) return '순위 문항을 기준별로 순위 분포를 집계합니다.';
  if (n.startsWith('aggregate') && n.includes('Numeric')) return '숫자/시간 입력 문항을 기준별로 히스토그램·통계를 집계합니다.';
  if (n.startsWith('aggregate') && n.includes('Text')) return '서술형 문항 응답 텍스트를 수집·요약합니다.';
  if (n.startsWith('aggregate') && n.includes('Ratio')) return '비율 배분 문항을 기준별로 합산·요약합니다.';
  if (n.startsWith('aggregate')) return '응답 행을 기준에 따라 집계합니다.';

  if (n.startsWith('parseFinite')) return '화면 표시용 숫자 문자열을 유한 실수로 파싱합니다.';

  if (n.startsWith('clamp') || n.startsWith('normalize') && n.includes('Histogram'))
    return '히스토그램 간격·시작값 등을 유효 범위로 조정합니다.';

  if (n.startsWith('build') && n.includes('Rank')) return '순위형 문항 차트·범례·표·컨트롤 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('ScaleCompare')) return '여러 척도 문항 비교 표/차트 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Scale') && !n.includes('Compare')) return '단일 척도 문항 분포·축·범례·표 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('DerivedScale')) return '파생 척도(바이올린·박스 등) 시각화 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Numeric')) return '숫자/시간 개방형 문항 차트·축·표 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Ratio') && n.includes('Allocation')) return '비율 배분 문항 차트·스택·표 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('GroupCompare')) return '그룹 간 비교(가로/세로 막대 등) HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Pie')) return '파이 차트 SVG/HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Choice') && !n.includes('Group')) return '단일·다중 선택 문항용 컨트롤·차트·표 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Stack')) return '100% 스택 막대 등 누적 비교 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Legend')) return '범례 영역 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('DataTable')) return '결과 데이터 테이블 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Section')) return '결과 패널에서 문항별 섹션(차트+표) HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Result')) return '결과 블록 헤더·레이아웃 래퍼 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Filter')) return '필터 UI 관련 HTML/요약을 생성합니다.';
  if (n.startsWith('build') && (n.includes('Vertical') || n.includes('ChartShell') || n.includes('Grid')))
    return '세로형 차트 공통 축·그리드·쉘 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Histogram')) return '히스토그램 막대·축 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Whisker')) return '박스플롯 수염 트랙 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('TextOpen')) return '서술형 문항 결과 섹션 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Other')) return '기타 응답 목록/모달 관련 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Question')) return '문항 전체 설명·타이틀 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('Toggle')) return '보기/정렬 토글 컨트롤 HTML을 생성합니다.';
  if (n.startsWith('build') && n.includes('CustomGroup')) return '사용자 정의 그룹이 반영된 집계 데이터를 만듭니다.';
  if (n.startsWith('build')) return '차트·표·컨트롤 등 화면용 HTML 조각을 생성합니다.';

  if (n.startsWith('render') && n.includes('GroupConfig')) return '사용자 정의 그룹 설정 모달 내용을 DOM에 그립니다.';
  if (n.startsWith('render') && n.includes('Table')) return '데이터 테이블 셀 라벨을 HTML 이스케이프와 함께 렌더링합니다.';

  if (n.startsWith('get') && n.includes('Filtered')) return '현재 필터가 적용된 행/부분집합을 반환합니다.';
  if (n.startsWith('get') && n.includes('Group') && n.includes('Color')) return '그룹 비교 범례용 색상을 반환합니다.';
  if (n.startsWith('get') && n.includes('Option') && n.includes('Palette')) return '선택지별 팔레트 색을 반환합니다.';
  if (n.startsWith('get') && n.includes('Rank')) return '순위 차트/정렬 관련 설정값을 반환합니다.';
  if (n.startsWith('get') && n.includes('Choice')) return '선택형 차트 표시/정렬 상태를 반환합니다.';
  if (n.startsWith('get') && n.includes('Expanded')) return '코드북·헤더를 반영해 확장된 하위 항목 목록을 반환합니다.';
  if (n.startsWith('get') && n.includes('Binary')) return '이진(예/아니오) 선택지 확장 정보를 반환합니다.';
  if (n.startsWith('get')) return '현재 UI/상태/인덱스에서 파생 값을 조회합니다.';

  if (n.startsWith('sort') && n.includes('Rows')) return '행 배열을 지표 함수와 정렬 모드에 따라 정렬합니다.';
  if (n.startsWith('sort') && n.includes('Scale')) return '척도 비교 데이터의 정렬을 수행합니다.';

  if (n.startsWith('apply') && n.includes('Choice')) return '단일선택 데이터에 정렬 옵션을 적용합니다.';
  if (n.startsWith('apply') && n.includes('DataTable')) return '데이터 테이블 접기/펼치기 상태를 적용합니다.';
  if (n.startsWith('apply') && n.includes('Remembered')) return '저장된 라벨 열 너비를 섹션에 적용합니다.';

  if (n.startsWith('set') && n.includes('Section')) return '섹션의 문항 라벨 열 너비를 설정·저장합니다.';

  if (n.startsWith('ensure')) return '필요 시 DOM 요소/전역 훅을 한 번만 생성·초기화합니다.';
  if (n.startsWith('attach')) return '결과 컨테이너에 리사이저·이벤트 등을 연결합니다.';
  if (n.startsWith('align')) return '그룹/척도 비교 차트들의 레이아웃을 맞춥니다.';
  if (n.startsWith('observe')) return '드롭존 등 DOM 변화를 관찰해 UI를 갱신합니다.';
  if (n.startsWith('hook')) return '필터 변경 등에 결과 리렌더를 후킹합니다.';

  if (n.startsWith('open') && n.includes('Modal')) return '모달을 열고 초기 상태를 채웁니다.';
  if (n.startsWith('close') && n.includes('Modal')) return '모달을 닫고 포커스를 복구합니다.';
  if (n.startsWith('apply') && n.includes('Modal')) return '모달에서 확인한 선택을 상태에 반영합니다.';
  if (n.startsWith('setup') && n.includes('Modal')) return '모달 DOM 이벤트와 키보드 접근성을 연결합니다.';

  if (n.startsWith('onTip')) return '차트 툴팁 마우스 이벤트 핸들러입니다.';
  if (n.startsWith('positionTooltip')) return '툴팁 요소를 포인터 근처로 이동시킵니다.';

  if (n.startsWith('rankStackColor') || n.startsWith('allocationColor'))
    return '차트 팔레트용 고정/순환 색 값을 반환합니다.';

  if (n.startsWith('addExport')) return '결과 섹션에 이미지/PPTX 내보내기 버튼을 붙입니다.';

  if (n.startsWith('export') || n.startsWith('capture')) return '결과를 PPTX·PNG 등으로 비동기 내보냅니다.';

  if (n.startsWith('copy') && n.includes('Result')) return '결과 테이블을 클립보드로 비동기 복사합니다.';
  if (n.startsWith('copyText')) return '클립보드 API 실패 시 대체 복사를 시도합니다.';

  if (n.startsWith('showDashboard')) return '짧은 토스트 메시지를 표시합니다.';

  if (n.startsWith('init')) return '결과 탭 기능을 초기화하고 첫 렌더를 수행합니다.';
  if (n.startsWith('ensureCodebook')) return '코드북 인덱스가 없으면 로드·구축합니다.';

  if (n.startsWith('renderResults')) return '필터·선택 상태에 맞춰 전체 결과 패널을 다시 그립니다.';

  if (n.startsWith('find') && n.includes('Time')) return '시간(분) 파생 열에 대응하는 라벨 열을 찾습니다.';

  return `${n}: 대시보드 시각화/집계 로직의 일부입니다(이름·호출 맥락 참고).`;
}

function main() {
  const raw = fs.readFileSync(TARGET, 'utf8');
  const lines = raw.split(/\r?\n/);
  const funcs = [];
  const re = /^(async )?function (\w+)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) funcs.push({ i, name: m[2], async: Boolean(m[1]) });
  }
  funcs.sort((a, b) => b.i - a.i);
  let inserted = 0;
  for (const f of funcs) {
    if (hasJSDocAbove(lines, f.i)) continue;
    const desc = describeFunction(f.name);
    const block = ['/**', ` * ${desc}`, ' */'];
    lines.splice(f.i, 0, ...block);
    inserted++;
  }
  fs.writeFileSync(TARGET, lines.join('\n'), 'utf8');
  console.log(`JSDoc 삽입: ${inserted}개 (건너뜀: ${funcs.length - inserted}개, 이미 블록 주석 있음)`);
}

main();
