/* 3대3 카드 논리 배틀 — 스테이지 진행(하→중→상) + 패배 시 하로 리셋 + 적팀 카드 보드 표시 */
(() => {
  const $ = (sel) => document.querySelector(sel);

  function setStatus(el, msg, ok = true) {
    const node = typeof el === 'string' ? $(el) : el;
    if (!node) return;
    node.textContent = msg || '';
    node.style.color = ok ? '#9ca3af' : '#fecaca';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>\"']/g, (m) => ({
      '&': '&',
      '<': '<',
      '>': '>',
      '"': '"',
      "'": '&#39;',
    })[m]);
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || data?.message || res.statusText || 'Request failed';
      const err = new Error(msg);
      err.response = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // =======================
  // 스테이지 상태 및 로스터
  // =======================
  const STAGE_KEY = 'stage';
  const STAGE_NAME = { 1: '하', 2: '중', 3: '상' };

  // 서버와 동일한 팀B 로스터(표시용)
  const TEAM_B_BY_STAGE = {
    1: [
      { name: '조환규', ability: '네스파 폭격(난해한 알고리즘 과제 지속 폭격)' },
      { name: '채흥석', ability: '학점 폭격(엄격 평가/F학점 투하)' },
      { name: '김정구', ability: '발표 지목(불시 발표 유도)' },
    ],
    2: [
      { name: '아카자', ability: '무도가·재생·기척감지' },
      { name: '조커', ability: '칼·기만·무자비(근접 약점)' },
      { name: '쿠파', ability: '납치·피지컬·등껍질 방어(느림)' },
    ],
    3: [
      { name: '시진핑', ability: '만리방화벽(검열·정보왜곡·여론조작)' },
      { name: '트럼프', ability: '관세 폭탄(무역·경제 압박)' },
      { name: '김정은', ability: '화성 미사일(ICBM·핵 위협)' },
    ],
  };

  // 이름 → 이미지 파일 베이스 매핑
  const NAME_TO_IMG = {
    '시진핑': 'ping',
    '트럼프': 'trump',
    '김정은': 'north',
    '아카자': 'kaza',
    '조커': 'joker',
    '쿠파': 'cupa',
    '조환규': 'cho',
    '채흥석': 'chae',
    '김정구': 'gu',
  };

  function getStage() {
    const v = parseInt(localStorage.getItem(STAGE_KEY) || '1', 10);
    if (!Number.isFinite(v) || v < 1 || v > 3) return 1;
    return v;
  }
  function setStage(n) {
    const v = parseInt(n, 10);
    const clamped = !Number.isFinite(v) ? 1 : Math.min(3, Math.max(1, v));
    localStorage.setItem(STAGE_KEY, String(clamped));
    return clamped;
  }

  // =======================
  // 적팀 카드 보드 렌더링
  // =======================
  function imgSrcForName(name) {
    const key = NAME_TO_IMG[name];
    if (!key) return null;
    return `/images/${key}.png`;
  }

  function renderEnemyBoard(stage) {
    const boardEl = $('#enemy-board');
    if (!boardEl) return;
    const roster = TEAM_B_BY_STAGE[stage] || [];
    if (!roster.length) {
      boardEl.innerHTML = '<div class="small">표시할 팀B 정보가 없습니다.</div>';
      return;
    }
    const html = roster
      .map((b) => {
        const src = imgSrcForName(b.name);
        const imgHtml = src
          ? `<img src="${src}" alt="${escapeHtml(b.name)}" loading="lazy" />`
          : `<div class="noimg">이미지 없음</div>`;
        return `
          <div class="card">
            <div class="image-wrap">
              ${imgHtml}
            </div>
            <div class="name">${escapeHtml(b.name)}</div>
            <div class="ability">${escapeHtml(b.ability)}</div>
          </div>
        `;
      })
      .join('');
    boardEl.innerHTML = html;
  }

  function updateUI() {
    const stage = getStage();
    const stageEl = $('#stage-label');
    if (stageEl) stageEl.textContent = `현재 스테이지: ${STAGE_NAME[stage]} (${stage}/3)`;
    renderEnemyBoard(stage);
  }

  // 승자 파싱(보수적으로 첫 매치만)
  function parseWinner(text) {
    if (typeof text !== 'string') return null;
    const m = /승자\s*:\s*(팀A|팀B)/.exec(text);
    if (!m) return null;
    return m[1]; // '팀A' | '팀B'
  }

  async function onRunBattle() {
    const statusEl = $('#status');
    const outEl = $('#output');

    const a1n = ($('#a1-name')?.value || '').trim();
    const a1a = ($('#a1-ability')?.value || '').trim();
    const a2n = ($('#a2-name')?.value || '').trim();
    const a2a = ($('#a2-ability')?.value || '').trim();
    const a3n = ($('#a3-name')?.value || '').trim();
    const a3a = ($('#a3-ability')?.value || '').trim();

    outEl.textContent = '';

    if (!a1n || !a1a || !a2n || !a2a || !a3n || !a3a) {
      setStatus(statusEl, '팀A의 이름/능력을 모두 입력하세요.', false);
      return;
    }

    const stage = getStage();
    setStatus(statusEl, `요청 중… (스테이지: ${STAGE_NAME[stage]})`);

    try {
      const body = {
        stage,
        teamA: [
          { name: a1n, ability: a1a },
          { name: a2n, ability: a2a },
          { name: a3n, ability: a3a },
        ],
      };

      const data = await fetchJson('/api/battle-simulate', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const txt = (data?.text || '').trim();
      outEl.textContent = txt || '[빈 응답]';

      // 승패 판정 및 스테이지 전이
      const winner = parseWinner(txt);
      if (winner === '팀A') {
        if (stage < 3) {
          const ns = setStage(stage + 1);
          setStatus(statusEl, `승리! 다음 스테이지로 이동합니다 → ${STAGE_NAME[ns]} (${ns}/3)`);
          updateUI();
        } else {
          setStatus(statusEl, '게임 클리어! 스테이지가 처음(하)으로 초기화되었습니다.');
          setStage(1);
          updateUI();
        }
      } else {
        // 팀B 승리 또는 파싱 실패 시 패배 처리 → 하로 리셋
        setStatus(statusEl, '패배. 스테이지가 하(1)로 리셋되었습니다.', false);
        setStage(1);
        updateUI();
      }
    } catch (e) {
      console.error(e);
      const detail = e?.response?.details || e.message || String(e);
      outEl.innerHTML = `<span class="warn">에러:</span> ${escapeHtml(typeof detail === 'string' ? detail : JSON.stringify(detail))}`;
      setStatus(statusEl, '실패', false);
    }
  }

  function onReset() {
    const statusEl = $('#status');
    setStage(1);
    updateUI();
    setStatus(statusEl, '스테이지를 하(1)로 초기화했습니다.');
    const outEl = $('#output');
    if (outEl) outEl.textContent = '';
  }

  window.addEventListener('DOMContentLoaded', () => {
    // 초기 UI 세팅
    updateUI();

    const btn = $('#btn-run');
    if (btn) btn.addEventListener('click', onRunBattle);

    const resetBtn = $('#btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', onReset);
  });
})();
