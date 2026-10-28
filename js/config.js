'use strict';
/* ============================================================
 * 《夜市神枪手》数值配置
 * 与 DESIGN.md 数值表一一对应；调平衡只需要改这个文件。
 *
 * 50 关架构（扩展设计 v1.1）：10 章 × 5 关，每章 1 个创新机制。
 * CHAPTERS 为源数据（十章模板），buildLevels() 展开为 50 条 LEVELS，
 * 字段结构与单关时代完全一致（新增机制字段随里程碑 M2~M5 生效）。
 * 章内递进：i=1 教学 → i=2~3 应用 → i=4 变体 → i=5 验收关。
 * ============================================================ */

const CONFIG = {
  ECONOMY: {
    START_GOLD: 1000,     // 初始金币（数值表 8）
    FREE_PER_DAY: 1,      // 每日免费入场次数
    RELIEF_GOLD: 60,      // 破产救济金下限（每日 1 次）
    RELIEF_RATIO: 0.6,    // 动态救济金：另取 max(下限, 前沿章最低门票×0.6, 最低可玩关门票)
  },

  SHOOTING: {             // 数值表 2
    SPREAD: 4,            // 固有散布（±px）
    WIND_PX_PER_LEVEL: 10,// 每 1 级风的水平偏移（px）
    TRACER_MS: 90,        // 子弹飞行时间
    SHOT_COOLDOWN_MS: 240,// 最小射击间隔
    BREATH: {
      DURATION: 2.5,      // 屏息（=时停）可持续秒数
      RECHARGE: 5,        // 调息时间：耗尽后从空回满秒数（回满前锁定屏息）
      SWAY_FACTOR: 0.15,  // 屏息时漂移系数
      SCALE: 0.05,        // 屏息期间世界时间倍率（"时停"=极慢：奖品/传送带/转盘/粒子近乎冻结；
                         // 子弹曳光与命中结算走真实时间，开枪不受慢镜影响）
    },
    SCOPE: {
      ZOOM: 2,            // 开镜放大倍率（拖动灵敏度随倍率同步降低）
      LENS_X: 0.42,       // 镜片椭圆水平半径（占屏宽比例，CS2 式狙击镜视野）
      LENS_Y: 0.42,       // 镜片椭圆垂直半径（占屏高比例）
    },
  },

  RARITY: {               // 数值表 3
    N:   { name: '普通', color: '#a8bfd4', hitR: 40 },
    R:   { name: '稀有', color: '#4da3ff', hitR: 30 },
    SR:  { name: '史诗', color: '#c084fc', hitR: 24 },
    SSR: { name: '传说', color: '#ffb340', hitR: 18 },
  },
};

/* ------------------------------------------------------------
 * 奖品图鉴（20 款）—— 数值表 4
 * 售价锚定规则见 DESIGN.md §7：售价 ≈ 期望获取成本的 30%~50%
 * （50 关扩展的 24 款新图鉴随 M2~M5 各章落地，见扩展设计 §4.2）
 * ------------------------------------------------------------ */
const CATALOG = [
  // N 普通 ×8
  { id: 'duck',    emoji: '🦆', name: '橡皮鸭',   rarity: 'N',   value: 6 },
  { id: 'horn',    emoji: '🎺', name: '小喇叭',   rarity: 'N',   value: 6 },
  { id: 'yoYo',    emoji: '🪀', name: '悠悠球',   rarity: 'N',   value: 7 },
  { id: 'candy',   emoji: '🍭', name: '棒棒糖',   rarity: 'N',   value: 6 },
  { id: 'kite',    emoji: '🪁', name: '小风筝',   rarity: 'N',   value: 7 },
  { id: 'ball',    emoji: '🥎', name: '弹力球',   rarity: 'N',   value: 7 },
  { id: 'balloon', emoji: '🎈', name: '红气球',   rarity: 'N',   value: 6 },
  { id: 'dango',   emoji: '🍡', name: '糯米团子', rarity: 'N',   value: 8 },
  // R 稀有 ×6
  { id: 'bear',    emoji: '🧸', name: '小熊玩偶', rarity: 'R',   value: 15 },
  { id: 'doll',    emoji: '🪆', name: '套娃',     rarity: 'R',   value: 16 },
  { id: 'guitar',  emoji: '🎸', name: '玩具吉他', rarity: 'R',   value: 15 },
  { id: 'skate',   emoji: '🛼', name: '轮滑鞋',   rarity: 'R',   value: 18 },
  { id: 'wand',    emoji: '🪄', name: '魔法棒',   rarity: 'R',   value: 14 },
  { id: 'dart',    emoji: '🎯', name: '飞镖盘',   rarity: 'R',   value: 16 },
  // SR 史诗 ×4
  { id: 'unicorn', emoji: '🦄', name: '独角兽',   rarity: 'SR',  value: 45 },
  { id: 'robot',   emoji: '🤖', name: '机器人',   rarity: 'SR',  value: 48 },
  { id: 'rcCar',   emoji: '🚗', name: '遥控赛车', rarity: 'SR',  value: 50 },
  { id: 'flamingo',emoji: '🦩', name: '火烈鸟',   rarity: 'SR',  value: 42 },
  // SSR 传说 ×2
  { id: 'dragon',  emoji: '🐉', name: '夜市祥龙', rarity: 'SSR', value: 120 },
  { id: 'crown',   emoji: '👑', name: '皇冠',     rarity: 'SSR', value: 130 },
];

/* ------------------------------------------------------------
 * 十章模板 —— 数值表 5（源数据）
 *
 * 经济锚定：门票 ≈ 池售出价值 ÷ 1.6（熟练全清回报 1.5~1.8）；
 * 池价值膨胀 = 稀有度占比上移 + 章节溢价 + 新图鉴高价品（不引入动态卖价）。
 * enabled：章节是否已开放（Ch3~10 的机制代码随 M2~M5 落地后翻牌，
 * 关卡数据先行锁定全 50 关经济曲线，未开放章在大厅显示"敬请期待"）。
 *
 * moving 字段：swing=吊摆数 · conveyor=传送带奖品数 · conveyorLanes=1|2
 *   （2=对开双带）· conveyorSpeed=带速(px/s) · ring=转盘奖品数 ·
 *   ringSpeed=角速度(rad/s，正负随机定转向)。
 * Ch3~10 的天气/弹种/行为/限时等字段为 M2~M5 预置数据，落地时生效。
 * ------------------------------------------------------------ */
const CHAPTERS = [
  {
    id: 0, name: '夜市入门', icon: '🏮', stars: 1, enabled: true,
    theme: '弹道三要素递进：风 → 下坠 → 吊摆',
    levels: [
      {
        name: '小摊初试', sub: '无风 · 静止目标 · 新手友好', stars: 1,
        entry: 100, bullets: 10, clearBonus: 20, unlockNextHits: 4,
        sway: 6, drop: 0, wind: { mode: 'none' },
        pool: { N: 6, R: 3, SR: 1, SSR: 0 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        hint: '本关无风、无下坠：准星中心 = 弹着点。稳住呼吸，瞄准开枪！',
      },
      {
        name: '微风夜', sub: '固定横风 2 级 · 静止目标', stars: 1,
        entry: 90, bullets: 11, clearBonus: 15, unlockNextHits: 5,
        sway: 8, drop: 0, wind: { mode: 'constant', level: 2 },
        pool: { N: 5, R: 4, SR: 1, SSR: 0 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        hint: '顶栏风向标显示 2 级横风——弹着点会顺风偏移，往逆风侧瞄准半寸！',
      },
      {
        name: '下坠练习', sub: '固定横风 2 级 · 弹道下坠 25', stars: 2,
        entry: 95, bullets: 12, clearBonus: 15, unlockNextHits: 5,
        sway: 8, drop: 25, wind: { mode: 'constant', level: 2 },
        pool: { N: 5, R: 4, SR: 1, SSR: 0 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        hint: '弹道开始下坠：目标越靠下越要抬高准星。第一枪试射看弹孔，再校准！',
      },
      {
        name: '吊摆初见', sub: '固定横风 3 级 · 吊摆目标', stars: 2,
        entry: 125, bullets: 13, clearBonus: 20, unlockNextHits: 6,
        sway: 10, drop: 30, wind: { mode: 'constant', level: 3 },
        pool: { N: 4, R: 5, SR: 2, SSR: 0 },
        moving: { swing: 3, conveyor: 0, ring: 0 },
        hint: '雨棚下的奖品在吊摆——预判摆动轨迹，或屏息让世界慢下来再打！',
      },
      {
        name: '三风齐至', sub: '每枪变风 · 吊摆 · 第一章验收', stars: 3,
        entry: 180, bullets: 14, clearBonus: 30, unlockNextHits: 7,
        sway: 12, drop: 35, wind: { mode: 'perShot', level: 2 },
        pool: { N: 4, R: 5, SR: 2, SSR: 1 },
        moving: { swing: 4, conveyor: 0, ring: 0 },
        hint: '风、坠、摆三要素同场，每一枪后风力都会变——验收你的基本功！',
      },
    ],
  },
  {
    id: 1, name: '铁轨夜市', icon: '🎡', stars: 2, enabled: true,
    theme: '移动靶预判：双向变速传送带 + 转盘环形靶',
    levels: [
      {
        name: '慢速传送', sub: '固定横风 2 级 · 慢速传送带', stars: 2,
        entry: 130, bullets: 13, clearBonus: 20, unlockNextHits: 6,
        sway: 10, drop: 30, wind: { mode: 'constant', level: 2 },
        pool: { N: 5, R: 5, SR: 2, SSR: 0 },
        moving: { swing: 0, conveyor: 4, conveyorLanes: 1, conveyorSpeed: 40, ring: 0 },
        hint: '传送带奖品匀速横移——瞄准它的前进方向留提前量，别追着打！',
      },
      {
        name: '双向对开', sub: '固定横风 3 级 · 对开双传送带', stars: 2,
        entry: 135, bullets: 14, clearBonus: 20, unlockNextHits: 6,
        sway: 12, drop: 35, wind: { mode: 'constant', level: 3 },
        pool: { N: 4, R: 6, SR: 2, SSR: 0 },
        moving: { swing: 0, conveyor: 6, conveyorLanes: 2, conveyorSpeed: 55, ring: 0 },
        hint: '两条传送带对开——上带向一头、下带向另一头，提前量方向相反，先看清奖品在哪条带！',
      },
      {
        name: '转盘靶场', sub: '固定横风 3 级 · 转盘环形靶', stars: 3,
        entry: 155, bullets: 14, clearBonus: 25, unlockNextHits: 6,
        sway: 12, drop: 35, wind: { mode: 'constant', level: 3 },
        pool: { N: 4, R: 5, SR: 3, SSR: 0 },
        moving: { swing: 0, conveyor: 0, ring: 6, ringSpeed: 0.5 },
        hint: '转盘上的奖品沿圆环切向运动，转向每局随机——顺盘预判提前量，或屏息冻结转盘！',
      },
      {
        name: '快车道', sub: '每枪变风 · 高速双传送带', stars: 3,
        entry: 160, bullets: 15, clearBonus: 25, unlockNextHits: 7,
        sway: 14, drop: 40, wind: { mode: 'perShot', level: 3 },
        pool: { N: 3, R: 6, SR: 3, SSR: 0 },
        moving: { swing: 0, conveyor: 6, conveyorLanes: 2, conveyorSpeed: 75, ring: 0 },
        hint: '高速双带！提前量要给得更足，或者屏息时停——慢镜里传送带近乎冻结。',
      },
      {
        name: '铁轨风暴', sub: '每枪变风 · 高速带 + 转盘 + 吊摆 · 第二章验收', stars: 3,
        entry: 235, bullets: 16, clearBonus: 40, unlockNextHits: 8,
        sway: 15, drop: 45, wind: { mode: 'perShot', level: 4 },
        pool: { N: 3, R: 6, SR: 3, SSR: 1 },
        moving: { swing: 2, conveyor: 5, conveyorLanes: 1, conveyorSpeed: 70, ring: 5, ringSpeed: 0.7 },
        hint: '吊摆 + 高速带 + 转盘三重运动（第二章验收）——综合运用提前量与屏息时停！',
      },
    ],
  },
  /* ============ Ch3~10：入口已开放（v0.2.1 全章解锁），章机制代码随 M2~M5 落地
     —— 关卡以基础弹道+已实现运动（摆/带/盘）可玩；weather/boss/ghosts 等附加字段暂被引擎忽略，
        阵风 mode:'gust' 暂按随机固定风处理 ============ */
  {
    id: 2, name: '天公夜市', icon: '🌧️', stars: 3, enabled: true,
    theme: '动态天气：阵雨加坠 · 阵风脉冲 · 浓雾（开镜驱散）',
    levels: [
      {
        name: '微风阵雨', sub: '阵风 2±2 · 雨阻 +15 坠 · 教学', stars: 3,
        entry: 160, bullets: 15, clearBonus: 25, unlockNextHits: 7,
        sway: 12, drop: 40, wind: { mode: 'gust', level: 2, gustAmp: 2 },
        pool: { N: 4, R: 6, SR: 3, SSR: 0 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        weather: { rain: 1, fog: 0 },
        hint: '下雨了：雨幕之外，弹道还受"雨阻"额外下坠——抬高更多准星！',
      },
      {
        name: '阵风夜', sub: '阵风 3±2 · 雨阻 +15 坠', stars: 3,
        entry: 240, bullets: 15, clearBonus: 35, unlockNextHits: 7,
        sway: 14, drop: 45, wind: { mode: 'gust', level: 3, gustAmp: 2 },
        pool: { N: 4, R: 6, SR: 3, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        weather: { rain: 1, fog: 0 },
        hint: '阵风一阵一阵地吹——风向标提前闪烁预警，看天打枪！',
      },
      {
        name: '大雨滂沱', sub: '阵风 3±3 · 强雨阻 +25 坠', stars: 3,
        entry: 265, bullets: 16, clearBonus: 40, unlockNextHits: 8,
        sway: 14, drop: 50, wind: { mode: 'gust', level: 3, gustAmp: 3 },
        pool: { N: 3, R: 6, SR: 4, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        weather: { rain: 2, fog: 0 },
        hint: '暴雨如注：雨幕更密、坠得更狠——屏息稳住，一枪一个。',
      },
      {
        name: '起雾了', sub: '阵风 2±2 · 浓雾遮靶 · 开镜驱散', stars: 3,
        entry: 275, bullets: 16, clearBonus: 40, unlockNextHits: 8,
        sway: 14, drop: 45, wind: { mode: 'gust', level: 2, gustAmp: 2 },
        pool: { N: 3, R: 7, SR: 4, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        weather: { rain: 0, fog: 1 },
        hint: '浓雾里深处的奖品看不清——开镜聚焦可以驱散镜内雾，望远镜是你的眼睛！',
      },
      {
        name: '雾夜风暴', sub: '阵风 4±3 · 雾 + 雨 + 吊摆 · 第三章验收', stars: 3,
        entry: 345, bullets: 17, clearBonus: 55, unlockNextHits: 9,
        sway: 16, drop: 55, wind: { mode: 'gust', level: 4, gustAmp: 3 },
        pool: { N: 2, R: 7, SR: 4, SSR: 2 },
        moving: { swing: 2, conveyor: 0, ring: 0 },
        weather: { rain: 1, fog: 2 },
        hint: '风雨雾三重天（第三章验收）——风向标、开镜驱雾、屏息时停全用上！',
      },
    ],
  },
  {
    id: 3, name: '军火夜市', icon: '🔫', stars: 3, enabled: true,
    theme: '弹种切换：重弹抗风 · 穿甲弹穿木板掩体',
    levels: [
      {
        name: '军火初到', sub: '固定 4 级风 · 解锁重弹 · 教学', stars: 3,
        entry: 270, bullets: 16, clearBonus: 40, unlockNextHits: 8,
        sway: 14, drop: 50, wind: { mode: 'constant', level: 4 },
        pool: { N: 4, R: 6, SR: 4, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ammoTypes: ['normal', 'heavy'],
        hint: '军火商到了：切换重弹（15🪙/发）——风偏减六成、下坠减半，强风夜的保准弹！',
      },
      {
        name: '重弹试炼', sub: '阵风 4±2 · 强风 · 重弹优势', stars: 3,
        entry: 275, bullets: 16, clearBonus: 40, unlockNextHits: 8,
        sway: 14, drop: 55, wind: { mode: 'gust', level: 4, gustAmp: 2 },
        pool: { N: 3, R: 7, SR: 4, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ammoTypes: ['normal', 'heavy'],
        hint: '强阵风里普通弹飘得厉害——算一笔账：重弹 15🪙 换稳稳命中，值不值？',
      },
      {
        name: '木板掩体', sub: '固定 3 级风 · 穿甲弹 · 木板 3 · 教学', stars: 3,
        entry: 275, bullets: 17, clearBonus: 40, unlockNextHits: 8,
        sway: 12, drop: 45, wind: { mode: 'constant', level: 3 },
        pool: { N: 3, R: 7, SR: 4, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ammoTypes: ['normal', 'heavy', 'pierce'], covers: 3,
        hint: '木板挡住了奖品：普通弹只能留弹孔，穿甲弹（25🪙/发）一弹穿板连人带板一起拿！',
      },
      {
        name: '深巷掩群', sub: '阵风 3±3 · 掩体 5 + 吊摆', stars: 3,
        entry: 310, bullets: 17, clearBonus: 45, unlockNextHits: 9,
        sway: 14, drop: 55, wind: { mode: 'gust', level: 3, gustAmp: 3 },
        pool: { N: 2, R: 8, SR: 5, SSR: 1 },
        moving: { swing: 2, conveyor: 0, ring: 0 },
        ammoTypes: ['normal', 'heavy', 'pierce'], covers: 5,
        hint: '掩体成群：先看清哪些奖品露在外面用普通弹，挡住的才上穿甲——省下的都是利润。',
      },
      {
        name: '军火商的考验', sub: '阵风 5±3 · 掩体 4 + 传送带 · 第四章验收', stars: 3,
        entry: 385, bullets: 18, clearBonus: 60, unlockNextHits: 10,
        sway: 16, drop: 60, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 2, R: 8, SR: 5, SSR: 2 },
        moving: { swing: 0, conveyor: 4, conveyorLanes: 1, conveyorSpeed: 55, ring: 0 },
        ammoTypes: ['normal', 'heavy', 'pierce'], covers: 4,
        hint: '强风 + 掩体 + 移动靶（第四章验收）——三种弹各有用武之地，选对弹才是军火行的行家！',
      },
    ],
  },
  {
    id: 4, name: '狡猾奖品', icon: '🐰', stars: 3, enabled: true,
    theme: '目标行为：逃跑兔 · 护盾鹅 · 诱饵雷 · 连锁灯',
    levels: [
      {
        name: '逃跑兔出没', sub: '固定 3 级风 · 逃跑兔 ×3 · 教学', stars: 3,
        entry: 305, bullets: 17, clearBonus: 45, unlockNextHits: 9,
        sway: 14, drop: 50, wind: { mode: 'constant', level: 3 },
        pool: { N: 3, R: 7, SR: 5, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        behaviors: { flee: 3, shield: 0, bomb: 0, chain: 0 },
        hint: '逃跑兔耳朵尖：子弹落在附近就受惊加速窜——争取一枪命中，别惊动它！',
      },
      {
        name: '护盾鹅', sub: '固定 4 级风 · 护盾鹅 ×4 · 教学', stars: 3,
        entry: 305, bullets: 17, clearBonus: 45, unlockNextHits: 9,
        sway: 14, drop: 55, wind: { mode: 'constant', level: 4 },
        pool: { N: 3, R: 7, SR: 5, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        behaviors: { flee: 0, shield: 4, bomb: 0, chain: 0 },
        hint: '护盾鹅举着盾牌：第一枪破盾（+8🪙），第二枪才能拿下本体——两枪一鹅，弹要算够！',
      },
      {
        name: '诱饵雷阵', sub: '阵风 3±2 · 诱饵雷 ×3 + 逃跑兔 ×2', stars: 3,
        entry: 310, bullets: 18, clearBonus: 45, unlockNextHits: 9,
        sway: 14, drop: 50, wind: { mode: 'gust', level: 3, gustAmp: 2 },
        pool: { N: 2, R: 8, SR: 5, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        behaviors: { flee: 2, shield: 0, bomb: 3, chain: 0 },
        hint: '诱饵雷看着值钱，打中却会让全场惊逃、颗粒无收——瞄准前先读行为，别贪！',
      },
      {
        name: '连锁灯串', sub: '固定 3 级风 · 连锁灯 ×5 · 教学', stars: 3,
        entry: 385, bullets: 18, clearBonus: 60, unlockNextHits: 10,
        sway: 14, drop: 50, wind: { mode: 'constant', level: 3 },
        pool: { N: 2, R: 8, SR: 5, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        behaviors: { flee: 0, shield: 0, bomb: 0, chain: 5 },
        hint: '连锁灯串挂成一排：3 秒内连中相邻两只，后一只售价翻倍——手速就是金钱！',
      },
      {
        name: '狡猾大集合', sub: '阵风 4±3 · 逃 3 + 盾 3 + 雷 2 + 锁 3 · 第五章验收', stars: 3,
        entry: 400, bullets: 19, clearBonus: 65, unlockNextHits: 11,
        sway: 16, drop: 55, wind: { mode: 'gust', level: 4, gustAmp: 3 },
        pool: { N: 2, R: 8, SR: 5, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        behaviors: { flee: 3, shield: 3, bomb: 2, chain: 3 },
        hint: '四种狡猾奖品同台（第五章验收）——每一枪前先读行为：该惊、该破、该绕、该连！',
      },
    ],
  },
  {
    id: 5, name: '节拍夜市', icon: '🔔', stars: 4, enabled: true,
    theme: '时间经济：关卡倒计时 · 连击倍率 · 黄金铃',
    levels: [
      {
        name: '限时初体验', sub: '固定 3 级风 · 限时 50 秒 · 教学', stars: 3,
        entry: 380, bullets: 18, clearBonus: 55, unlockNextHits: 10,
        sway: 14, drop: 50, wind: { mode: 'constant', level: 3 },
        pool: { N: 3, R: 7, SR: 5, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        timer: 50,
        hint: '限时 50 秒：弹尽或超时都结束——别磨蹭，也别乱开枪浪费弹药！',
      },
      {
        name: '连击节奏', sub: '固定 4 级风 · 限时 45 秒 + 连击 · 教学', stars: 3,
        entry: 380, bullets: 18, clearBonus: 55, unlockNextHits: 10,
        sway: 15, drop: 55, wind: { mode: 'constant', level: 4 },
        pool: { N: 3, R: 7, SR: 5, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        timer: 45, combo: true,
        hint: '连续命中售价一路上涨（每连击 +25%，封顶 ×3），miss 就清零——容错换倍率的节奏舞！',
      },
      {
        name: '黄金铃', sub: '阵风 3±2 · 45 秒 + 连击 + 黄金铃 · 教学', stars: 3,
        entry: 415, bullets: 19, clearBonus: 60, unlockNextHits: 10,
        sway: 15, drop: 50, wind: { mode: 'gust', level: 3, gustAmp: 2 },
        pool: { N: 2, R: 8, SR: 6, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        timer: 45, combo: true, goldenBell: true,
        hint: '黄金铃随机现身只停 2 秒：打中 +5 秒时间——它是快节奏关里唯一的"续命"机会！',
      },
      {
        name: '快拍连锁', sub: '阵风 4±2 · 40 秒 + 连锁 + 金铃', stars: 4,
        entry: 415, bullets: 19, clearBonus: 60, unlockNextHits: 11,
        sway: 16, drop: 55, wind: { mode: 'gust', level: 4, gustAmp: 2 },
        pool: { N: 2, R: 8, SR: 6, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        timer: 40, combo: true, goldenBell: true,
        behaviors: { flee: 0, shield: 0, bomb: 0, chain: 4 },
        hint: '连锁灯 + 连击 + 限时三重节奏——连击倍率上连锁灯，一枪双倍再叠连击，燃起来！',
      },
      {
        name: '午夜快枪手', sub: '阵风 5±3 · 40 秒 + 双带 + 金铃 · 第六章验收', stars: 4,
        entry: 495, bullets: 20, clearBonus: 75, unlockNextHits: 12,
        sway: 18, drop: 60, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 2, R: 8, SR: 6, SSR: 3 },
        moving: { swing: 0, conveyor: 6, conveyorLanes: 2, conveyorSpeed: 65, ring: 0 },
        timer: 40, combo: true, goldenBell: true,
        hint: '移动靶 + 限时 + 连击（第六章验收）——对开双带上的提前量，加上连击倍率的节奏，午夜快枪手！',
      },
    ],
  },
  {
    id: 6, name: '纵深长巷', icon: '🏮', stars: 4, enabled: true,
    theme: '距离分层：远 = 值钱 = 难打 · 高抛靶',
    levels: [
      {
        name: '长巷入口', sub: '固定 3 级风 · 纵深 2 层 · 教学', stars: 3,
        entry: 440, bullets: 19, clearBonus: 65, unlockNextHits: 10,
        sway: 14, drop: 70, wind: { mode: 'constant', level: 3 },
        pool: { N: 3, R: 7, SR: 5, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        depth: 2,
        hint: '摊位变成一条巷：远处的货架更值钱但判定更小——下坠也随距离更狠，风险自选！',
      },
      {
        name: '中层货架', sub: '固定 4 级风 · 纵深 3 层', stars: 4,
        entry: 500, bullets: 20, clearBonus: 75, unlockNextHits: 11,
        sway: 15, drop: 80, wind: { mode: 'constant', level: 4 },
        pool: { N: 2, R: 8, SR: 6, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        depth: 3,
        hint: '三层纵深：近台 1 倍价、中巷 1.3 倍、深巷 1.5 倍——越深越小越难打，越值钱！',
      },
      {
        name: '深巷幽灯', sub: '阵风 3±3 · 纵深 3 层 · 深巷 SSR', stars: 4,
        entry: 605, bullets: 20, clearBonus: 90, unlockNextHits: 11,
        sway: 15, drop: 90, wind: { mode: 'gust', level: 3, gustAmp: 3 },
        pool: { N: 2, R: 7, SR: 6, SSR: 3 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        depth: 3,
        hint: '传说奖品就藏在深巷尽头——开镜精瞄 + 大幅抬高，一枪拿下 1.5 倍身价！',
      },
      {
        name: '高抛飞靶', sub: '固定 3 级风 · 高抛靶 ×3 · 教学', stars: 4,
        entry: 480, bullets: 20, clearBonus: 70, unlockNextHits: 11,
        sway: 15, drop: 60, wind: { mode: 'constant', level: 3 },
        pool: { N: 2, R: 8, SR: 6, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        depth: 2, toss: 3,
        hint: '高抛靶从巷尾抛物线横越全场——大提前量 + 落点预判，打的是"接"不是"追"！',
      },
      {
        name: '千米巷战', sub: '阵风 5±3 · 高抛 ×4 + 纵深 3 层 + 吊摆 · 第七章验收', stars: 4,
        entry: 630, bullets: 21, clearBonus: 95, unlockNextHits: 12,
        sway: 18, drop: 100, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 2, R: 7, SR: 6, SSR: 3 },
        moving: { swing: 3, conveyor: 0, ring: 0 },
        depth: 3, toss: 4,
        hint: '千米长巷全要素（第七章验收）——抛物线、纵深、吊摆、强风，弹道的极限考验！',
      },
    ],
  },
  {
    id: 7, name: '奇谭夜市', icon: '👻', stars: 4, enabled: true,
    theme: '幽灵靶（屏息慢镜显形）+ 镜像靶（打镜像 = 命中本体）',
    levels: [
      {
        name: '幽灵传闻', sub: '固定 3 级风 · 幽灵 ×3 · 教学', stars: 3,
        entry: 420, bullets: 19, clearBonus: 60, unlockNextHits: 10,
        sway: 14, drop: 55, wind: { mode: 'constant', level: 3 },
        pool: { N: 3, R: 7, SR: 5, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ghosts: 3,
        hint: '半透明的幽灵靶平时打不中——屏息时停的慢镜里它们才会显形！慢镜 = 唯一解。',
      },
      {
        name: '半透明摊', sub: '固定 4 级风 · 幽灵 ×5', stars: 4,
        entry: 480, bullets: 19, clearBonus: 70, unlockNextHits: 10,
        sway: 14, drop: 60, wind: { mode: 'constant', level: 4 },
        pool: { N: 2, R: 8, SR: 6, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ghosts: 5,
        hint: '幽灵多了：屏息耐力只有 2.5 秒——进出慢镜的节奏要算好，别在显形前耗光！',
      },
      {
        name: '镜中世界', sub: '固定 3 级风 · 镜像靶 + 幽灵 ×3 · 教学', stars: 4,
        entry: 500, bullets: 20, clearBonus: 75, unlockNextHits: 11,
        sway: 14, drop: 55, wind: { mode: 'constant', level: 3 },
        pool: { N: 2, R: 8, SR: 6, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ghosts: 3, mirror: true,
        hint: '镜子后面是左右翻转的镜像奖品——打镜像 = 命中本体，谜题在于找对应关系！',
      },
      {
        name: '幽灵镜阵', sub: '阵风 4±3 · 镜像 + 幽灵 ×6', stars: 4,
        entry: 580, bullets: 20, clearBonus: 85, unlockNextHits: 11,
        sway: 16, drop: 65, wind: { mode: 'gust', level: 4, gustAmp: 3 },
        pool: { N: 2, R: 7, SR: 6, SSR: 3 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ghosts: 6, mirror: true,
        hint: '镜阵里真真假假：认准镜像对应关系，慢镜窗口里两枪三枪连环拿下！',
      },
      {
        name: '奇谭真相', sub: '阵风 5±3 · 幽灵 ×6 + 镜像 + 吊摆 · 第八章验收', stars: 4,
        entry: 630, bullets: 21, clearBonus: 95, unlockNextHits: 12,
        sway: 18, drop: 70, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 2, R: 7, SR: 6, SSR: 3 },
        moving: { swing: 3, conveyor: 0, ring: 0 },
        ghosts: 6, mirror: true,
        hint: '幽灵 + 镜像 + 吊摆（第八章验收）——屏息时停的战术价值，今夜发挥到极致！',
      },
    ],
  },
  {
    id: 8, name: '摊主挑战', icon: '🐻', stars: 5, enabled: true,
    theme: 'Boss 战：破护甲 → 弱点窗口 → 挡增援',
    levels: [
      {
        name: '摊主挑战·壹', sub: '固定 3 级风 · Boss 机械熊', stars: 4,
        entry: 475, bullets: 20, clearBonus: 70, unlockNextHits: 9,
        sway: 12, drop: 50, wind: { mode: 'constant', level: 3 },
        pool: { N: 2, R: 5, SR: 3, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        boss: { kind: 'bear', armors: 3, coreValue: 400 },
        hint: '机械熊登场：先打落 3 块护甲板（+15🪙/块），核心暴露 3 秒——窗口一开，一锤定音！',
      },
      {
        name: '摊主挑战·贰', sub: '固定 4 级风 · Boss 夜市祥龙', stars: 4,
        entry: 475, bullets: 20, clearBonus: 70, unlockNextHits: 9,
        sway: 12, drop: 55, wind: { mode: 'constant', level: 4 },
        pool: { N: 2, R: 5, SR: 3, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        boss: { kind: 'dragon', armors: 3, coreValue: 400 },
        hint: '祥龙盘旋，护甲藏得刁钻——耐心剥甲，等核心闪光的 3 秒窗口！',
      },
      {
        name: '摊主挑战·叁', sub: '阵风 3±2 · Boss 火凤凰', stars: 4,
        entry: 465, bullets: 21, clearBonus: 70, unlockNextHits: 12,
        sway: 14, drop: 55, wind: { mode: 'gust', level: 3, gustAmp: 2 },
        pool: { N: 2, R: 5, SR: 4, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        boss: { kind: 'phoenix', armors: 3, coreValue: 400 },
        hint: '火凤凰会周期性振翅召来增援小奖品——那是白赚的池外收入，但别为它错过核心窗口！',
      },
      {
        name: '摊主挑战·肆', sub: '阵风 4±2 · Boss 巨鲤', stars: 4,
        entry: 470, bullets: 21, clearBonus: 70, unlockNextHits: 12,
        sway: 14, drop: 60, wind: { mode: 'gust', level: 4, gustAmp: 2 },
        pool: { N: 1, R: 6, SR: 4, SSR: 1 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        boss: { kind: 'koi', armors: 3, coreValue: 400 },
        hint: '巨鲤翻腾，甲板位置随时变换——破甲顺序就是这局的战术核心。',
      },
      {
        name: '机械巨熊', sub: '阵风 5±3 · 完全体：自转甲板 + 增援 · 第九章验收', stars: 5,
        entry: 550, bullets: 22, clearBonus: 85, unlockNextHits: 13,
        sway: 14, drop: 60, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 1, R: 6, SR: 4, SSR: 2 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        boss: { kind: 'bearFull', armors: 3, coreValue: 400, spinning: true, enrage: 12 },
        hint: '机械巨熊完全体（第九章验收）：护甲会自转、还会召增援——摊主的王牌，就等你来拆！',
      },
    ],
  },
  {
    id: 9, name: '传说之路', icon: '👑', stars: 5, enabled: true,
    theme: '终局试炼：全机制叠加 · 称号「夜市神枪手」',
    levels: [
      {
        name: '传说之路·启程', sub: '阵风 4±3 · 雨 + 纵深', stars: 4,
        entry: 640, bullets: 21, clearBonus: 95, unlockNextHits: 12,
        sway: 16, drop: 65, wind: { mode: 'gust', level: 4, gustAmp: 3 },
        pool: { N: 1, R: 7, SR: 6, SSR: 3 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        weather: { rain: 1, fog: 0 }, depth: 2,
        hint: '终局试炼开始：天气与纵深叠加——前九章学的一切，现在都是本能。',
      },
      {
        name: '试炼', sub: '阵风 5±3 · + 幽灵 + 限时', stars: 4,
        entry: 670, bullets: 21, clearBonus: 95, unlockNextHits: 12,
        sway: 16, drop: 70, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 1, R: 7, SR: 6, SSR: 3 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ghosts: 4, timer: 50,
        hint: '幽灵 + 限时：慢镜窗口和时间赛跑——每一秒屏息都要花在刀刃上。',
      },
      {
        name: '淬火', sub: '阵风 5±3 · + 行为全家 + 连击', stars: 5,
        entry: 720, bullets: 22, clearBonus: 110, unlockNextHits: 12,
        sway: 17, drop: 75, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 1, R: 6, SR: 7, SSR: 3 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        behaviors: { flee: 3, shield: 3, bomb: 2, chain: 3 }, combo: true,
        hint: '狡猾奖品 + 连击：读行为、连节奏——这局火候到了，就淬出神枪手的成色。',
      },
      {
        name: '黎明前', sub: '阵风 5±3 · + 掩体 + 高抛靶', stars: 5,
        entry: 750, bullets: 22, clearBonus: 110, unlockNextHits: 13,
        sway: 18, drop: 80, wind: { mode: 'gust', level: 5, gustAmp: 3 },
        pool: { N: 1, R: 6, SR: 7, SSR: 3 },
        moving: { swing: 0, conveyor: 0, ring: 0 },
        ammoTypes: ['normal', 'heavy', 'pierce'], covers: 4, toss: 3, depth: 2,
        hint: '弹种选择 + 高抛 + 掩体：最后一夜的黑最难熬，也最亮。',
      },
      {
        name: '神枪手仪式', sub: '每枪变风 · 三阶段终局试炼 · 通关授称号', stars: 5,
        entry: 1200, bullets: 24, clearBonus: 200, unlockNextHits: 15,
        sway: 18, drop: 85, wind: { mode: 'perShot', level: 5 },
        pool: { N: 1, R: 6, SR: 6, SSR: 4 },
        moving: { swing: 2, conveyor: 4, conveyorLanes: 1, conveyorSpeed: 60, ring: 4, ringSpeed: 0.6 },
        finale: true, timer: 90,
        hint: '三阶段终局试炼（每阶段 8 发、换一套机制组合）——通关之夜，你就是「夜市神枪手」！',
      },
    ],
  },
];

/* ------------------------------------------------------------
 * 关卡生成器（纯函数）：十章模板 → 50 条 LEVELS
 * 展开后的字段结构与单关时代完全一致（id = 全局关序 0~49），
 * 附加 chapter（章 id）/ chapterIndex（章内 0~4）便于 UI 与逻辑定位。
 * ------------------------------------------------------------ */
function buildLevels(chapters) {
  const out = [];
  for (const ch of chapters) {
    ch.levels.forEach((lv, i) => {
      out.push(Object.assign({
        id: out.length,
        chapter: ch.id,
        chapterIndex: i,
        stars: lv.stars || ch.stars,
      }, lv));
    });
  }
  return out;
}

const LEVELS = buildLevels(CHAPTERS);
