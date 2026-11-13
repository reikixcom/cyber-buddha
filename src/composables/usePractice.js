import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import {
  makePattern, seedFrom, judge, settle,
  WINDOW, BEATS_PER_STICK, BASE_RELEASE
} from '../temple/rhythm.js'
import {
  BOUNTY_MIN, BOUNTY_MAX, BOUNTY_TIERS, WISH_STICK_LIMIT,
  TEMPLE_NEED, TEMPLE_POOL_BASE, TEMPLE_POOL_PER_OPENING,
  needFor, clampBounty, shareOf, earnedPart
} from '../temple/economy.js'
import { sanitizePracticeSave, SEAL_KEEP } from '../temple/save.js'
import { makeSeal, shortOf } from '../temple/seal.js'
import { utcDayKey, fallbackDaySeed } from '../temple/beacon.js'

const TRAVEL_MS = 2200
const JUDGE_X = 18
const BOOST_COST = 10
const GRADE_SHOW_MS = 520
/** 刚挂上的心愿留几秒给挂单人撤回，也给玩家先看到「等共修者来」 */
const POST_GRACE_MS = 2500

const WISH_POOL = [
  '愿本周上线不回滚', '愿 offer 落地，薪资翻倍', '愿父母身体安康',
  '愿这只猫找到家', '愿数据库再无慢查询', '愿异地的人早日重逢',
  '愿毕业设计一次过', '愿今晚睡个好觉', '愿世界少一点加班'
]
const TEMPLE_VERSES = [
  '愿众生离苦得乐', '愿长明灯不灭', '愿迷路的人找到路',
  '愿所有等待都有回音', '愿此间香火，传于后来人', '愿天下无有加班之夜'
]
const NAMES = ['青灯客', '无量', '0x木鱼', '半盏', '数据沙弥', '夜行僧', '空指针', '晚钟']
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
/** 首屏还没连上信标时的诚实降级：本机日期种子 + 明确标记，不冒充公开随机值 */
const fallbackBeacon = () => {
  const day = utcDayKey()
  return { day, round: 0, seed: fallbackDaySeed(day), randomness: '', sources: [], status: 'local' }
}

let wishSeq = 10
function newWish(overrides = {}) {
  const w = {
    id: ++wishSeq,
    kind: 'user',
    text: pick(WISH_POOL),
    owner: '0x' + Math.random().toString(16).slice(2, 4).toUpperCase() + '…' + Math.random().toString(16).slice(2, 4).toUpperCase(),
    bounty: pick(BOUNTY_TIERS),
    need: 0,
    progress: 0,
    /** 多人共诵贡献表：{ 名字: 有效击数 }，'你' 即玩家 */
    contributors: {},
    /** 领诵者（贡献最高者），仅用于展示，不再是「独占权」 */
    worker: null,
    crowd: 0,
    mine: false,
    done: false,
    expired: false,
    sticks: 0,
    postedAt: Date.now(),
    ...overrides
  }
  // 悬赏越高，代诵需要敲的下数越多 —— 挂单人自己决定这单有多长
  w.need = overrides.need ?? needFor(w.bounty)
  return w
}

function newTempleVow(cycle, pool) {
  return newWish({
    kind: 'temple',
    text: TEMPLE_VERSES[(cycle - 1) % TEMPLE_VERSES.length],
    owner: '本寺常住',
    bounty: pool,
    need: TEMPLE_NEED,
    cycle,
    postedAt: 0
  })
}

/** 初始市场：常住愿永远在第一位，再配一条速成单和几条长线单 */
function makeMarket(temple) {
  return [
    temple,
    newWish({ text: '愿今晚睡个好觉', bounty: 20 }),
    newWish({ text: '愿这只猫找到家', bounty: 50 }),
    newWish({ text: '愿 offer 落地，薪资翻倍', bounty: 100 }),
    newWish({ text: '愿父母身体安康', bounty: 200 })
  ]
}

/**
 * 共修原型：节奏敲木鱼 + 长明灯 + 多人共诵悬赏 + 常住共修愿。
 * 所有数值本地模拟，不接链、不接钱包、不接服务端。
 */
export function usePractice({ merit, addBalance, pushLog, addToast, onKnockVisual, onCelebrate, onPersist }) {
  const beacon = ref(fallbackBeacon())
  let daySeed = beacon.value.seed
  /** 本炷快照：信标中途切换不影响正在敲的这一炷，下一炷才用新种子 */
  let stickSeed = daySeed
  let stickBeacon = { day: beacon.value.day, round: beacon.value.round }
  const running = ref(false)
  const phase = ref('idle')
  const round = ref(0)
  const pattern = ref(makePattern(seedFrom(0, daySeed)))
  const marks = ref({})
  const elapsed = ref(0)
  const chain = ref(0)
  const wildCount = ref(0)
  const lastGrade = ref('')
  const gradeKey = ref(0)
  const gradeVisible = ref(false)
  const settlement = ref(null)
  /** 禅印回执链：一炷香一张，只留最近 SEAL_KEEP 张，短码互相串起来 */
  const seals = ref([])
  const lastSeal = ref(null)
  const showSeals = ref(false)

  const lamp = ref(55)
  const online = ref(1480)
  const openings = ref(0)
  /** 常住愿的香火池：每开光一次注入，属于增发型收入，受每日额度约束 */
  const templePool = ref(TEMPLE_POOL_BASE)
  const templeCycles = ref(1)
  const templeVow = newTempleVow(1, templePool.value)
  let templeId = templeVow.id

  // 心愿池刻意分档：小额速成、大额长线；第一位永远是常住共修愿
  const wishes = ref(makeMarket(templeVow))
  /** 默认就跟着常住愿敲 —— 没人挂单也有事可做 */
  const activeWishId = ref(templeId)
  const showRules = ref(false)
  const myWishText = ref('')
  const wishBounty = ref(20)

  let used = new Set()
  let stickStart = 0
  let raf = 0
  let timer = 0
  let settleTimer = 0
  let gradeTimer = 0
  let pausedAt = 0
  let pausedPhase = 'running'

  /** 账本关键变动立刻落盘，不等定时器：托管扣款 / 送达分赏 / 流单退还 / 开光 / 撤回 */
  const persist = () => onPersist?.()

  const beatDone = computed(() => Object.keys(marks.value).length)
  const activeWish = computed(() => wishes.value.find((w) => w.id === activeWishId.value && !w.done) || null)
  const accuracyNow = computed(() => {
    let w = 0
    for (const b of pattern.value.beats) w += { perfect: 3, good: 1 }[marks.value[b.index]] || 0
    return w / (BEATS_PER_STICK * 3)
  })
  const beatsOnTrack = computed(() => pattern.value.beats
    .map((b) => ({
      ...b,
      left: JUDGE_X + ((b.at - elapsed.value) / TRAVEL_MS) * (100 - JUDGE_X),
      grade: marks.value[b.index] || ''
    }))
    .filter((b) => b.left > -8 && b.left < 106))
  const countdown = computed(() => Math.max(0, (pattern.value.duration - elapsed.value) / 1000))
  const lampPct = computed(() => Math.min(100, lamp.value))
  const templeVowRef = computed(() => wishes.value.find((w) => w.kind === 'temple') || null)

  /** 只在玩家真的敲下去时调用；自动漏拍不刷飘字、也不让木鱼自己动 */
  function setGrade(g) {
    lastGrade.value = g
    gradeKey.value += 1
    gradeVisible.value = true
    clearTimeout(gradeTimer)
    gradeTimer = setTimeout(() => { gradeVisible.value = false }, GRADE_SHOW_MS)
  }

  function syncPool() {
    const t = templeVowRef.value
    if (t) t.bounty = templePool.value
  }

  function addLamp(n) {
    lamp.value += n
    if (lamp.value < 100) return
    lamp.value = 0
    openings.value += 1
    const reward = 18 + openings.value * 2
    const got = addBalance(reward, 'emit')
    if (got > 0) addToast('长明灯 · 开光', `全服共修分得 ${got} $GONGDE`)
    else addToast('长明灯 · 开光', '今日增发额度已满，灯照常点亮')
    templePool.value += TEMPLE_POOL_PER_OPENING
    syncPool()
    pushLog(`第 ${openings.value} 次开光 · 灯油满，常住愿香火池 +${TEMPLE_POOL_PER_OPENING}`, true)
    onCelebrate?.()
    persist()
  }

  /** 一次有效共诵：任何名字都能加，进度到顶即结算 */
  function contribute(w, name, hits) {
    if (!w || w.done || hits <= 0) return
    const add = Math.min(hits, w.need - w.progress)
    if (add <= 0) return
    w.progress += add
    const next = { ...(w.contributors || {}) }
    next[name] = (next[name] || 0) + add
    w.contributors = next
    w.crowd = Object.keys(next).length
    w.worker = Object.entries(next).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    if (w.progress >= w.need) deliver(w)
  }

  /** 常住愿圆满：不消失，换新愿继续，避免「没人挂单就没互动」 */
  function settleTemple(w) {
    const people = Object.keys(w.contributors || {}).length
    const myHits = w.contributors?.['你'] || 0
    const due = shareOf(templePool.value, myHits, w.progress)
    if (due > 0) {
      const credited = addBalance(due, 'emit')
      addToast('常住愿圆满 · 分得香火', `+${credited} $GONGDE · 你 ${myHits} 击 / ${people} 人共诵`)
    } else {
      addToast('常住愿圆满', myHits ? '今日增发额度已满' : `${people} 人共诵，本轮你未参与`)
    }
    pushLog(`第 ${w.cycle} 轮常住愿圆满 · ${people} 人共诵 ${w.need} 击`, true)
    onCelebrate?.()
    templeCycles.value += 1
    templePool.value = TEMPLE_POOL_BASE
    w.text = TEMPLE_VERSES[(templeCycles.value - 1) % TEMPLE_VERSES.length]
    w.cycle = templeCycles.value
    w.progress = 0
    w.contributors = {}
    w.crowd = 0
    w.worker = null
    w.bounty = templePool.value
    w.sticks = 0
    persist()
  }

  function deliver(w) {
    if (w.done) return
    if (w.kind === 'temple') { settleTemple(w); return }
    w.done = true
    w.deliveredAt = Date.now()
    const people = Object.keys(w.contributors || {}).length
    const myHits = w.contributors?.['你'] || 0
    const due = myHits > 0 ? shareOf(w.bounty, myHits, w.progress) : 0
    if (due > 0) {
      addBalance(due, 'transfer')
      addToast('心愿送达 · 按击数分赏', `+${due} $GONGDE · 你 ${myHits} 击 / ${people} 人共诵（转移，不占每日额度）`)
      pushLog(`共诵圆满 ·「${w.text}」${people} 人送达，你分得 ${due} $G`, true)
    } else if (w.mine) {
      addToast('你的心愿已送达', `${people} 位共修者一起敲满 ${w.need} 下`)
      pushLog(`${people} 位共修者为你的心愿「${w.text}」代诵圆满`, true)
    } else {
      pushLog(`${w.worker || '共修者'} 领诵 ·「${w.text}」${people} 人共诵圆满`)
    }
    if (activeWishId.value === w.id) activeWishId.value = templeId
    persist()
  }

  /**
   * 托管有效期：自挂单起六炷香仍未「送达」即流单。
   * 已诵部分按击数分给共修者，余款退还挂单人。
   * 任何人「加入共诵」都不暂停计时 —— 否则占着单不敲就能把托管款无限锁住，
   * 也和寺规「接了单磨蹭不敲也照样到期」对不上。
   */
  function expireWishes() {
    let changed = false
    for (const w of wishes.value) {
      if (w.kind === 'temple' || w.done) continue
      w.sticks += 1
      changed = true
      if (w.sticks < WISH_STICK_LIMIT) continue
      const earned = earnedPart(w.bounty, w.progress, w.need)
      const myHits = w.contributors?.['你'] || 0
      const myShare = myHits > 0 ? shareOf(earned, myHits, w.progress) : 0
      w.done = true
      w.expired = true
      w.deliveredAt = Date.now()
      w.earned = earned
      w.refund = w.bounty - earned
      if (activeWishId.value === w.id) activeWishId.value = templeId
      if (w.mine) {
        const refund = w.refund
        addBalance(refund, 'transfer')
        addToast('心愿流单 · 按进度结算', `已诵 ${w.progress}/${w.need} 击 · 退还 ${refund} $GONGDE`)
        pushLog(`「${w.text}」六炷未诵满，已诵 ${earned} $G 归共修者，余 ${refund} $G 退还`)
      } else if (myShare > 0) {
        addBalance(myShare, 'transfer')
        addToast('心愿流单 · 按击数分赏', `你 ${myHits} 击 · 分得 ${myShare} $GONGDE`)
        pushLog(`「${w.text}」六炷未诵满，你分得 ${myShare} $G`)
      } else {
        pushLog(`「${w.text}」六炷未诵满，已流单`)
      }
    }
    if (changed) persist()
  }

  function nextStick() {
    round.value += 1
    stickSeed = daySeed
    stickBeacon = { day: beacon.value.day, round: beacon.value.round }
    pattern.value = makePattern(seedFrom(round.value, stickSeed))
    marks.value = {}
    used = new Set()
    wildCount.value = 0
    elapsed.value = 0
    lastGrade.value = ''
    gradeVisible.value = false
    clearTimeout(gradeTimer)
    stickStart = performance.now()
    phase.value = 'running'
  }

  function finishStick() {
    for (const b of pattern.value.beats) {
      if (!used.has(b.index)) {
        used.add(b.index)
        marks.value = { ...marks.value, [b.index]: 'miss' }
      }
    }
    const r = settle(pattern.value, marks.value, online.value)
    phase.value = 'settle'
    // 一炷香 = 一个区块：把可复算的敲击记录串到上一张回执后面
    const seal = makeSeal({
      round: round.value,
      daySeed: stickSeed,
      beacon: stickBeacon,
      pattern: pattern.value,
      marks: marks.value,
      wild: wildCount.value,
      online: online.value,
      result: r,
      prev: shortOf(seals.value[seals.value.length - 1]),
      at: Date.now()
    })
    const firstSeal = seals.value.length === 0
    seals.value = [...seals.value, seal.text].slice(-SEAL_KEEP)
    lastSeal.value = seal
    settlement.value = {
      ...r, round: round.value, wild: wildCount.value,
      online: online.value, sealShort: seal.short
    }
    if (firstSeal) pushLog('首张禅印已生成 · 心愿板「禅印」可复制给他人复算', true)
    persist()
    const got = addBalance(r.reward, 'emit')
    if (got > 0) {
      pushLog(`第 ${round.value} 炷结算 · 合拍 ${Math.round(r.accuracy * 100)}% · +${got} $GONGDE`, got >= 30)
    } else if (r.reward > 0) {
      pushLog(`第 ${round.value} 炷结算 · 今日增发额度已满，本炷不计功德`)
    } else {
      pushLog(`第 ${round.value} 炷空过 · 乱敲与漏拍不计功德`)
    }
    expireWishes()
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settlement.value = null
      nextStick()
    }, 1600)
  }

  function frame() {
    if (!running.value) return
    raf = requestAnimationFrame(frame)
    if (phase.value !== 'running') return
    const e = performance.now() - stickStart
    elapsed.value = e
    // beats 按时间升序；自动漏拍只记 marks 和断连击，不刷判定飘字（64 拍会刷屏）
    for (const b of pattern.value.beats) {
      if (e <= b.at + WINDOW.good) break
      if (!used.has(b.index)) {
        used.add(b.index)
        marks.value = { ...marks.value, [b.index]: 'miss' }
        chain.value = 0
      }
    }
    if (e >= pattern.value.duration) finishStick()
  }

  /** 模拟共修者：每个心愿同时有好几个人在敲，没有「抢单」这回事 */
  function simulate() {
    online.value = Math.max(900, Math.min(2600, online.value + Math.round((Math.random() - 0.5) * 46)))
    addLamp(0.9 + Math.random() * 0.8)

    const shuffled = [...NAMES].sort(() => Math.random() - 0.5)
    for (const w of wishes.value) {
      if (w.done) continue
      if (w.kind !== 'temple' && w.postedAt && Date.now() - w.postedAt < POST_GRACE_MS) continue
      const n = w.kind === 'temple' ? 5 : (w.bounty >= 100 ? 3 : 2)
      const speed = Math.max(1, Math.min(9, Math.round(w.need / 260)))
      const cycleAtStart = w.cycle
      for (let i = 0; i < n; i++) {
        if (w.done || w.cycle !== cycleAtStart || w.progress >= w.need) break
        contribute(w, shuffled[i % shuffled.length], Math.max(1, Math.round(speed * (0.5 + Math.random()))))
      }
    }

    const now = Date.now()
    const live = wishes.value.filter((w) => w.kind === 'temple' || !w.done || now - (w.deliveredAt || now) < 5000)
    // 市场里始终留一条速成单和一条长线单，人少时玩家照样有得选
    const open = live.filter((w) => w.kind !== 'temple' && !w.done && !w.mine)
    if (!open.some((w) => w.bounty <= 50)) live.push(newWish({ bounty: BOUNTY_TIERS[0] }))
    if (!open.some((w) => w.bounty >= 100)) live.push(newWish({ bounty: BOUNTY_TIERS[2] }))
    while (live.length < 6) live.push(newWish())
    const temple = live.find((w) => w.kind === 'temple')
    const rest = live.filter((w) => w.kind !== 'temple').slice(0, 6)
    wishes.value = temple ? [temple, ...rest] : rest
  }

  function knock() {
    if (phase.value !== 'running') return
    const e = performance.now() - stickStart
    const res = judge(pattern.value, e, used)

    if (res.grade === 'wild') {
      wildCount.value += 1
      chain.value = 0
      setGrade('wild')
      onKnockVisual?.('wild')
      return
    }

    used.add(res.beat)
    marks.value = { ...marks.value, [res.beat]: res.grade }
    chain.value += 1
    setGrade(res.grade)
    onKnockVisual?.(res.grade)
    addLamp(res.grade === 'perfect' ? 0.9 : 0.4)

    // 合拍一击记入「当前共诵的心愿」；别人可以同时敲，各记各的击数
    const w = activeWish.value
    if (w && !w.mine) contribute(w, '你', res.grade === 'perfect' ? 3 : 1)
  }

  /** 加入 / 切换 / 退出共诵；不再是抢占，任何人随时可以一起敲 */
  function takeWish(w) {
    if (w.done || w.expired) return
    if (w.mine) {
      addToast('这是你挂的心愿', '等别的共修者一起替你诵')
      return
    }
    if (activeWishId.value === w.id) {
      activeWishId.value = templeId
      addToast('已退出共诵', '回到常住共修愿，香火不断')
      pushLog('退出共诵 · 回到常住愿')
      persist()
      return
    }
    activeWishId.value = w.id
    const people = Object.keys(w.contributors || {}).length
    addToast('已加入共诵', `${people} 人正在敲 · 悬赏按击数分，先敲先记`)
    pushLog(`加入共诵 ·「${w.text}」悬赏 ${w.bounty} $G / ${w.need} 击 · ${people} 人同诵`)
    persist()
  }

  function postWish() {
    const text = myWishText.value.trim().slice(0, 24)
    if (!text) return
    const bounty = clampBounty(wishBounty.value)
    if (merit.value < bounty) {
      addToast('功德不足', `挂单需托管 ${bounty} $GONGDE，当前 ${merit.value}`)
      return
    }
    addBalance(-bounty, 'transfer')
    const temple = wishes.value.find((w) => w.kind === 'temple')
    const rest = wishes.value.filter((w) => w.kind !== 'temple')
    wishes.value = [
      ...(temple ? [temple] : []),
      newWish({ text, owner: '你', bounty, mine: true }),
      ...rest
    ]
    myWishText.value = ''
    addToast('心愿已挂上万佛墙', `${bounty} $G 已托管 · 需共诵 ${needFor(bounty)} 击，多人一起敲`)
    pushLog(`万佛墙新增心愿 ·「${text}」悬赏 ${bounty} $G`, true)
    // 托管是真实扣款：这一笔必须和心愿一起落盘，刷新后不能钱没了、愿也没了
    persist()
  }

  /** 撤回：无人开诵时全额退还；已有人共诵则按已诵比例结算，余款退回 */
  function cancelWish(w) {
    if (!w.mine || w.done) return
    const earned = earnedPart(w.bounty, w.progress, w.need)
    const refund = w.bounty - earned
    addBalance(refund, 'transfer')
    wishes.value = wishes.value.filter((x) => x.id !== w.id)
    addToast('心愿已撤回', `退还 ${refund} $GONGDE${earned ? ` · 已诵 ${earned} $G 归共修者` : ''}`)
    pushLog(`撤回心愿 ·「${w.text}」托管退还 ${refund} $G`)
    persist()
  }

  /** 随喜加香：给未完成的心愿追加悬赏，提高所有共诵者每一击的报酬 */
  function boostWish(w) {
    if (w.done) return
    if (merit.value < BOOST_COST) {
      addToast('功德不足', `随喜需 ${BOOST_COST} $GONGDE`)
      return
    }
    addBalance(-BOOST_COST, 'transfer')
    if (w.kind === 'temple') {
      templePool.value += BOOST_COST
      syncPool()
    } else {
      w.bounty += BOOST_COST
    }
    w.boosts = (w.boosts || 0) + 1
    addToast('随喜加香', `「${w.text}」香火池 +${BOOST_COST} $G`)
    pushLog(`随喜加香 ·「${w.text}」香火池升至 ${w.bounty} $G`)
    persist()
  }

  /**
   * 读档：复用当前常住愿对象（它的 id 是内部回落目标），只把存档字段灌回去，
   * 这样不用改写所有对 templeId 的引用，也不会出现指向不存在心愿的 activeWishId。
   */
  function restoreMarket(raw) {
    const s = sanitizePracticeSave(raw)
    if (!s) return false
    const temple = wishes.value.find((w) => w.kind === 'temple')
    const savedTemple = s.wishes.find((w) => w.kind === 'temple')
    if (!temple || !savedTemple) return false
    Object.assign(temple, {
      text: savedTemple.text,
      cycle: savedTemple.cycle,
      progress: savedTemple.progress,
      contributors: savedTemple.contributors,
      crowd: savedTemple.crowd,
      worker: savedTemple.worker,
      need: TEMPLE_NEED,
      bounty: s.templePool,
      sticks: 0,
      postedAt: 0
    })
    const others = s.wishes.filter((w) => w.kind !== 'temple' && w.id !== templeId)
    wishes.value = [temple, ...others]
    wishSeq = Math.max(wishSeq, ...wishes.value.map((w) => w.id))
    lamp.value = s.lamp
    openings.value = s.openings
    templePool.value = s.templePool
    templeCycles.value = s.templeCycles
    // 接着存档里的炷号往下出块，刷新后不会再出现两张「第 1 炷」
    round.value = s.round
    const target = s.activeWishId === savedTemple.id ? templeId : s.activeWishId
    activeWishId.value = target === templeId || others.some((w) => w.id === target && !w.done)
      ? target : templeId
    seals.value = s.seals
    lastSeal.value = null
    return true
  }

  /** 清空功德账本时同步清空市场：否则流单退款会把「已清零」的余额又刷回来 */
  function resetMarket() {
    let temple = wishes.value.find((w) => w.kind === 'temple')
    if (!temple) {
      temple = newTempleVow(1, TEMPLE_POOL_BASE)
      templeId = temple.id
    }
    Object.assign(temple, {
      text: TEMPLE_VERSES[0], cycle: 1, need: TEMPLE_NEED,
      bounty: TEMPLE_POOL_BASE, progress: 0, contributors: {},
      crowd: 0, worker: null, sticks: 0, postedAt: 0
    })
    wishes.value = makeMarket(temple)
    lamp.value = 55
    openings.value = 0
    templePool.value = TEMPLE_POOL_BASE
    templeCycles.value = 1
    round.value = 0
    activeWishId.value = templeId
    seals.value = []
    lastSeal.value = null
    showSeals.value = false
    persist()
  }

  /**
   * 由 App 注入当日公开信标（或降级状态）。只影响下一炷的种子，
   * 正在敲的这一炷仍用 stickSeed / stickBeacon 快照出印，回执始终自洽。
   */
  function applyBeacon(next) {
    if (!next || typeof next.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(next.day) ||
        !Number.isInteger(next.round) || next.round < 0 || !Number.isFinite(next.seed)) return false
    const seed = next.round > 0 ? (next.seed >>> 0) : fallbackDaySeed(next.day)
    if (!Number.isFinite(seed)) return false
    const status = next.status || (next.round > 0 ? 'public' : 'local')
    const changed = daySeed !== seed || beacon.value.status !== status
    daySeed = seed
    beacon.value = {
      day: next.day,
      round: next.round,
      seed,
      randomness: typeof next.randomness === 'string' ? next.randomness : '',
      sources: Array.isArray(next.sources) ? next.sources : [],
      status
    }
    // 还没点「入寺」：预热本炷快照，让第一张回执就用上公开信标，
    // 而不是等第二炷才生效。一旦开敲就保持快照不动，避免半炷换节拍表。
    if (!running.value && round.value === 0) {
      stickSeed = daySeed
      stickBeacon = { day: next.day, round: next.round }
      pattern.value = makePattern(seedFrom(0, stickSeed))
    }
    return changed
  }

  function runLoop() {
    raf = requestAnimationFrame(frame)
    timer = setInterval(simulate, 700)
  }

  function start() {
    if (running.value) return
    running.value = true
    nextStick()
    runLoop()
    pushLog('共修已开始 · 空格 / 点轨道 / 点「敲」跟着光点落拍', true)
  }

  /** 真暂停：冻结本炷进度、结算与长明灯；继续时把暂停时长补回起始时刻，从原来那一拍接着敲 */
  function toggle() {
    if (running.value) {
      pausedPhase = phase.value
      pausedAt = performance.now()
      running.value = false
      phase.value = 'paused'
      cancelAnimationFrame(raf)
      clearInterval(timer)
      clearTimeout(settleTimer)
      clearTimeout(gradeTimer)
      gradeVisible.value = false
      pushLog('共修已暂停 · 本炷进度与长明灯冻结')
      return
    }
    if (pausedAt === 0) { start(); return }
    const gap = performance.now() - pausedAt
    stickStart += gap
    pausedAt = 0
    running.value = true
    if (pausedPhase === 'settle') {
      phase.value = 'settle'
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => { settlement.value = null; nextStick() }, 900)
    } else {
      phase.value = 'running'
    }
    runLoop()
    pushLog('共修继续 · 回到刚才那一拍', true)
  }

  onBeforeUnmount(() => {
    running.value = false
    cancelAnimationFrame(raf)
    clearInterval(timer)
    clearTimeout(settleTimer)
    clearTimeout(gradeTimer)
  })

  return reactive({
    running, phase, round, pattern, marks, elapsed, chain, wildCount,
    lastGrade, gradeKey, gradeVisible, settlement, seals, lastSeal, showSeals,
    beacon, applyBeacon,
    lamp, lampPct, online, openings,
    templePool, templeCycles, templeId, wishes, activeWish, activeWishId,
    showRules, myWishText, wishBounty,
    beatDone, accuracyNow, beatsOnTrack, countdown, judgeX: JUDGE_X,
    baseRelease: BASE_RELEASE, beatsPerStick: BEATS_PER_STICK, boostCost: BOOST_COST,
    bountyMin: BOUNTY_MIN, bountyMax: BOUNTY_MAX, bountyTiers: BOUNTY_TIERS,
    stickLimit: WISH_STICK_LIMIT, needFor, shareOf,
    knock, takeWish, postWish, cancelWish, boostWish, start, toggle,
    restoreMarket, resetMarket
  })
}
