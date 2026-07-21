//저장된 대시보드 리스트를 생성하고 관리하는 함수입니다.

// Shared saved dashboard list modal (home.html + dashboard.html)
// Depends on api-client.js for: loadSurveysFromServer, loadSurveys, saveSurveys, formatDate, deleteSurveyFiles (optional)
(function () {
  const DEFAULTS = {
    openButtonIds: [],
    countBadgeIds: ['saved-count'],
    openOnLoadStorageKey: 'openListOnLoad',
    emptyHtml: '아직 저장된 대시보드가 없습니다.<br>설문조사 파일을 업로드하고 대시보드를 만들면 여기에 쌓입니다.',
    openSurveyUrl: 'dashboard.html',
    listModalTitle: '저장된 대시보드 리스트'
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function getNumberTagDigitClass(value) {
    const digits = String(Math.abs(Number(value) || 0)).length;
    if (digits >= 3) return 'digits-3';
    if (digits === 2) return 'digits-2';
    return '';
  }

  function setNumberTagValue(el, value) {
    if (!el) return;
    el.textContent = String(value);
    el.classList.remove('digits-2', 'digits-3');
    const digitClass = getNumberTagDigitClass(value);
    if (digitClass) el.classList.add(digitClass);
  }

  function ensureModalDom(titleText) {
    let modal = document.getElementById('list-modal');
    if (modal) return modal;

    const html = `
      <div class="modal-backdrop" id="list-modal" role="dialog" aria-modal="true" aria-labelledby="list-modal-title">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title" id="list-modal-title">${escapeHtml(titleText || DEFAULTS.listModalTitle)}</div>
            <button class="modal-close" id="close-list-btn" aria-label="닫기" type="button">
              <img class="modal-close-icon" src="assets/icons/close_wght600fill1_40px.svg" alt="">
            </button>
          </div>
          <div class="modal-body" id="saved-list"></div>
          <div class="saved-tabs" id="saved-tabs">
            <button type="button" class="saved-tab is-active" data-tab="all">전체</button>
            <button type="button" class="saved-tab" data-tab="consulting">컨설팅</button>
            <button type="button" class="saved-tab" data-tab="research">리서치</button>
            <button type="button" class="saved-tab" data-tab="other">기타</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    modal = document.getElementById('list-modal');
    return modal;
  }

  function openSurvey(id) {
    const found = (typeof loadSurveys === 'function' ? loadSurveys() : []).find(s => s.id === id);
    if (!found) return;
    try {
      sessionStorage.setItem('survey.currentId', id);
      sessionStorage.setItem('survey.title', found.title);
    } catch (_) {}
    window.location.href = DEFAULTS.openSurveyUrl;
  }

  function bindListInteractions(savedListEl, refreshCount, emptyHtml) {
    if (!savedListEl) return;

    let activeTab = 'all';

    function renderList() {
      const allItems = typeof loadSurveys === 'function' ? loadSurveys() : [];
      const items = activeTab === 'all' ? allItems : allItems.filter(it => it.category === activeTab);
      savedListEl.innerHTML = '';

      if (!items || items.length === 0) {
        savedListEl.innerHTML = `<div class="saved-empty">${emptyHtml}</div>`;
        return;
      }

      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'saved-item';
        row.dataset.id = item.id;
        row.innerHTML = `
          <img class="drag-handle" src="assets/icons/drag_indicator_40dp_151515_FILL0_wght400_GRAD0_opsz40.svg" alt="" aria-hidden="true" draggable="true">
          <div class="saved-main" data-id="${escapeHtml(item.id)}">
            <div class="saved-title" data-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</div>
            <input type="text" class="saved-title-input" maxlength="50" hidden>
            <div class="saved-meta">저장일 ${escapeHtml((typeof formatDate === 'function' ? formatDate(item.updatedAt || item.createdAt) : (item.updatedAt || item.createdAt || '')))}</div>
          </div>
          <div class="saved-actions">
            <button type="button" class="saved-rename" data-rename="${escapeHtml(item.id)}">이름 바꾸기</button>
            <button type="button" class="saved-delete" data-del="${escapeHtml(item.id)}">삭제</button>
          </div>
        `;
        savedListEl.appendChild(row);
      });

      let dragSrcId = null;
      let lastInsertionKey = null;

      savedListEl.querySelectorAll('.saved-item').forEach(item => {
        item.addEventListener('dragstart', e => {
          if (!e.target.closest('.drag-handle')) {
            e.preventDefault();
            return;
          }
          dragSrcId = item.dataset.id;
          lastInsertionKey = null;
          savedListEl.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.dataset.id);
          const itemRect = item.getBoundingClientRect();
          e.dataTransfer.setDragImage(item, e.clientX - itemRect.left, e.clientY - itemRect.top);
          setTimeout(() => item.classList.add('dragging'), 0);
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          savedListEl.classList.remove('is-dragging');
          savedListEl.querySelectorAll('.saved-item').forEach(i => {
            i.classList.remove('drag-over');
            i.style.transition = '';
            i.style.transform = '';
          });
          dragSrcId = null;
          lastInsertionKey = null;

          // 탭 필터가 걸려있으면 화면엔 일부 항목만 보이므로, 필터에 안 걸린 항목은
          // 원래 자리 그대로 두고 필터된 항목들끼리만 새 순서로 치환한다
          // (그렇지 않으면 saveSurveys 쪽 diff 로직이 화면에 없는 항목을 "삭제됨"으로 오인함).
          const newIds = Array.from(savedListEl.querySelectorAll('.saved-item')).map(el => el.dataset.id);
          const fullList = typeof loadSurveys === 'function' ? loadSurveys() : [];
          const byId = new Map(fullList.map(s => [s.id, s]));
          const filteredIdSet = new Set(newIds);
          let cursor = 0;
          const reordered = fullList.map(item => {
            if (!filteredIdSet.has(item.id)) return item;
            const nextId = newIds[cursor++];
            return byId.get(nextId);
          });
          if (typeof saveSurveys === 'function') saveSurveys(reordered);
        });

        item.addEventListener('dragover', e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!dragSrcId || dragSrcId === item.dataset.id) return;

          const rect = item.getBoundingClientRect();
          const insertBefore = e.clientY < rect.top + rect.height / 2;
          const insertionKey = item.dataset.id + (insertBefore ? '-before' : '-after');
          if (lastInsertionKey === insertionKey) return;
          lastInsertionKey = insertionKey;

          const allItems = Array.from(savedListEl.querySelectorAll('.saved-item'));
          const draggingEl = allItems.find(el => el.dataset.id === dragSrcId);
          if (!draggingEl) return;

          // FLIP
          allItems.forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
          void savedListEl.offsetHeight;
          const firstTops = new Map();
          allItems.forEach(el => firstTops.set(el, el.getBoundingClientRect().top));

          if (insertBefore) item.before(draggingEl);
          else item.after(draggingEl);

          allItems.forEach(el => {
            if (el === draggingEl) return;
            const delta = firstTops.get(el) - el.getBoundingClientRect().top;
            if (Math.abs(delta) < 1) return;
            el.style.transition = 'none';
            el.style.transform = `translateY(${delta}px)`;
            void el.offsetHeight;
            el.style.transition = 'transform 150ms ease';
            el.style.transform = '';
          });
        });

        item.addEventListener('drop', e => { e.preventDefault(); });
      });

      savedListEl.querySelectorAll('.saved-main').forEach(main => {
        main.addEventListener('click', () => {
          const input = main.querySelector('.saved-title-input');
          if (input && !input.hidden) return;
          openSurvey(main.dataset.id);
        });
      });

      savedListEl.querySelectorAll('.saved-rename').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const row = btn.closest('.saved-item');
          const id = btn.dataset.rename;
          const titleEl = row.querySelector('.saved-title');
          const inputEl = row.querySelector('.saved-title-input');

          inputEl.value = titleEl.textContent;
          titleEl.hidden = true;
          inputEl.hidden = false;
          inputEl.focus();
          inputEl.select();

          function commit() {
            inputEl.removeEventListener('blur', commit);
            inputEl.removeEventListener('keydown', onKey);
            const next = inputEl.value.trim().slice(0, 50);
            if (next && typeof loadSurveys === 'function' && typeof saveSurveys === 'function') {
              const list = loadSurveys();
              const idx = list.findIndex(s => s.id === id);
              if (idx >= 0) {
                list[idx] = { ...list[idx], title: next, updatedAt: new Date().toISOString() };
                saveSurveys(list);
              }
            }
            renderList();
            refreshCount();
          }

          function cancel() {
            inputEl.removeEventListener('blur', commit);
            inputEl.removeEventListener('keydown', onKey);
            titleEl.hidden = false;
            inputEl.hidden = true;
          }

          function onKey(ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); inputEl.blur(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
          }

          inputEl.addEventListener('blur', commit);
          inputEl.addEventListener('keydown', onKey);
        });
      });

      savedListEl.querySelectorAll('[data-del]').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('이 대시보드를 삭제하시겠습니까?')) return;
          const id = el.dataset.del;
          const list = typeof loadSurveys === 'function' ? loadSurveys() : [];
          const target = list.find(s => s.id === id);
          const next = list.filter(s => s.id !== id);
          if (typeof saveSurveys === 'function') saveSurveys(next);
          if (typeof deleteSurveyFiles === 'function') {
            try { await deleteSurveyFiles(id, target && target.files, next); } catch (_) {}
          }
          renderList();
          refreshCount();
        });
      });
    }

    return {
      renderList,
      setActiveTab(tab) {
        activeTab = tab;
        renderList();
      }
    };
  }

  function initSavedListModal(userOptions) {
    const options = { ...DEFAULTS, ...(userOptions || {}) };
    const openButtons = options.openButtonIds
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (openButtons.length === 0) return;

    const modal = ensureModalDom(options.listModalTitle);
    const closeBtn = document.getElementById('close-list-btn');
    const savedListEl = document.getElementById('saved-list');

    const countBadges = (options.countBadgeIds || [])
      .map(id => document.getElementById(id))
      .filter(Boolean);

    function refreshCount() {
      const count = typeof loadSurveys === 'function' ? loadSurveys().length : 0;
      countBadges.forEach(b => setNumberTagValue(b, count));
    }

    const listApi = bindListInteractions(savedListEl, refreshCount, options.emptyHtml);

    const tabButtons = Array.from(modal.querySelectorAll('.saved-tab'));
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.toggle('is-active', b === btn));
        listApi.setActiveTab(btn.dataset.tab);
      });
    });

    function open() {
      if (listApi && listApi.renderList) listApi.renderList();
      modal.classList.add('show');
    }

    function close() {
      modal.classList.remove('show');
    }

    openButtons.forEach(btn => btn.addEventListener('click', open));
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    // Initial load + badge update
    const loadPromise = (typeof loadSurveysFromServer === 'function')
      ? loadSurveysFromServer().catch(() => {})
      : Promise.resolve();
    Promise.resolve(loadPromise).then(() => refreshCount());

    try {
      if (sessionStorage.getItem(options.openOnLoadStorageKey) === '1') {
        sessionStorage.removeItem(options.openOnLoadStorageKey);
        open();
      }
    } catch (_) {}

    return { open, close, refreshCount };
  }

  window.initSavedListModal = initSavedListModal;
})();

