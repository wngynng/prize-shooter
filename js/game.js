'use strict';
/* ============================================================
 * 射击场景引擎（Canvas）—— 功能模块 M1 / M9（横屏）
 * 瞄准(漂移) / 屏息=时停 / 开镜 / 弹道(风偏+下坠+散布) / 命中判定 / 表现动画
 * 公平性根基：弹着点 = 准星 + 可见风偏 + 可学习下坠 + 微散布
 * ============================================================ */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, k) { return a + (b - a) * k; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class ShootingScene {
  constructor(canvas, level, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // 高分屏适配：物理分辨率渲染，逻辑坐标恒为 960×540（横屏）
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 960 * this.dpr;
    canvas.height = 540 * this.dpr;
    this.level = level;
    this.hooks = hooks || {};
    this.W = 960;
    this.H = 540;
    this.destroyed = false;

    // 输入状态
    this.aim = { x: this.W / 2, y: this.H * 0.30 };
    this.pointerType = 'mouse';
    this._aimPointerId = null;   // 触屏时追踪"瞄准手指"
    this._lastClient = null;
    this.breathMeter = 1;         // 0~1
    this.breathing = false;       // 屏息=时停（点按切换；耗尽自动退出）
    this._breathLock = false;     // 调息锁：耗尽后须回满才能再屏息
    this.zoomed = false;          // 开镜（倍率见 CONFIG.SHOOTING.SCOPE.ZOOM）
    this.rt = 0;                  // 真实时钟（结束判定/欣赏动画；与世界慢镜解耦）

    // 局内状态
    this.t = 0;
    this.bulletsLeft = level.bullets;
    this.shots = 0;
    this.hits = 0;
    this.prizesWon = [];
    this.cleared = false;
    this.ended = false;
    this._endScheduled = false;
    this.endAt = 0;
    this.lastShotAt = 0;

    // 风
    if (level.wind.mode === 'none') this.wind = { dir: 0, level: 0 };
    else this.wind = this._rollWind(level.wind.level);

    // 场景对象
    this.prizes = [];
    this.tracers = [];
    this.holes = [];
    this.particles = [];
    this.floats = [];
    this.stars = this._makeStars();
    // 传送带（单带横穿底部 / 对开双带 384+442 反向）与转盘（环形靶）：
    // 带速与角速度由关卡参数化（铁轨夜市章），方向每局随机定正反
    const M = level.moving || {};
    this.beltDir = Math.random() < 0.5 ? -1 : 1;
    this.belts = [];
    if (M.conveyor) {
      const speed = M.conveyorSpeed || 55;
      if (M.conveyorLanes === 2) {
        this.belts.push({ y: 384, dir: -this.beltDir, speed, offset: 0 });
        this.belts.push({ y: 442, dir: this.beltDir, speed, offset: 0 });
      } else {
        this.belts.push({ y: 442, dir: this.beltDir, speed, offset: 0 });
      }
    }
    // 转盘：环形轨道（圆心/半径固定，角速度参数化，转向每局随机）
    this.ring = (M.ring || 0) > 0
      ? { cx: 480, cy: 318, r: 92, w: (M.ringSpeed || 0.55) * (Math.random() < 0.5 ? -1 : 1) }
      : null;
    // 架板行让位：有转盘只留顶行；对开双带留顶上两行
    this.shelfRows = this.ring ? [210] : (M.conveyorLanes === 2 ? [210, 288] : [210, 292, 374]);
    this.shake = 0;
    this.muzzle = 0;
    this._raf = 0;
    this._lastTs = 0;

    this._spawnPrizes();
  }

  /* ---------------- 生命周期 ---------------- */

  start() {
    this._onMove = (e) => {
      if (e.pointerType === 'touch') {
        // 触屏：全屏滑动瞄准（相对拖动，准星只随手势位移移动，不跟手指落点，
        // 无需先点到准星上；单指滑到画布任意处均生效）
        if (this._aimPointerId === e.pointerId && this._lastClient) {
          this._applyDragDelta(
            e.clientX - this._lastClient.x,
            e.clientY - this._lastClient.y,
            1,
          );
          this._lastClient = { x: e.clientX, y: e.clientY };
        }
      } else {
        this._updateAim(e);
      }
    };
    this._onDown = (e) => {
      SFX.unlock();
      this.pointerType = e.pointerType || 'mouse';
      if (this.pointerType === 'touch') {
        // 只登记瞄准手指，不移动准星（避免跳跃/遮挡）；
        // 多指防劫持：已有瞄准手指时忽略后落手指（拇指去按开火/开镜
        // 时擦过画布不会夺走瞄准控制权）
        e.preventDefault();   // 抑制触屏默认行为（拖选/聚焦等兜底）
        if (this._aimPointerId === null) {
          this._aimPointerId = e.pointerId;
          this._lastClient = { x: e.clientX, y: e.clientY };
        }
      } else {
        this._updateAim(e);
        if (e.button === 0) this.shoot();
      }
    };
    // 触屏开火改由 HUD 的 🔫 按钮负责，抬手不再走火
    this._onUp = (e) => {
      if (e.pointerType === 'touch' && this._aimPointerId === e.pointerId) {
        this._aimPointerId = null;
        this._lastClient = null;
      }
    };
    this._onCancel = (e) => this._onUp(e);
    this._onCtx = (e) => e.preventDefault();
    this._onKeyDown = (e) => {
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.toggleBreath(); }
    };
    this._onKeyUp = (e) => { /* 屏息为点按切换，抬键无操作 */ };

    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('contextmenu', this._onCtx);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onCancel);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this._lastTs = performance.now();
    this._raf = requestAnimationFrame((ts) => this._tick(ts));
  }

  stop() {
    this.destroyed = true;
    cancelAnimationFrame(this._raf);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('contextmenu', this._onCtx);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onCancel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  /* 玩家中途退出：保留已赢奖品，无清台奖励（不退票） */
  endEarly() {
    if (this.ended) return;
    this.ended = true;
    if (this.hooks.onEnd) this.hooks.onEnd(this.getResult());
  }

  getResult() {
    return {
      shots: this.shots,
      hits: this.hits,
      prizes: this.prizesWon.slice(),
      cleared: this.cleared,
      bulletsLeft: this.bulletsLeft,
      early: this.ended && !this._endScheduled,
    };
  }

  /* ---------------- 奖品布场 ---------------- */

  _rollWind(maxLevel) {
    return { dir: Math.random() < 0.5 ? -1 : 1, level: 1 + ((Math.random() * maxLevel) | 0) };
  }

  _makeStars() {
    const s = [];
    for (let i = 0; i < 70; i++) {
      s.push({
        x: Math.random() * this.W, y: Math.random() * 160,
        r: Math.random() < 0.3 ? 2 : 1,
        tw: 1 + Math.random() * 2, phase: Math.random() * 6.28,
      });
    }
    return s;
  }

  _spawnPrizes() {
    const L = this.level;
    // 1) 按稀有度从图鉴抽（尽量不重复，图鉴不够允许重复）
    const bag = [];
    for (const r of ['N', 'R', 'SR', 'SSR']) {
      const n = L.pool[r] || 0;
      if (!n) continue;
      const cands = shuffle(CATALOG.filter(c => c.rarity === r).slice());
      for (let i = 0; i < n; i++) bag.push(cands[i % cands.length]);
    }
    shuffle(bag);

    // 2) 吊摆位（挂雨棚下，横屏顶部横向铺开）
    const swingN = L.moving.swing || 0;
    for (let i = 0; i < swingN && bag.length; i++) {
      const cat = bag.pop();
      const ax = lerp(150, 810, swingN === 1 ? 0.5 : i / (swingN - 1));
      this.prizes.push({
        cat, kind: 'swing',
        anchorX: ax, anchorY: 62,
        len: 46 + Math.random() * 12,
        amp: 0.5 + Math.random() * 0.12,   // 摆角幅度(rad)
        T: 2.2 + Math.random() * 0.8,      // 周期(s)
        phase: Math.random() * Math.PI * 2,
        x: ax, y: 140,
      });
    }

    // 3) 传送带位（单带横穿底部；对开双带 = 上 384 / 下 442 两条反向带，交替分配）
    const convN = L.moving.conveyor || 0;
    for (let i = 0; i < convN && bag.length; i++) {
      const cat = bag.pop();
      const belt = this.belts[this.belts.length > 1 ? (i % 2) : 0];
      this.prizes.push({
        cat, kind: 'conveyor',
        x: 140 + Math.random() * 680,
        vx: belt.dir * belt.speed * (0.9 + Math.random() * 0.2),
        x0: 70, x1: 870, beltY: belt.y,
      });
    }

    // 3.5) 转盘位（环形轨道均布公转——切向运动，预判提前量按转向算）
    const ringN = L.moving.ring || 0;
    for (let i = 0; i < ringN && bag.length; i++) {
      const cat = bag.pop();
      this.prizes.push({
        cat, kind: 'ring',
        angle0: (i / ringN) * Math.PI * 2,
      });
    }

    // 4) 其余上架板（行数随布局让位：转盘让出中下层、双带让出最下层）
    const rows = this.shelfRows;
    const counts = rows.map(() => 0);
    bag.forEach((_, i) => { counts[i % rows.length]++; });
    let idx = 0;
    rows.forEach((rowY, ri) => {
      const n = counts[ri];
      for (let i = 0; i < n; i++, idx++) {
        const cat = bag[idx];
        const x = n === 1 ? 480 : lerp(140, 820, i / (n - 1)) + (Math.random() * 24 - 12);
        this.prizes.push({ cat, kind: 'shelf', x, y: rowY, rowY });
      }
    });

    // 公共字段
    for (const p of this.prizes) {
      p.hitR = CONFIG.RARITY[p.cat.rarity].hitR;
      p.state = 'idle';
      if (p.kind === 'shelf') p.y = p.rowY - p.hitR * 0.8 - 2;
      if (p.kind === 'conveyor') p.y = p.beltY - p.hitR * 0.75;
      if (p.kind === 'ring' && this.ring) {
        const a = p.angle0 + this.ring.w * this.t;
        p.x = this.ring.cx + Math.cos(a) * this.ring.r;
        p.y = this.ring.cy + Math.sin(a) * this.ring.r;
      }
    }
  }

  /* ---------------- 输入 ---------------- */

  /* 竖屏旋转显示态（main.js syncOrientation 切换 body.portrait-rot）
   单一事实来源：读取该类即知画布坐标轴被 CSS 旋转了 -90° */
  _isRotated() {
    return document.body.classList.contains('portrait-rot');
  }

  /* 开镜缩放中心 = 准星本身（不钳制）：十字分划线恒在镜片正中，视野随准星
     平移——贴边瞄准时镜内会露出世界外的夜空（椭圆视野可越出世界范围，
     越出部分只是空区；代价可接受，准星永居中才是硬需求）。 */
  _zoomCenter() { return this._crosshair(); }

  _updateAim(e) {
    const rect = this.canvas.getBoundingClientRect();
    let wx, wy;
    if (this._isRotated()) {
      // 旋转态：局部 +x 沿屏幕向上、局部 +y 沿屏幕向右（触屏笔记本等混合场景）
      wx = (rect.bottom - e.clientY) * (this.W / Math.max(1, rect.height));
      wy = (e.clientX - rect.left) * (this.H / Math.max(1, rect.width));
    } else {
      wx = (e.clientX - rect.left) * (this.W / Math.max(1, rect.width));
      wy = (e.clientY - rect.top) * (this.H / Math.max(1, rect.height));
    }
    // 开镜逆映射：屏幕点 → 世界点（围绕缩放中心除以倍率）
    if (this.zoomed && !this.ended) {
      const z = CONFIG.SHOOTING.SCOPE.ZOOM;
      const c = this._zoomCenter();
      wx = c.x + (wx - c.x) / z;
      wy = c.y + (wy - c.y) / z;
    }
    this.aim.x = clamp(wx, 0, this.W);
    this.aim.y = clamp(wy, 0, this.H);
  }

  /* 相对拖动增量（公共入口：画布触屏拖动共用）
   * dvx/dvy = 手指在屏幕坐标系下的位移（px）；gain = 灵敏度倍率（画布拖动=1）
   * 含竖屏旋转态的方向逆映射：#app 被 CSS rotate(-90deg) 时画布局部 +x 沿屏幕
   * 向上、局部 +y 沿屏幕向右 → 手指增量逆映射为 (-dvy, dvx)；
   * 旋转后包围盒宽高互换，故 x 缩放用 rect.height、y 用 rect.width。
   * 开镜时灵敏度随倍率降低（准星移动量 ÷ ZOOM，利于精瞄） */
  _applyDragDelta(dvx, dvy, gain) {
    const rect = this.canvas.getBoundingClientRect();
    let dx, dy;
    if (this._isRotated()) {
      dx = -dvy * (this.W / Math.max(1, rect.height));
      dy = dvx * (this.H / Math.max(1, rect.width));
    } else {
      dx = dvx * (this.W / Math.max(1, rect.width));
      dy = dvy * (this.H / Math.max(1, rect.height));
    }
    const z = (this.zoomed && !this.ended) ? CONFIG.SHOOTING.SCOPE.ZOOM : 1;
    this.aim.x = clamp(this.aim.x + dx * gain / z, 0, this.W);
    this.aim.y = clamp(this.aim.y + dy * gain / z, 0, this.H);
  }

  /* 屏息 = 点按切换的时停模式：
     点按进入（耐力条开始消耗）→ 再点提前退出；耗尽自动退出并上调息锁（5s 回满解锁）。
     锁定期点按无效——防"空条反复开关"。 */
  toggleBreath() {
    if (this.ended) return;
    if (this.breathing) { this.breathing = false; return; }   // 手动提前退出（不锁）
    if (this._breathLock || this.breathMeter <= 0) return;    // 调息中：不可进入
    this.breathing = true;
  }
  toggleScope() {
    this.zoomed = !this.zoomed;
    return this.zoomed;
  }

  _crosshair() {
    const A = this.level.sway * (this.breathing ? CONFIG.SHOOTING.BREATH.SWAY_FACTOR : 1);
    return {
      x: this.aim.x + A * Math.sin(this.t * 1.7),
      y: this.aim.y + A * Math.sin(this.t * 2.3 + 1.2),
    };
  }

  _windOffset() {
    if (!this.wind.level) return 0;
    return this.wind.dir * this.wind.level * CONFIG.SHOOTING.WIND_PX_PER_LEVEL
      * (0.85 + Math.random() * 0.3);
  }

  /* ---------------- 射击 ---------------- */

  shoot() {
    if (this.ended || this._endScheduled) return;
    const now = performance.now();
    if (now - this.lastShotAt < CONFIG.SHOOTING.SHOT_COOLDOWN_MS) return;
    if (this.bulletsLeft <= 0) return;
    this.lastShotAt = now;
    this.bulletsLeft--;
    this.shots++;

    const c = this._crosshair();
    const ix = c.x + this._windOffset() + (Math.random() * 2 - 1) * CONFIG.SHOOTING.SPREAD;
    const iy = c.y + this.level.drop + (Math.random() * 2 - 1) * CONFIG.SHOOTING.SPREAD;

    this.tracers.push({
      from: { x: this.W / 2, y: this.H - 12 },
      to: { x: ix, y: iy },
      t: 0, dur: CONFIG.SHOOTING.TRACER_MS / 1000,
    });
    this.shake = 2.5;
    this.muzzle = 1;
    SFX.shoot();

    // perShot 模式：为下一枪重摇风力
    if (this.level.wind.mode === 'perShot') this.wind = this._rollWind(this.level.wind.level);
  }

  _resolveImpact(tr) {
    const { x, y } = tr.to;
    this.holes.push({ x, y });
    if (this.holes.length > 40) this.holes.shift();

    let best = null, bd = Infinity;
    for (const p of this.prizes) {
      if (p.state !== 'idle') continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= p.hitR && d < bd) { best = p; bd = d; }
    }
    if (best) this._hitPrize(best);
    else {
      for (let i = 0; i < 6; i++) {   // 落空尘土反馈
        const a = Math.random() * Math.PI * 2;
        this.particles.push({
          x, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 40,
          life: 0.3 + Math.random() * 0.2, color: '#8b93a7', r: 2,
        });
      }
    }
  }

  _hitPrize(p) {
    p.state = 'falling';
    p.fall = { vx: (Math.random() - 0.5) * 90, vy: -260, rot: 0, vr: (Math.random() - 0.5) * 7 };
    this.hits++;
    this.prizesWon.push(p.cat);
    const rc = CONFIG.RARITY[p.cat.rarity];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 180;
      this.particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.4 + Math.random() * 0.3, color: rc.color, r: 2 + Math.random() * 2.5,
      });
    }
    this.floats.push({ x: p.x, y: p.y - 30, text: `${p.cat.emoji} +1`, life: 0.9, color: rc.color });
    SFX.hit();
    if (this.hooks.onPrizeHit) this.hooks.onPrizeHit(p.cat);
  }

  /* ---------------- 帧循环 ---------------- */

  _tick(ts) {
    if (this.destroyed) return;
    const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
    this._lastTs = ts;
    this.update(dt);
    this.render();
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  update(dt) {
    // 屏息 = 时停（M9）：点按进入（breathing 状态），耐力条按真实时间消耗；
    // 耗尽自动退出并上调息锁——空条回满 RECHARGE 秒内不能再屏息
    // （提前再点退出不受锁，可立即续用余量）。
    const B = CONFIG.SHOOTING.BREATH;
    if (this.breathing) {
      this.breathMeter = Math.max(0, this.breathMeter - dt / B.DURATION);
      if (this.breathMeter <= 0) {
        this.breathing = false;         // 耗尽 → 自动退出时停
        this._breathLock = true;        // → 进入调息
      }
    } else {
      this.breathMeter = Math.min(1, this.breathMeter + dt / B.RECHARGE);
      if (this._breathLock && this.breathMeter >= 1) this._breathLock = false;  // 回满解除
    }
    // 世界时间步长：屏息期间世界极慢（SCALE=0.05 的"时停"感）——吊摆/传送带/
    // 坠落/粒子近乎冻结；但子弹曳光与命中结算走真实 dt（开枪不受慢镜影响，
    // 命中即时反馈），浮字（+分反馈）同样走真实时间。
    const wdt = this.breathing ? dt * B.SCALE : dt;
    this.t += wdt;
    this.rt += dt;               // 真实时钟：结束判定/欣赏动画计时（慢镜不拖结算）

    // 奖品运动（吊摆相位由 this.t 驱动，t 冻结即自动冻结）
    for (const p of this.prizes) {
      if (p.state === 'idle') {
        if (p.kind === 'swing') {
          const th = p.amp * Math.sin((this.t / p.T) * Math.PI * 2 + p.phase);
          p.x = p.anchorX + p.len * Math.sin(th);
          p.y = p.anchorY + p.len * Math.cos(th);
        } else if (p.kind === 'conveyor') {
          p.x += p.vx * wdt;
          if (p.x > p.x1) p.x = p.x0;
          else if (p.x < p.x0) p.x = p.x1;
        } else if (p.kind === 'ring' && this.ring) {
          // 转盘公转：θ = 初相 + ω·t（t 走世界时间，慢镜自动冻结转盘）
          const a = p.angle0 + this.ring.w * this.t;
          p.x = this.ring.cx + Math.cos(a) * this.ring.r;
          p.y = this.ring.cy + Math.sin(a) * this.ring.r;
        }
      } else if (p.state === 'falling') {
        p.fall.vy += 1500 * wdt;
        p.x += p.fall.vx * wdt;
        p.y += p.fall.vy * wdt;
        p.fall.rot += p.fall.vr * wdt;
        if (p.y > this.H + 90) p.state = 'gone';
      }
    }
    for (const b of this.belts) {
      b.offset = ((b.offset + b.speed * wdt * b.dir) % 40 + 40) % 40;
    }

    // 子弹飞行（真实时间：慢镜中子弹照常全速飞行、即时命中）
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      if (tr.t >= tr.dur) { this.tracers.splice(i, 1); this._resolveImpact(tr); }
    }

    // 粒子随世界慢镜漂浮（命中的碎屑缓降 = 慢镜质感）；浮字走真实时间（反馈可读）
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= wdt;
      pt.x += pt.vx * wdt; pt.y += pt.vy * wdt; pt.vy += 500 * wdt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt; f.y -= 45 * dt;
      if (f.life <= 0) this.floats.splice(i, 1);
    }

    this.shake = Math.max(0, this.shake - 14 * dt);
    this.muzzle = Math.max(0, this.muzzle - 6 * dt);

    // 结束判定：弹尽 或 清台（留 1s 欣赏动画；按真实时钟计——屏息慢镜不拖结算）
    const anyIdle = this.prizes.some(p => p.state === 'idle');
    if (!this._endScheduled && this.tracers.length === 0
        && (this.bulletsLeft <= 0 || !anyIdle)) {
      this.cleared = !anyIdle;
      this._endScheduled = true;
      this.endAt = this.rt + 1.0;
    }
    if (this._endScheduled && !this.ended && this.rt >= this.endAt) {
      this.ended = true;
      if (this.hooks.onEnd) this.hooks.onEnd(this.getResult());
    }

    if (this.hooks.updateHUD) this.hooks.updateHUD({
      bullets: this.bulletsLeft, total: this.level.bullets,
      hits: this.hits, wind: this.wind, breath: this.breathMeter,
      breathLock: this._breathLock, breathing: this.breathing, zoomed: this.zoomed,
    });
  }

  /* ---------------- 渲染 ---------------- */

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    if (this.shake > 0.01) {
      ctx.translate((Math.random() - 0.5) * this.shake * 2, (Math.random() - 0.5) * this.shake * 2);
    }
    // 开镜（M9）：视野中心 = 准星（不钳制），十字分划线恒在镜片正中；
    // 贴边瞄准时镜内露出世界外的夜空（视野可越出世界，越出部分只是空区）
    let z = 1, zc = null;
    if (this.zoomed && !this.ended) {
      z = CONFIG.SHOOTING.SCOPE.ZOOM;
      zc = this._zoomCenter();
      ctx.translate(this.W / 2, this.H / 2);
      ctx.scale(z, z);
      ctx.translate(-zc.x, -zc.y);
    }

    // 夜空（多填充世界外一圈：开镜贴边时镜内不露画布底色，仍是夜空）
    const sky = ctx.createLinearGradient(0, 0, 0, this.H);
    sky.addColorStop(0, '#141b33'); sky.addColorStop(1, '#0c0f1d');
    ctx.fillStyle = sky;
    ctx.fillRect(-this.W, -this.H, this.W * 3, this.H * 3);
    ctx.fillStyle = '#c9d4ff';
    for (const st of this.stars) {
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * st.tw + st.phase));
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    this._drawBooth(ctx);

    // 弹孔（学习风偏/下坠的反馈）
    for (const h of this.holes) {
      ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, 7);
      ctx.fillStyle = '#0a0d16'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
    }

    for (const p of this.prizes) {
      if (p.state !== 'gone') this._drawPrize(ctx, p);
    }

    // 粒子
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 2.2));
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 浮字
    ctx.font = 'bold 26px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.4));
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // 曳光弹
    for (const tr of this.tracers) {
      const k = Math.min(1, tr.t / tr.dur);
      const x = tr.from.x + (tr.to.x - tr.from.x) * k;
      const y = tr.from.y + (tr.to.y - tr.from.y) * k;
      ctx.strokeStyle = 'rgba(255, 214, 102, .9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(tr.from.x, tr.from.y); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
    }

    // 枪口焰
    if (this.muzzle > 0.02) {
      ctx.globalAlpha = this.muzzle;
      ctx.fillStyle = '#ffd873';
      ctx.beginPath();
      ctx.arc(this.W / 2, this.H - 14, 10 + 14 * (1 - this.muzzle), 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // —— 屏幕空间叠加层（不随开镜缩放）——
    // 时停冷色滤层：屏息=世界慢镜（×0.05）的可见反馈
    if (this.breathing) {
      ctx.fillStyle = 'rgba(90, 200, 255, .07)';
      ctx.fillRect(0, 0, this.W, this.H);
    }

    // 准星屏幕坐标：开镜时十字分划线恒在镜片正中（视野随准星平移），
    // 未开镜时为普通圆准星的世界坐标
    let sx = null, sy = null;
    if (!this.ended) {
      if (zc) {
        sx = this.W / 2; sy = this.H / 2;
      } else {
        const c = this._crosshair();
        sx = c.x; sy = c.y;
      }
    }

    if (zc && sx !== null) {
      // —— 狙击镜（CS2 式）：椭圆镜片 + 镜外纯黑 + 十字分划线 ——
      const SC = CONFIG.SHOOTING.SCOPE;
      const cx = this.W / 2, cy = this.H / 2;
      const rx = this.W * SC.LENS_X, ry = this.H * SC.LENS_Y;
      const halo = this.breathing ? 'rgba(126, 240, 255, .35)' : 'rgba(255, 255, 255, .30)';
      const line = 'rgba(8, 12, 18, .92)';
      // 镜外遮黑（矩形挖去椭圆，evenodd）+ 镜筒边环
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.rect(0, 0, this.W, this.H);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 7);
      ctx.fill('evenodd');
      ctx.lineWidth = 7; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(180, 210, 235, .5)';
      ctx.beginPath(); ctx.ellipse(cx, cy, rx - 4, ry - 4, 0, 0, 7); ctx.stroke();
      // 分划线（裁剪进镜片内）：全幅十字 + 轴向密位刻度 + 中心点。
      // 深色场景下纯黑线不可读 → 先画浅色光晕层再压深色主线
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx - 3, ry - 3, 0, 0, 7); ctx.clip();
      ctx.strokeStyle = halo; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - rx, sy); ctx.lineTo(cx + rx, sy);
      ctx.moveTo(sx, cy - ry); ctx.lineTo(sx, cy + ry);
      ctx.stroke();
      ctx.strokeStyle = line; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - rx, sy); ctx.lineTo(cx + rx, sy);
      ctx.moveTo(sx, cy - ry); ctx.lineTo(sx, cy + ry);
      for (let k = 1; k <= 6; k++) {
        const d = 60 * k;                      // 密位刻度：轴向每 60px 一格
        if (d < rx - 14) {
          ctx.moveTo(cx + d, sy - 5); ctx.lineTo(cx + d, sy + 5);
          ctx.moveTo(cx - d, sy - 5); ctx.lineTo(cx - d, sy + 5);
        }
        if (d < ry - 14) {
          ctx.moveTo(sx - 5, cy + d); ctx.lineTo(sx + 5, cy + d);
          ctx.moveTo(sx - 5, cy - d); ctx.lineTo(sx + 5, cy - d);
        }
      }
      ctx.stroke();
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(sx, sy, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = line;
      ctx.beginPath(); ctx.arc(sx, sy, 1.4, 0, 7); ctx.fill();
      ctx.restore();
    } else if (sx !== null) {
      // 普通准星（未开镜，固定屏幕尺寸）
      ctx.strokeStyle = this.breathing ? '#7ef0ff' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 14, 0, 7); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 22, sy); ctx.lineTo(sx - 8, sy);
      ctx.moveTo(sx + 8, sy); ctx.lineTo(sx + 22, sy);
      ctx.moveTo(sx, sy - 22); ctx.lineTo(sx, sy - 8);
      ctx.moveTo(sx, sy + 8); ctx.lineTo(sx, sy + 22);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, 7); ctx.fill();
    }
  }

  _drawBooth(ctx) {
    const AW = 56;                 // 雨棚高（横屏纵向紧凑）
    const BOT = 478;               // 摊位底（柜台顶）
    // 雨棚（红白条纹 + 波浪边）
    for (let x = -8; x < this.W + 60; x += 60) {
      const col = ((x / 60) | 0) % 2 === 0 ? '#e5484d' : '#f3ead9';
      ctx.fillStyle = col;
      ctx.fillRect(x, 0, 60, AW);
      ctx.beginPath(); ctx.arc(x + 30, AW, 30, 0, Math.PI); ctx.fill();
    }
    // 檐口灯串
    for (let x = 30; x < this.W; x += 68) {
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath(); ctx.arc(x, AW + 12, 3.4, 0, 7); ctx.fill();
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(x, AW + 12, 9, 0, 7); ctx.fill();
      ctx.restore();
    }
    // 立柱（贯穿到柜台，框出摊位正面）
    ctx.fillStyle = '#5b3a21';
    ctx.fillRect(40, AW, 14, BOT - AW);
    ctx.fillRect(this.W - 54, AW, 14, BOT - AW);
    // 背景板
    ctx.fillStyle = '#1e2540';
    ctx.fillRect(54, AW, this.W - 108, BOT - AW);
    const vg = ctx.createRadialGradient(this.W / 2, 270, 130, this.W / 2, 270, 460);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(54, AW, this.W - 108, BOT - AW);

    // 架板（行数随布局：转盘/对开双带关让出相应层）
    for (const y of this.shelfRows) {
      ctx.fillStyle = '#8a5a2e';
      ctx.fillRect(64, y, this.W - 128, 11);
      ctx.fillStyle = '#6d4622';
      ctx.fillRect(64, y + 11, this.W - 128, 4);
    }

    // 传送带（单带横穿底部；对开双带 = 上下两条反向，条纹随带速滚动）
    for (const b of this.belts) {
      const y = b.y, h = 28;
      ctx.fillStyle = '#232840';
      ctx.fillRect(64, y, this.W - 128, h);
      ctx.fillStyle = '#3a4266';
      for (let x = 64 - 40 + b.offset; x < this.W - 64; x += 40) {
        ctx.fillRect(Math.max(64, x), y + 4, 18, h - 8);
      }
      ctx.fillStyle = '#151a2c';
      ctx.fillRect(56, y - 4, 14, h + 8);
      ctx.fillRect(this.W - 70, y - 4, 14, h + 8);
    }

    // 转盘（环形靶轨道：底盘辐条随奖品同转，一眼读出转向）
    if (this.ring) {
      const { cx, cy, r } = this.ring;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.ring.w * this.t);
      ctx.strokeStyle = '#3a4266';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(58,66,102,.75)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.fillStyle = '#2c3760';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd873';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
      ctx.restore();
    }

    // 底部柜台 + 招牌 + 枪身剪影
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(-8, BOT, this.W + 16, this.H - BOT + 8);
    ctx.fillStyle = '#2c1f12';
    for (let x = 0; x < this.W; x += 90) ctx.fillRect(x, BOT, 4, this.H - BOT);
    ctx.fillStyle = '#ffd873';
    ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🎯 打中什么，拿什么', this.W / 2, BOT + 22);
    ctx.fillStyle = '#14161f';
    ctx.beginPath();
    ctx.moveTo(this.W / 2 - 16, this.H);
    ctx.lineTo(this.W / 2 - 7, this.H - 26);
    ctx.lineTo(this.W / 2 + 7, this.H - 26);
    ctx.lineTo(this.W / 2 + 16, this.H);
    ctx.closePath(); ctx.fill();
  }

  _drawPrize(ctx, p) {
    const rc = CONFIG.RARITY[p.cat.rarity];
    ctx.save();
    if (p.state === 'falling') {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.fall.rot);
      ctx.translate(-p.x, -p.y);
    }
    if (p.kind === 'swing' && p.state === 'idle') {
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.anchorX, p.anchorY);
      ctx.lineTo(p.x, p.y - p.hitR * 0.5);
      ctx.stroke();
    }
    // 稀有度虚线圈 = 判定范围（原型调试辅助）
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = rc.color;
    ctx.globalAlpha = p.state === 'idle' ? 0.55 : 0.25;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.hitR, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // 奖品本体
    const fs = Math.round(p.hitR * 1.75);
    ctx.font = `${fs}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.cat.emoji, p.x, p.y + fs * 0.06);
    ctx.restore();
  }
}
