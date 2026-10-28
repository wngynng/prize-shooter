'use strict';
/* ============================================================
 * 《夜市神枪手》主程序
 * 屏幕状态机 + 经济系统(M4) + 展馆背包(M5) + 存档(M6)
 * + UI框架(M7) + 音效(M8) + 新手引导(M10)
 * ============================================================ */

/* ---------------- 音效（WebAudio 合成，M8） ---------------- */
const SFX = (() => {
  let ac = null;
  let muted = false;
  function unlock() {
    if (muted) return;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }
  function blip(f0, f1, dur, type, vol, delay) {
    if (muted || !ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  return {
    unlock,
    setMuted(m) { muted = m; },
    shoot() { blip(300, 60, 0.1, 'square', 0.08); },
    hit() { blip(880, 1400, 0.09, 'triangle', 0.16); },
    sell() { blip(660, 990, 0.12, 'triangle', 0.14); },
    fanfare() {
      blip(523, 523, 0.12, 'triangle', 0.14, 0);
      blip(659, 659, 0.12, 'triangle', 0.14, 0.12);
      blip(784, 784, 0.2, 'triangle', 0.16, 0.24);
    },
  };
})();

/* ---------------- 存档（M6 → v2：50 关架构，localStorage 容错） ----------------
 * v2：unlocked 由布尔数组改为关序 int（1~50，= 已解锁到第几关）+ titles 称号
 * v1 旧档只读迁移（迁移后写 v2，v1 原档保留不动，回退旧版本不丢进度） */
const SAVE_KEY = 'prizeShooterSave_v2';
const SAVE_KEY_V1 = 'prizeShooterSave_v1';
const STORE = (() => {
  let mem = null;
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); }
  catch (e) { mem = {}; }   // 无 localStorage 环境用内存兜底
  return {
    get(k) {
      try { return mem ? mem[k] : localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { if (mem) mem[k] = v; else localStorage.setItem(k, v); } catch (e) {}
    },
  };
})();

function defaultSave() {
  return {
    gold: CONFIG.ECONOMY.START_GOLD,
    inventory: {},                 // { prizeId: count } 当前持有（全部可售）
    dex: {},                       // { prizeId: true } 图鉴永久展出记录（卖出不消失）
    unlocked: 1,                   // 已解锁到第几关（1 = 仅第 1 关；上限 50）
    bestHits: new Array(LEVELS.length).fill(0),
    bestAcc: new Array(LEVELS.length).fill(0),
    lastFreeDay: '',
    lastReliefDay: '',
    seenHelp: false,
    muted: false,
    titles: [],                    // 通关称号（「夜市神枪手」等，M5 起授予）
  };
}

/* v1 → v2：布尔解锁数组 → 关序 int。
 * 旧档满进度（大师关已解锁，无可解锁关）→ 10（新第一章毕业，直入第二章）；
 * 旧嘉年华已解锁（= 已通旧小摊）→ 2；其余 → 1。金币/图鉴/库存原样继承。 */
function migrateFromV1(v1) {
  const s = defaultSave();
  s.gold = v1.gold != null ? v1.gold : s.gold;
  s.inventory = v1.inventory || {};
  s.dex = v1.dex || {};
  s.lastFreeDay = v1.lastFreeDay || '';
  s.lastReliefDay = v1.lastReliefDay || '';
  s.seenHelp = !!v1.seenHelp;
  s.muted = !!v1.muted;
  const b = v1.bestHits || [], a = v1.bestAcc || [];
  for (let i = 0; i < Math.min(b.length, s.bestHits.length); i++) s.bestHits[i] = b[i] || 0;
  for (let i = 0; i < Math.min(a.length, s.bestAcc.length); i++) s.bestAcc[i] = a[i] || 0;
  const u = v1.unlocked || [];
  if (u[2]) s.unlocked = 10;
  else if (u[1]) s.unlocked = 2;
  else s.unlocked = 1;
  return s;
}

/* 存档规范化：补齐数组长度 / 解锁范围 / 缺失字段（多标签热重载与旧 v2 兜底） */
function normalizeSave(s) {
  const out = Object.assign(defaultSave(), s);
  out.unlocked = clamp(Math.round(out.unlocked) || 1, 1, LEVELS.length);
  while (out.bestHits.length < LEVELS.length) out.bestHits.push(0);
  while (out.bestAcc.length < LEVELS.length) out.bestAcc.push(0);
  out.bestHits.length = LEVELS.length;
  out.bestAcc.length = LEVELS.length;
  if (!out.titles) out.titles = [];
  if (!out.dex) out.dex = {};
  if (!out.inventory) out.inventory = {};
  // 图鉴推导：老存档无 dex 字段时由现有库存补永久展出记录
  for (const id in out.inventory) {
    if (out.inventory[id] > 0) out.dex[id] = true;
  }
  return out;
}

const App = {
  save: null,
  scene: null,
  currentLevel: 0,
  freeUsedThisRun: false,
  hubChapter: null,      // 大厅两级导航：null = 章牌列表，否则章 id（章内关卡视图）

  /* ---------- 启动 ---------- */
  init() {
    let loaded = null;
    const raw = STORE.get(SAVE_KEY);
    try { if (raw) loaded = JSON.parse(raw); } catch (e) { loaded = null; }
    if (loaded) {
      this.save = normalizeSave(loaded);
    } else {
      // v1 旧档迁移：读 v1 → 转 v2（过 normalizeSave 补图鉴推导/字段）→ 立即写 v2
      // （v1 原档保留不动，回退旧版本不丢进度）
      const raw1 = STORE.get(SAVE_KEY_V1);
      let v1 = null;
      try { if (raw1) v1 = JSON.parse(raw1); } catch (e) { v1 = null; }
      this.save = v1 ? normalizeSave(migrateFromV1(v1)) : defaultSave();
      this.persist();
    }
    SFX.setMuted(this.save.muted);

    this._bind();
    this.syncOrientation();
    this.showHub();
    if (!this.save.seenHelp) this.showHelp(true);
  },
  persist() { STORE.set(SAVE_KEY, JSON.stringify(this.save)); },

  /* ---------- 屏幕方向（M16）：横屏游戏 ----------
   横屏版：触屏竖屏窗口时给 body 加 portrait-rot，由 CSS 把 #app 整体
   rotate(-90deg) 铺满屏幕（横屏画面侧向呈现，转动手机即转正）。
   --evw/--evh 是"等效视口"尺寸（旋转态下宽高互换），供原 vw/vh 样式使用；
   eff-w-narrow 用等效宽度替代媒体查询（媒体查询读物理方向，旋转态会判断错）。 */
  syncOrientation() {
    const touch = document.body.classList.contains('touch-ui');
    const landscape = matchMedia('(orientation: landscape)').matches;
    const rot = touch && !landscape;       // 竖屏窗口 → 旋转铺满兜底
    document.body.classList.toggle('portrait-rot', rot);
    const evW = rot ? window.innerHeight : window.innerWidth;
    const evH = rot ? window.innerWidth : window.innerHeight;
    const root = document.documentElement;
    root.style.setProperty('--evw', evW + 'px');
    root.style.setProperty('--evh', evH + 'px');
    document.body.classList.toggle('eff-h-short', evH < 480);
    document.body.classList.toggle('eff-w-narrow', evW < 720);
  },

  /* 画布自适应：在 .canvas-host（按键列之外的剩余空间）内按 16:9 等比放大到恰好填满（不裁切不变形）
   用 offsetWidth/offsetHeight（布局尺寸）：app 被 CSS 旋转时 getBoundingClientRect
   返回的是旋转后 AABB（宽高互换），会把画布算小 */
  _fitCanvas() {
    const host = document.querySelector('.canvas-host');
    const canvas = document.getElementById('gameCanvas');
    if (!host || !canvas) return;
    const w = host.offsetWidth, h = host.offsetHeight;
    if (w < 2 || h < 2) return;
    const s = Math.min(w / 960, h / 540);
    canvas.style.width = Math.round(960 * s) + 'px';
    canvas.style.height = Math.round(540 * s) + 'px';
  },

  today() { return new Date().toDateString(); },
  freeLeft() { return this.save.lastFreeDay !== this.today(); },
  useFree() { this.save.lastFreeDay = this.today(); this.persist(); },

  /* 可玩关卡：已解锁且所属章已开放（未开放章数据先行、入口锁定） */
  _playableLevels() {
    return LEVELS.filter((l, i) => i < this.save.unlocked && CHAPTERS[l.chapter].enabled);
  },
  /* 前沿章：玩家已解锁的最高可玩关所在章（未开放章向下回退到最近开放章） */
  _frontierChapter() {
    let chId = Math.floor((Math.min(this.save.unlocked, LEVELS.length) - 1) / 5);
    while (chId > 0 && !CHAPTERS[chId].enabled) chId--;
    return CHAPTERS[chId];
  },
  _frontierMinEntry() {
    const ch = this._frontierChapter();
    return Math.min(...ch.levels.map(l => l.entry));
  },
  reliefAvailable() {
    return this.save.lastReliefDay !== this.today()
      && this.save.gold < this._frontierMinEntry() && !this.freeLeft();
  },
  /* 动态救济金：三下限取最大——
   * ① 固定下限 60；② 最低可玩关门票（保证领后必能入场，不锁死）；
   * ③ 前沿章最低门票 × 0.6（后期破产也能快速回到本章） */
  reliefAmount() {
    const playable = this._playableLevels();
    const minPlayable = playable.length
      ? Math.min(...playable.map(l => l.entry)) : CONFIG.ECONOMY.RELIEF_GOLD;
    return Math.max(
      CONFIG.ECONOMY.RELIEF_GOLD,
      minPlayable,
      Math.round(this._frontierMinEntry() * CONFIG.ECONOMY.RELIEF_RATIO),
    );
  },

  /* ---------- 屏幕切换 ---------- */
  switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  /* ---------- 大厅 ---------- */
  showHub() {
    this.switchScreen('screen-hub');
    this.renderHub();
  },

  renderHub() {
    document.getElementById('hubGold').textContent = `🪙 ${this.save.gold}`;
    const free = document.getElementById('hubFree');
    free.textContent = this.freeLeft() ? '🎫 今日免费 ×1' : '🎫 今日免费 已用';
    free.classList.toggle('used', !this.freeLeft());
    document.querySelector('.hub-title p').textContent =
      `打中什么，拿什么 · 关卡进度 ${Math.min(this.save.unlocked, LEVELS.length)}/${LEVELS.length}`;

    // 救济金（动态：三下限取最大，见 reliefAmount）
    const rw = document.getElementById('reliefWrap');
    rw.innerHTML = '';
    if (this.reliefAvailable()) {
      const amt = this.reliefAmount();
      const b = document.createElement('button');
      b.className = 'btn btn-gold';
      b.textContent = `🆘 领取救济金 +${amt}🪙`;
      b.onclick = () => {
        this.save.gold += amt;
        this.save.lastReliefDay = this.today();
        this.persist();
        this.toast(`救济金 +${amt}🪙，明天也要来玩哦`);
        this.renderHub();
      };
      rw.appendChild(b);
    }

    // 章节大厅（两级导航：10 张章牌 ⇄ 章内 5 张关卡卡）
    const wrap = document.getElementById('levelCards');
    wrap.innerHTML = '';
    if (this.hubChapter === null) {
      wrap.className = 'chapter-grid';
      CHAPTERS.forEach(ch => wrap.appendChild(this._chapterCard(ch)));
    } else {
      wrap.className = 'level-cards';
      const ch = CHAPTERS[this.hubChapter];
      const head = document.createElement('div');
      head.className = 'chapter-head';
      head.innerHTML = `
        <button class="btn btn-ghost" type="button">← 返回章节</button>
        <div class="ch-title"><span class="ch-icon">${ch.icon}</span><b>第${ch.id + 1}章 · ${ch.name}</b>
          <span class="ch-theme">${ch.theme}</span></div>`;
      head.querySelector('button').onclick = () => { this.hubChapter = null; this.renderHub(); };
      wrap.appendChild(head);
      // 注意用 LEVELS 展开条目（含 chapter/chapterIndex），而非章模板原始对象
      for (let i = 0; i < ch.levels.length; i++) {
        wrap.appendChild(this._levelCard(LEVELS[ch.id * 5 + i], ch.id * 5 + i));
      }
    }
  },

  _chapterCard(ch) {
    const start = ch.id * 5;
    const chUnlocked = this.save.unlocked > start;      // 章内至少第 1 关已解锁
    const playable = ch.enabled && chUnlocked;
    const progress = clamp(this.save.unlocked - start, 0, 5);
    const card = document.createElement('div');
    card.className = 'chapter-card' + (playable ? '' : (ch.enabled ? ' locked' : ' disabled'));

    let status, statusCls = 'ch-status';
    if (!ch.enabled) { status = '🚧 敬请期待'; statusCls += ' soon'; }
    else if (!chUnlocked) { status = `🔒 通过「${LEVELS[start - 1].name}」解锁`; statusCls += ' lock'; }
    else { status = `已解锁 ${progress}/5`; }

    const entries = ch.levels.map(l => l.entry);
    card.innerHTML = `
      <div class="ch-top">
        <span class="ch-icon">${ch.icon}</span>
        <div class="ch-name"><b>第${ch.id + 1}章 · ${ch.name}</b>
          <span class="ch-stars">${'★'.repeat(ch.stars)}${'☆'.repeat(5 - ch.stars)}</span></div>
      </div>
      <div class="ch-theme">${ch.theme}</div>
      <div class="ch-meta">
        <span class="chip">🎫 ${Math.min(...entries)}~${Math.max(...entries)}🪙</span>
        <span class="chip ${statusCls}">${status}</span>
      </div>`;

    card.onclick = () => {
      if (!ch.enabled) { this.toast(`「${ch.name}」将在后续版本开放，敬请期待`); return; }
      if (!chUnlocked) { this.toast(`先通过上一章的验收关「${LEVELS[start - 1].name}」`); return; }
      this.hubChapter = ch.id;
      this.renderHub();
    };
    return card;
  },

  _levelCard(lvl, i) {
    const unlocked = i < this.save.unlocked && CHAPTERS[lvl.chapter].enabled;
    const card = document.createElement('div');
    card.className = 'level-card' + (unlocked ? '' : ' locked');

    // 徽章
    const badge = document.createElement('div');
    badge.className = `lv-badge b${lvl.stars}`;
    badge.innerHTML = `L${i + 1}<span class="stars">${'★'.repeat(lvl.stars)}</span>`;
    card.appendChild(badge);

    // 信息
    const info = document.createElement('div');
    info.className = 'lv-info';
    const chips = Object.entries(lvl.pool)
      .filter(([, n]) => n > 0)
      .map(([r, n]) => `<span class="chip r${r}">${CONFIG.RARITY[r].name}×${n}</span>`)
      .join('');
    const best = this.save.bestHits[i] > 0
      ? `最佳：命中 ${this.save.bestHits[i]}/${lvl.bullets} · 回收率 ${Math.round(this.save.bestAcc[i] * 100)}%`
      : '尚未挑战';
    info.innerHTML = `
      <h3>${lvl.name}</h3>
      <div class="lv-sub">${lvl.sub}</div>
      <div class="lv-meta">${chips}
        <span class="chip">🎫 ${lvl.bullets}发</span>
        <span class="chip">清台 +${lvl.clearBonus}🪙</span>
      </div>
      <div class="lv-best">${best}</div>`;
    card.appendChild(info);

    // 操作区
    const act = document.createElement('div');
    act.className = 'lv-action';
    if (!unlocked) {
      const tip = !CHAPTERS[lvl.chapter].enabled
        ? '该章节即将开放'
        : `「${LEVELS[i - 1].name}」命中 ≥${LEVELS[i - 1].unlockNextHits} 后解锁`;
      act.innerHTML = `<div class="lv-entry">🔒</div>
        <div class="lock-tip">${tip}</div>`;
    } else if (this.freeLeft()) {
      const b = document.createElement('button');
      b.className = 'btn btn-gold';
      b.textContent = '免费入场（今日1次）';
      b.onclick = () => this.startLevel(i, true);
      act.appendChild(b);
      act.insertAdjacentHTML('beforeend', `<div class="lv-entry">原价 ${lvl.entry}🪙</div>`);
    } else {
      const b = document.createElement('button');
      b.className = 'btn btn-gold';
      b.textContent = `入场 -${lvl.entry}🪙`;
      b.disabled = this.save.gold < lvl.entry;
      b.onclick = () => this.startLevel(i, false);
      act.appendChild(b);
      const own = document.createElement('div');
      own.className = 'lv-entry';
      own.textContent = `已有 ${this.save.gold}🪙`;
      act.appendChild(own);
    }
    card.appendChild(act);
    return card;
  },

  /* ---------- 开局（M4 经济入口） ---------- */
  startLevel(i, free) {
    const lvl = LEVELS[i];
    // 未开放章（数据先行、机制代码未落地）：入口锁定
    if (!CHAPTERS[lvl.chapter].enabled) {
      this.toast('该章节尚未开放，敬请期待');
      this.showHub();
      return;
    }
    if (free) {
      this.useFree();
    } else {
      if (this.save.gold < lvl.entry) {
        this.toast('金币不足！可等每日免费或领救济金');
        this.showHub();   // 回大厅，避免卡在已停止的射击画面
        return;
      }
      this.save.gold -= lvl.entry;
    }
    this.freeUsedThisRun = free;
    this.currentLevel = i;
    this.persist();

    // 移动端：借入场手势顺势全屏并锁定横屏（不阻塞开局，失败静默）
    if (document.body.classList.contains('touch-ui') && !document.fullscreenElement
        && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen()
        .then(() => screen.orientation && screen.orientation.lock
          ? screen.orientation.lock('landscape').catch(() => {}) : null)
        .catch(() => {});
    }

    this.switchScreen('screen-game');
    this._fitCanvas();
    // 新场景默认未开镜：复位开镜按钮高亮
    document.getElementById('btnScope').classList.remove('on');
    document.getElementById('btnBreath').classList.remove('on');
    document.getElementById('hudHint').textContent =
      (document.body.classList.contains('touch-ui') ? '【滑动瞄准 · 🫁 点按屏息时停 · 🔭 开镜 · 🔫 开火】' : '') + lvl.hint;

    const canvas = document.getElementById('gameCanvas');
    if (this.scene) this.scene.stop();
    this.scene = new ShootingScene(canvas, lvl, {
      updateHUD: (s) => this._updateHUD(s),
      onPrizeHit: () => {},
      onEnd: (res) => this._onRunEnd(res),
    });
    this.scene.start();
  },

  _hudCache: {},
  _updateHUD(s) {
    const c = this._hudCache;
    if (c.bullets !== s.bullets) {
      c.bullets = s.bullets;
      document.getElementById('hudBullets').textContent = `🎫 ×${s.bullets}`;
    }
    if (c.hits !== s.hits) {
      c.hits = s.hits;
      document.getElementById('hudHits').textContent = `🎯 ${s.hits}/${this.scene.level.bullets}`;
    }
    const wKey = `${s.wind.dir}|${s.wind.level}`;
    if (c.wind !== wKey) {
      c.wind = wKey;
      const el = document.getElementById('hudWind');
      if (!s.wind.level) el.textContent = '🍃 无风';
      else {
        const arrow = s.wind.dir > 0 ? '→→' : '←←';
        el.textContent = `🍃 ${arrow} ${s.wind.level}级`;
      }
    }
    const bar = document.getElementById('breathBar');
    bar.style.width = `${Math.round(s.breath * 100)}%`;
    // 调息锁定：耗尽后回满前，条转为红色斜纹（不可屏息）
    if (c.breathLock !== !!s.breathLock) {
      c.breathLock = !!s.breathLock;
      bar.classList.toggle('lock', c.breathLock);
    }
    // 屏息激活态：按钮亮环（点按切换，耗尽自动退出也要熄灭）
    if (c.breathOn !== !!s.breathing) {
      c.breathOn = !!s.breathing;
      document.getElementById('btnBreath').classList.toggle('on', c.breathOn);
    }
  },

  /* ---------- 结算（经济出口 + 解锁 + 最佳纪录） ---------- */
  _onRunEnd(res) {
    const lvl = LEVELS[this.currentLevel];
    const scene = this.scene;
    if (scene) { scene.stop(); this.scene = null; }

    // 奖品入库（M5）：全件可售；dex 记录永久图鉴（卖出不消失）
    for (const cat of res.prizes) {
      this.save.inventory[cat.id] = (this.save.inventory[cat.id] || 0) + 1;
      this.save.dex[cat.id] = true;
    }
    // 清台奖励
    let bonus = 0;
    if (res.cleared) {
      bonus = lvl.clearBonus;
      this.save.gold += bonus;
    }
    // 解锁下一关（存档 v2：unlocked 为关序 int，只前进不回退）
    let unlockedMsg = '';
    const nextIdx = this.currentLevel + 1;
    const next = LEVELS[nextIdx];
    if (next && res.hits >= lvl.unlockNextHits && nextIdx >= this.save.unlocked) {
      this.save.unlocked = nextIdx + 1;
      if (next.chapterIndex === 0) {
        const nch = CHAPTERS[next.chapter];
        unlockedMsg = nch.enabled
          ? `🔓 已解锁新章节：「第${nch.id + 1}章 · ${nch.name}」`
          : `🎓 当前章节全部通关——「${nch.name}」即将开放，敬请期待！`;
      } else {
        unlockedMsg = `🔓 已解锁新关卡：「${next.name}」`;
      }
    }
    // 最佳纪录
    const acc = res.shots > 0 ? res.hits / res.shots : 0;
    if (res.hits > this.save.bestHits[this.currentLevel]) this.save.bestHits[this.currentLevel] = res.hits;
    if (acc > this.save.bestAcc[this.currentLevel]) this.save.bestAcc[this.currentLevel] = acc;
    this.persist();

    const totalValue = res.prizes.reduce((s, p) => s + p.value, 0);
    const spent = this.freeUsedThisRun ? 0 : lvl.entry;
    const net = totalValue + bonus - spent;

    const raritySpan = (r) =>
      `<span class="r-tag chip r${r}">${CONFIG.RARITY[r].name}</span>`;

    const body = `
      <div class="result-grid">
        <div class="result-stat"><b>${res.shots}</b><span>发射</span></div>
        <div class="result-stat"><b>${res.hits}</b><span>命中</span></div>
        <div class="result-stat"><b>${res.shots ? Math.round(acc * 100) : 0}%</b><span>命中率</span></div>
        <div class="result-stat"><b>${res.prizes.length}</b><span>奖品</span></div>
      </div>
      ${res.prizes.length ? `<div class="prize-chips">${res.prizes.map(p =>
        `<span class="prize-chip">${p.emoji} ${p.name} ${raritySpan(p.rarity)} ·${p.value}🪙</span>`).join('')}</div>`
        : '<p>空手而归……下次试试先屏息再开枪？</p>'}
      ${res.cleared ? `<p style="color:#6ee7a0">🎉 清台奖励 +${bonus}🪙！</p>` : ''}
      ${res.early ? '<p style="color:#8b93ad">（中途退场：已赢的奖品保留，门票不退）</p>' : ''}
      ${unlockedMsg ? `<p style="color:#ffd873">${unlockedMsg}</p>` : ''}
      <p class="net ${net >= 0 ? 'pos' : 'neg'}">
        门票 -${spent}🪙 · 奖品可售 ${totalValue}🪙${bonus ? ` · 清台 +${bonus}🪙` : ''}
        → 净收支 ${net >= 0 ? '+' : ''}${net}🪙
      </p>
      <p style="color:#8b93ad;font-size:12px">提示：奖品已永久录入图鉴，可随时在「展馆」出售换金币。</p>`;

    if (res.cleared) SFX.fanfare();

    this._modal({
      title: res.cleared ? '🎉 满载而归！' : (res.hits > 0 ? '战果结算' : '下次一定…'),
      body,
      buttons: [
        { label: '返回大厅', cls: 'btn-ghost', fn: () => this.showHub() },
        {
          label: '再来一局', cls: 'btn-gold',
          fn: () => { this.startLevel(this.currentLevel, this.freeLeft()); },
        },
      ],
    });
  },

  /* ---------- 展馆 / 图鉴（M5） ---------- */
  showGallery() {
    this.switchScreen('screen-gallery');
    this.renderGallery();
  },

  renderGallery() {
    const inv = this.save.inventory;
    const dex = this.save.dex || {};
    const known = (c) => !!dex[c.id] || (inv[c.id] || 0) > 0;
    const collected = CATALOG.filter(known).length;
    // 全件可售：持有数 × 售价（首件也计入——图鉴记录由 dex 永久保留）
    const sellValue = CATALOG.reduce((s, c) => s + (inv[c.id] || 0) * c.value, 0);
    document.getElementById('galleryStats').innerHTML =
      `图鉴 <b>${collected}/${CATALOG.length}</b> · 可售价值 <b>${sellValue}🪙</b>`;

    const grid = document.getElementById('galleryGrid');
    grid.innerHTML = '';
    for (const r of ['SSR', 'SR', 'R', 'N']) {
      for (const cat of CATALOG.filter(c => c.rarity === r)) {
        grid.appendChild(this._galleryItem(cat, inv[cat.id] || 0, known(cat)));
      }
    }

    const footer = document.getElementById('galleryFooter');
    footer.innerHTML = '';
    if (sellValue > 0) {
      const b = document.createElement('button');
      b.className = 'btn btn-gold';
      b.textContent = `一键出售全部奖品 +${sellValue}🪙`;
      b.onclick = () => {
        for (const c of CATALOG) {
          if (this.save.inventory[c.id] > 0) this.save.inventory[c.id] = 0;
        }
        this.save.gold += sellValue;
        this.persist();
        SFX.sell();
        this.toast(`出售成功 +${sellValue}🪙`);
        this.renderGallery();
      };
      footer.appendChild(b);
    }
  },

  _galleryItem(cat, count, known) {
    const rc = CONFIG.RARITY[cat.rarity];
    const el = document.createElement('div');
    el.className = 'g-item' + (known ? '' : ' unknown');
    const sub = known
      ? ` 售价${cat.value}🪙 · ${count > 0
          ? `<span class="pinned">持有 ×${count}</span>`
          : `<span class="pinned">已售出 · 图鉴永久展出</span>`}`
      : '';
    const inner = `
      <div class="gi-emoji">${known ? cat.emoji : '❔'}</div>
      <div class="gi-name">${known ? cat.name : '？？？'}</div>
      <div class="gi-sub">
        ${`<span class="r-tag" style="color:${rc.color};border:1px solid ${rc.color}55">${rc.name}</span>`}${sub}
      </div>`;
    el.innerHTML = inner;
    if (count > 0) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `出售 ×${count}（+${count * cat.value}🪙）`;
      b.onclick = () => {
        this.save.inventory[cat.id] = 0;
        this.save.gold += count * cat.value;
        this.persist();
        SFX.sell();
        this.toast(`${cat.name} ×${count} 出售 +${count * cat.value}🪙`);
        this.renderGallery();
      };
      el.appendChild(b);
    }
    return el;
  },

  /* ---------- UI 基础设施（M7） ---------- */
  _modal({ title, body, buttons }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    root.classList.add('open');
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<h3>${title}</h3><div class="m-body">${body}</div>`;
    const btns = document.createElement('div');
    btns.className = 'm-btns';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.label;
      el.onclick = () => { root.classList.remove('open'); if (b.fn) b.fn(); };
      btns.appendChild(el);
    }
    m.appendChild(btns);
    root.appendChild(m);
  },

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2300);
  },

  /* ---------- 帮助（M10） ---------- */
  showHelp(first) {
    this._modal({
      title: '🎯 夜市神枪手 · 玩法',
      body: `
        <p><b>规则：</b>打中什么，拿什么！奖品全部摆在摊位上，命中即归你。</p>
        <p><b>章节：</b>50 关分 10 章，每章 1 种新玩法；通过每章第 5 关「验收关」解锁下一章。</p>
        <p><b>瞄准：</b>准星会随呼吸漂移，<b>屏息</b>（点按切换）稳住准星并让世界陷入<b>极慢的时停</b>——吊摆/传送带近乎冻结，<b>子弹不受影响照常飞行</b>、命中即时反馈；耐力条耗尽自动退出并需调息 5 秒（红色斜纹=不可用）。</p>
        <p><b>弹道：</b>高难度关卡有<b>风力</b>（顶栏风向标）和<b>下坠</b>——先试射一枪，看弹孔位置校准！</p>
        <p><b>奖品：</b>在展馆查看图鉴，随时可卖成金币——图鉴永久保留展出记录。</p>
        <p><b>金币：</b>每天 1 次免费入场 + 破产有救济金，永远玩得下去。</p>
        <p><b>操作：</b>🖱 鼠标移动瞄准，左键射击，空格点按屏息（时停）。<br>📱 横屏触屏：<b>滑动屏幕任意位置</b>移动准星（相对拖动，无需点住准星）；画布两侧按键：<b>左侧</b> 🫁 屏息（点按时停，再点退出）/ 🔫 开火，<b>右侧</b> 🔭 开镜（狙击镜 2×）/ 🔫 副开火（长按连发）。</p>
        <p><b>📱 横屏游玩最佳</b>；竖屏窗口时画面会旋转铺满提示转向，首次点击自动全屏。</p>`,
      buttons: [{ label: first ? '开始打枪！' : '知道了', cls: 'btn-gold' }],
    });
  },

  /* ---------- 事件绑定 ---------- */
  _bind() {
    // 触屏模式识别：粗指针设备或首次 touch 事件 → body.touch-ui（驱动布局微调）
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch-ui');
    window.addEventListener('touchstart', () => {
      document.body.classList.add('touch-ui');
      this.syncOrientation();     // 补注册的触屏设备：补算旋转态
    }, { once: true, passive: true });

    // 方向/尺寸变化：重算旋转态、等效视口与画布尺寸
    window.addEventListener('resize', () => { this.syncOrientation(); this._fitCanvas(); });
    window.addEventListener('orientationchange', () => { this.syncOrientation(); this._fitCanvas(); });
    if (window.ResizeObserver) {
      new ResizeObserver(() => this._fitCanvas()).observe(document.querySelector('.game-wrap'));
    }

    // 触屏首次点击：顺势全屏并尝试锁定横屏（浏览器不允许无手势强制系统方向，
    // 这是"打开即横屏全屏"的最接近实现；iOS 无锁屏 API，靠旋转显示兜底）
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen()
          .then(() => screen.orientation && screen.orientation.lock
            ? screen.orientation.lock('landscape').catch(() => {}) : null)
          .catch(() => {});
      }
    }, { once: true });

    // 多标签存档同步：file:// 下所有标签共享同一 localStorage。任一标签写入后，
    // 其他标签热重载内存存档——防止旧内存态覆盖新进度（"赢的钱被回滚"）。
    // 局中不重绘（场景状态独立于存档，结算只做增量写入）；大厅/展馆刷新显示。
    window.addEventListener('storage', (e) => {
      if (e.key !== SAVE_KEY) return;
      let fresh = null;
      try { if (e.newValue) fresh = JSON.parse(e.newValue); } catch (err) { fresh = null; }
      this.save = fresh ? normalizeSave(fresh) : defaultSave();
      SFX.setMuted(this.save.muted);
      const active = document.querySelector('.screen.active');
      if (active && active.id === 'screen-hub') this.renderHub();
      else if (active && active.id === 'screen-gallery') this.renderGallery();
    });

    document.getElementById('btnGallery').onclick = () => this.showGallery();
    document.getElementById('btnGalleryBack').onclick = () => this.showHub();
    document.getElementById('btnHelp').onclick = () => this.showHelp(false);

    // 全屏 + 横屏锁定（Android 支持锁定；iOS 无锁屏 API，靠旋转显示）
    document.getElementById('btnFullscreen').onclick = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          this.toast('已进入全屏沉浸模式');
        } else {
          await document.exitFullscreen();
        }
      } catch (e) { this.toast('当前浏览器不支持全屏'); return; }
      try {
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape');
        }
      } catch (e) { /* iOS 等不支持锁屏的环境静默忽略 */ }
    };

    document.getElementById('btnMute').onclick = (e) => {
      this.save.muted = !this.save.muted;
      SFX.setMuted(this.save.muted);
      this.persist();
      e.target.textContent = this.save.muted ? '🔇' : '🔊';
    };
    if (this.save.muted) document.getElementById('btnMute').textContent = '🔇';
    document.getElementById('btnReset').onclick = () => {
      this._modal({
        title: '重置存档？',
        body: `<p>金币、图鉴、50 关章节进度全部清空，重新从 ${CONFIG.ECONOMY.START_GOLD}🪙 开始。</p>`,
        buttons: [
          { label: '取消', cls: 'btn-ghost' },
          {
            label: '确认重置', cls: 'btn-danger',
            fn: () => { this.save = defaultSave(); this.persist(); this.showHub(); },
          },
        ],
      });
    };
    // 射击页按钮
    document.getElementById('btnExit').onclick = () => {
      this._modal({
        title: '提前退场？',
        body: '<p>已打中的奖品会保留，但门票不退哦。</p>',
        buttons: [
          { label: '继续打', cls: 'btn-gold' },
          { label: '退场', cls: 'btn-ghost', fn: () => { if (this.scene) this.scene.endEarly(); } },
        ],
      });
    };
    const breathBtn = document.getElementById('btnBreath');
    // 屏息 = 点按切换的时停模式（再点提前退出；耗尽自动退出+调息锁 5s）
    breathBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.scene) this.scene.toggleBreath();
    });

    // 触屏开火按钮（主/副同款）：点按开火，长按连发（射击间隔由冷却节流）
    const bindFireButton = (btn) => {
      let fireTimer = 0;
      const stopFire = () => clearInterval(fireTimer);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        SFX.unlock();
        if (this.scene) this.scene.shoot();
        fireTimer = setInterval(() => { if (this.scene) this.scene.shoot(); }, 280);
      });
      btn.addEventListener('pointerup', stopFire);
      btn.addEventListener('pointerleave', stopFire);
      btn.addEventListener('pointercancel', stopFire);
    };
    bindFireButton(document.getElementById('btnFire'));    // 左侧主开火
    bindFireButton(document.getElementById('btnFire2'));   // 右侧副开火（同逻辑）

    // 开镜按钮（右侧）：点按切换 2× 放大（拖动灵敏度随之减半，利于精瞄）
    const scopeBtn = document.getElementById('btnScope');
    scopeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      SFX.unlock();
      if (!this.scene) return;
      const on = this.scene.toggleScope();
      scopeBtn.classList.toggle('on', on);
    });
  },
};

App.init();
