/**
 * 一炷香的节奏算法 —— 纯函数，不依赖 Vue / DOM。
 *
 * 这是「规则讲明白」的落点：给定 round 与 daySeed，任何人都能
 * 独立算出这一炷的全部节拍，再拿同一份敲击记录复算同样的功德。
 * daySeed 现由 drand quicknet 公开随机信标派生（见 beacon.js），
 * 连不上才降级为本机日期；判定与结算逻辑始终没改过。
 */

export const BEATS_PER_STICK = 64
export const BEATS_PER_PHRASE = 8
export const PREP_MS = 2200
export const TAIL_MS = 700
/** 相邻两拍的基准间隔；最短 300×0.85 = 255ms，半间隔 127ms > good 窗口，判定窗不会互相重叠 */
export const BASE_GAP_MS = 300
/** 每八拍一个乐句，句末留一次「换气」，也是木鱼诵经的段落感 */
export const PHRASE_PAUSE_MS = 220
export const WINDOW = { perfect: 55, good: 105 }
export const WEIGHT = { perfect: 3, good: 1, miss: 0, wild: 0 }
/** 一炷约 25 秒，释放量按炷时长同步放大，保持单位时间收益与八拍版接近 */
export const BASE_RELEASE = 72

const GAPS = [1, 1, 1, 1.15, 0.85, 1.35]

/** 确定性整数混合：同样的输入永远得到同样的 seed */
export function seedFrom(round, daySeed = 0) {
  let x = (Math.imul(round | 0, 2654435761) + Math.imul(daySeed | 0, 40503)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 2246822507)
  x ^= x >>> 13
  x = Math.imul(x, 3266489909)
  return (x ^ (x >>> 16)) >>> 0
}

/**
 * 由 seed 生成本炷的节拍表：8 句 × 8 拍，句首重拍、句末换气。
 * 间隔在 255~405ms 之间浮动，跟着轨道上的光点敲即可。
 */
export function makePattern(seed) {
  let s = seed >>> 0
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  const beats = []
  let at = PREP_MS
  for (let i = 0; i < BEATS_PER_STICK; i++) {
    const inPhrase = i % BEATS_PER_PHRASE
    const accent = inPhrase === 0 || rnd() > 0.86
    beats.push({ index: i, at: Math.round(at), accent, phrase: Math.floor(i / BEATS_PER_PHRASE) })
    at += BASE_GAP_MS * GAPS[Math.floor(rnd() * GAPS.length)]
    if (inPhrase === BEATS_PER_PHRASE - 1) at += PHRASE_PAUSE_MS
  }
  return { seed, beats, duration: Math.round(at + TAIL_MS) }
}

/**
 * 判定一次敲击。
 * - 命中最近一个尚未判定的节拍，且落在窗口内 → perfect / good
 * - 其余一律 wild（乱敲）：不计权重、断连击，这正是「合拍才有权重」
 */
export function judge(pattern, elapsed, used) {
  let best = -1
  let bestDist = Infinity
  for (const b of pattern.beats) {
    if (used.has(b.index)) continue
    const d = Math.abs(elapsed - b.at)
    if (d < bestDist) { bestDist = d; best = b.index }
    // beats 按 at 升序，越过当前时刻很远就可以停了
    if (b.at > elapsed + WINDOW.good) break
  }
  if (best < 0 || bestDist > WINDOW.good) {
    return { grade: 'wild', beat: -1, delta: Math.round(bestDist) }
  }
  return {
    grade: bestDist <= WINDOW.perfect ? 'perfect' : 'good',
    beat: best,
    delta: Math.round(bestDist)
  }
}

/**
 * 本炷结算。marks 是 { [beatIndex]: grade }。
 * 释放量 = 基础释放 × 合拍率 × 稀释系数（人越多，人均越少）。
 */
export function settle(pattern, marks, online) {
  let weight = 0
  const count = { perfect: 0, good: 0, miss: 0 }
  for (const b of pattern.beats) {
    const g = marks[b.index] || 'miss'
    weight += WEIGHT[g] || 0
    if (g in count) count[g] += 1
  }
  const accuracy = weight / (BEATS_PER_STICK * WEIGHT.perfect)
  const dilution = Math.max(0.4, 1 - online / 4200)
  const reward = Math.round(BASE_RELEASE * accuracy * dilution)
  return { ...count, accuracy, dilution, reward }
}

/** 规则文本：游戏内「寺规」与规则面板共用，改规则只改这一处 */
export const TEMPLE_RULES = [
  '每炷香六十四拍，分八句，句首是重拍、句末留一次换气。跟着光点敲，合拍才有权重，乱敲不计、连击断掉。',
  '一炷约二十五秒，结束按合拍率释放 $GONGDE；同时在场的人越多，人均越少。',
  '全服共添一盏长明灯，灯油满即开光，当炷共修者分奖池，并往常住愿的香火池注油。',
  '挂心愿时自定托管功德（10–500 $G），金额决定要共诵多少下：1 $G ≈ 6 击。任何人都能同时加入，没有抢单，先敲先记。',
  '悬赏不归领诵者独得：按有效击数分，PERFECT 记 3 击、GOOD 记 1 击。人越多送达越快，人均越少 —— 和一炷香的稀释是同一条规矩。',
  '万佛墙第一位永远是「常住共修愿」：寺院发起、长明灯香火供给，没人挂单也有愿可诵、有人同敲；圆满即换新愿，奖池按贡献分（属增发，受每日额度约束）。',
  '心愿托管有效期六炷香。未诵满即按已诵比例结算给共修者、余款退还挂单人；接了单磨蹭不敲也照样到期。挂单人可随时撤回，已诵部分照结算。',
  '四法器每日各有限次与冷却，重复修行收益递减；所有「增发型」功德共用每日 600 $G 额度，超额按 1 → 0.5 → 0.2 → 0 衰减。',
  '代诵领赏、随喜加香、流单退还属于玩家之间的转移，不增发、不占每日额度 —— 双边市场不靠增发撑着。',
  '烧香的人买的是别人的时间与专注，敲木鱼的人卖的也是；币只是计价单位。消耗品必须换来「币以外的东西」，凡是「烧了能赚更多币」的升级，本寺不做。规则写死在开源代码里，任何人可复算；不连钱包也能玩。',
  '一炷香出一张「禅印」回执：含第几炷、当日种子、六十四拍判定、在场人数、结算结果与上一张的短码。任何人把回执贴进「禅印 → 验签」，都能用同一份开源规则重建节拍表、复算合拍率与功德；改过任何一个字，校验码或链就对不上。',
  '当日种子来自 drand quicknet 公开随机信标：取当天 UTC 零点那一轮的公开随机值。任何人都能到官方端点查回同一轮，确认没人提前挑过种子、也没人事后改过。按 UTC 换日，全球同一天同一套功课；判定与结算逻辑没变。',
  '验签分两层：离线复算寺规永远可用；点「核对公开信标」会并发查多个独立中继，至少两源一致才采信，并校验该轮随机值能推出回执里的种子。前端不做 BLS 验签，官方链接可查该轮签名，需要免信任可用 drand 工具完整验签。',
  '信标连不上时明确降级为本机日期种子，回执标「本机弱验证」，绝不冒充公开随机值。禅印证明「这串记录按规则该得这些功德」，不证明真人真的敲了；账本可导出成一行文本换设备续修，导入会覆盖本机现有余额与心愿。',
  '每张禅印就是一张功德票：票面额由寺规算出、固定不变，只能整张转。出印时自动用本法号（只存在你浏览器里的 P-256 密钥）署名认领；转出会扣掉你等量余额，对方「凭票入账」才加回去 —— 票不能凭空造。',
  '转让单带持有人签名和票根，任何人贴进「禅印 → 功德票 → 导入并重新审计」都能验：票真不真、面额对不对、签名是不是本人、流转链有没有分叉。同一张票转给两个人，各自的账都正常，两本一合并就报双花。',
  '公共流水挂在公开公告板（ntfy.sh），免账号、任何人可读写，消息只留约 12 小时，长期账本靠参与者互相导出镜像。没有共识，所以只能事后发现双花、不能事前阻止；私钥丢了只能靠身份备份恢复，别把它贴到群里。',
  '心愿、托管功德、长明灯与禅印回执留在你本机浏览器：刷新会续上，清缓存或换设备即从头开始。挂愿、接单、送达与会场心跳会广播到公共公告板，所以别人看得见你的愿 —— 但余额与托管仍只在你本机，别人改不了。',
  '会场与万佛墙是真人：每个人每 30 秒发一次带签名的「在场」心跳（在诵哪条愿、已诵多少击），客户端按人取最大值求和，得到这条愿的真实进度。连不上公告板时明确退回本地演示并标出，绝不拿模拟数据冒充真人。',
  '边界：心跳里的击数是各人自报，客户端只能验「是不是这个法号说的」，不能验「他是不是真的敲了」。要真正防作弊，得靠公共账本层面的互相监督 —— 这一层提供的是「有别人」，不是「没人能撒谎」。',
  '还愿靠自觉也靠公开记录：愿主诵满后把一张功德票转给代诵的同修，转让与送达都在公告板上，谁都能核对。没有平台托管，所以「还愿率」是声誉而不是强制。',
  '当前为实验原型：未上链、不承诺任何收益，可能归零；公共公告板的消息约 12 小时过期，长期记录靠参与者互相镜像。'
]
