<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { TEMPLE_RULES } from '../temple/rhythm.js'
import { clampBounty } from '../temple/economy.js'

const props = defineProps({ p: { type: Object, required: true } })
// 窄屏默认收起心愿板，给节奏台和 3D 场景让出空间；桌面端 CSS 忽略此状态
const collapsed = ref(true)
// 窄屏把常住愿交给底部节奏条展示，列表直接露出可「加入共诵」的心愿
const narrow = ref(window.innerWidth <= 860)
const onResize = () => { narrow.value = window.innerWidth <= 860 }
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const myHits = (w) => w.contributors?.['你'] || 0
const crowd = (w) => Object.keys(w.contributors || {}).length || w.crowd || 0
const share = (w) => props.p.shareOf(w.bounty, myHits(w), Math.max(1, w.need))
const topNames = (w) => Object.entries(w.contributors || {})
  .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(' · ')

// 桌面常住愿永远置顶；窄屏它已在底部节奏条里，列表优先给可加入的心愿
const visibleWishes = computed(() => {
  const rank = (w) => {
    if (w.done) return 4
    if (w.kind === 'temple') return 0
    if (w.id === props.p.activeWishId) return 1
    if (w.mine) return 2
    return 3
  }
  const pool = props.p.wishes.filter((w) => !narrow.value || w.kind !== 'temple')
  return [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, narrow.value ? 4 : 5)
})
const freeCount = computed(() => props.p.wishes.filter(
  (w) => !w.done && !w.mine && w.id !== props.p.activeWishId && (!narrow.value || w.kind !== 'temple')
).length)
const miniText = computed(() => narrow.value
  ? `灯油 ${props.p.lampPct.toFixed(0)}% · ${freeCount.value} 愿`
  : `灯油 ${props.p.lampPct.toFixed(0)}% · 开光 ${props.p.openings} 次 · ${freeCount.value} 愿可共诵`)
const draftNeed = computed(() => props.p.needFor(clampBounty(props.p.wishBounty)))

function setBounty(e) {
  props.p.wishBounty = clampBounty(e.target.value)
  e.target.value = props.p.wishBounty
}

/** 加入是「一起敲」，不是抢单：别人已经在诵也照样能进 */
function wishState(w) {
  if (w.expired) return {
    text: w.mine ? `已流单 · 退 ${w.refund} $G` : '已流单 · 按击数结算',
    cls: 'done', locked: true
  }
  if (w.done) return { text: '已送达', cls: 'done', locked: true }
  if (w.mine && !w.progress) return { text: '等共修者来诵', cls: 'waiting', locked: true }
  if (w.mine) return { text: `${crowd(w)} 人共诵中`, cls: 'taken', locked: true }
  if (w.id === props.p.activeWishId && w.kind === 'temple') return { text: '常住共修中', cls: 'taken', locked: true }
  if (w.id === props.p.activeWishId) return { text: '共诵中 · 退出', cls: 'mine', locked: false }
  return { text: '加入共诵', cls: 'free', locked: false }
}
</script>

<template>
  <div class="sangha panel" :class="{ 'is-collapsed': collapsed }">
    <div class="sangha-head">
      <span class="panel-title">SANGHA · 共修与心愿</span>
      <span class="sangha-mini">{{ miniText }}</span>
      <div class="sangha-actions">
        <button class="sangha-toggle clickable" @click="collapsed = !collapsed">{{ collapsed ? '展开' : '收起' }}</button>
        <button class="rules-btn clickable" @click="p.showRules = true">寺规 ?</button>
      </div>
    </div>

    <div class="sangha-body">
      <div class="demo-tag">DEMO · 数值本地模拟，未上链</div>

      <!-- 长明灯已移到右上角常驻卡片：这里不再重复占高度，窄屏折叠也不会把它藏掉 -->

      <div class="wish-head">
        <span class="label-mono">万佛墙 · 众人共诵</span>
        <span class="wish-sub">不抢单 · 悬赏按击数分</span>
      </div>

      <div class="wish-list">
        <div
          v-for="w in visibleWishes" :key="w.id" class="wish" :data-id="w.id"
          :class="{ done: w.done, active: w.id === p.activeWishId, temple: w.kind === 'temple' }"
        >
          <div class="wish-line">
            <span class="wish-text" :title="w.text">
              <b v-if="w.kind === 'temple'" class="temple-tag">常住</b>{{ w.text }}
            </span>
            <span class="wish-bounty">{{ w.bounty }} <small>$G</small></span>
          </div>
          <div class="wish-line sub">
            <span>
              {{ w.mine ? '你挂的' : w.owner }} · <b class="crowd-num">{{ crowd(w) }} 人共诵</b>
              <em v-if="!w.done && w.kind !== 'temple'" class="wish-expire"> · 剩 {{ p.stickLimit - w.sticks }} 炷</em>
            </span>
            <span>{{ w.progress }}/{{ w.need }} 击</span>
          </div>
          <div v-if="!w.done" class="wish-line sub wish-contrib">
            <span class="contrib-names">{{ topNames(w) || '等第一位共修者' }}</span>
            <span :class="{ 'my-share': myHits(w) > 0 }">
              {{ myHits(w) > 0 ? `你 ${myHits(w)} 击 · 预计 +${share(w)} $G` : '按击数分悬赏' }}
            </span>
          </div>
          <div class="wish-bar"><i :style="{ width: (w.progress / w.need * 100) + '%' }"></i></div>
          <div class="wish-actions">
            <button
              class="wish-btn clickable" :class="wishState(w).cls"
              :disabled="wishState(w).locked"
              @click="p.takeWish(w)"
            >{{ wishState(w).text }}</button>
            <button v-if="w.mine && !w.done" class="wish-mini clickable" @click="p.cancelWish(w)">撤回</button>
            <button v-else-if="!w.done" class="wish-mini clickable" @click="p.boostWish(w)">+{{ p.boostCost }} 随喜</button>
          </div>
        </div>
      </div>

      <div class="post-wish">
        <input
          class="wish-input clickable" type="text" maxlength="24"
          placeholder="写一个心愿…（最多 24 字）"
          :value="p.myWishText"
          @input="p.myWishText = $event.target.value"
          @keyup.enter="p.postWish()"
        />
        <button class="post-btn clickable" @click="p.postWish()">挂单</button>
      </div>
      <div class="bounty-row">
        <span class="bounty-label">托管</span>
        <button
          v-for="t in p.bountyTiers" :key="t"
          class="bounty-chip clickable" :class="{ on: p.wishBounty === t }"
          @click="p.wishBounty = t"
        >{{ t }}</button>
        <input
          class="bounty-input clickable" type="number" :min="p.bountyMin" :max="p.bountyMax"
          :value="p.wishBounty" @change="setBounty" aria-label="自定义托管功德"
        />
        <span class="bounty-unit">$G</span>
        <span class="bounty-need">≈ {{ draftNeed }} 击</span>
      </div>
      <div class="post-note">托管越高共诵越久 · 悬赏由所有共诵者按击数分走，不占你的每日额度</div>

      <div v-if="p.activeWish" class="active-note">
        正与 <b>{{ crowd(p.activeWish) }}</b> 人同诵「{{ p.activeWish.text }}」· 切换心愿不会丢掉已敲的击数
      </div>
    </div>
  </div>

  <Transition name="fade">
    <div v-if="p.showRules" class="rules-backdrop clickable" @click.self="p.showRules = false">
      <div class="rules-card panel">
        <div class="rules-head">
          <div>
            <div class="panel-title">TEMPLE RULES · 寺规</div>
            <h2>规则讲明白，才敢叫没有项目方</h2>
          </div>
          <button class="rules-close clickable" @click="p.showRules = false">×</button>
        </div>
        <ol class="rules-list">
          <li v-for="(r, i) in TEMPLE_RULES" :key="i" :class="{ warn: i === TEMPLE_RULES.length - 1 }">{{ r }}</li>
        </ol>
        <div class="rules-foot">
          敲木鱼的人卖时间与专注，烧香的人买仪式感与被看见，$GONGDE 只是计价单位。<br />
          当前为实验原型：无合约、无钱包、无服务端，规则全部写在这份开源前端里。
        </div>
      </div>
    </div>
  </Transition>
</template>
