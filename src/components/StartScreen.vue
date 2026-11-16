<script setup>
import { assemblyText } from '../temple/dharma.js'

defineProps({
  merit: { type: Number, default: 0 },
  bestCombo: { type: Number, default: 0 },
  online: { type: Number, default: 0 },
  live: { type: Boolean, default: false },
  streak: { type: Object, default: () => ({ days: 0, best: 0 }) },
  assembly: { type: Object, default: () => ({ active: false }) },
  verse: { type: String, default: '' },
  /** 别人发来的战帖：有它就把首屏让给这一次对决，别让人先读三条玩法说明 */
  duel: { type: Object, default: null }
})
const emit = defineEmits(['enter', 'reset', 'share', 'duel', 'dismiss-duel'])

const pct = (n) => `${Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 100)}%`
</script>

<template>
  <Transition name="fade">
    <div class="start-screen">
      <div class="start-inner">
        <div class="start-kicker">// NEON SANCTUARY · COMMUNAL PRACTICE</div>
        <h1 class="start-title">赛博禅寺</h1>
        <div class="start-title-en">CYBER TEMPLE / $GONGDE</div>

        <p class="start-lede">
          敲一炷香，替别人诵一段经。<br />
          敲的人赚功德，许愿的人买「被看见」。
        </p>

        <!-- 收到战帖：这是首屏唯一该讲的事。玩法说明让位，别把应战按钮挤出第一屏 -->
        <div v-if="duel" class="start-duel">
          <div class="duel-head">
            <span class="duel-tag">战 帖</span>
            <span class="duel-from">{{ duel.name || '一位同修' }}</span>
          </div>
          <div class="duel-main">
            在第 <b>{{ duel.seal.round }}</b> 炷敲出
            <b class="duel-pct">{{ pct(duel.seal.accuracy) }}</b>
            合拍率 · 功德 {{ duel.seal.reward }} $G
          </div>
          <div v-if="duel.note" class="duel-note">「{{ duel.note }}」</div>
          <div class="duel-sub">
            回执里的第几炷与当日种子都是死的 —— 点开就是同一张六十四拍，成绩当场能复算
          </div>
          <div class="duel-actions">
            <button class="duel-go clickable" @click="emit('duel')">应 战</button>
            <button class="duel-skip clickable" @click="emit('dismiss-duel')">先逛逛</button>
          </div>
        </div>

        <div v-else class="start-steps">
          <div class="start-step">
            <b>01</b>
            <h3>跟着节拍声敲</h3>
            <p>六十四拍分八句，跟着「咚」落拍才记功德。乱敲不计，挂机刷不出来。</p>
          </div>
          <div class="start-step">
            <b>02</b>
            <h3>把愿挂上万佛墙</h3>
            <p>悬赏一出，寺里其他同修会来替你诵。人越多，诵满得越快。</p>
          </div>
          <div class="start-step">
            <b>03</b>
            <h3>拿走一张禅印</h3>
            <p>一炷香一张可复算的回执：别人能验，能整张转手，换设备也搬得走。</p>
          </div>
        </div>

        <div class="start-live" :class="{ on: live }">
          <span class="live-dot"></span>
          {{ live
            ? `此刻 ${online} 位同修在寺里 · 万佛墙上的愿是真的`
            : '正在接上公共公告板 · 连不上也能独修' }}
        </div>

        <!-- 每天变的两行字：法会几点开、今天这一偈。老玩家一眼就知道要不要留下 -->
        <div class="start-today">
          <span class="today-asm" :class="{ on: assembly.active }">{{ assemblyText(assembly) }}</span>
          <span class="today-verse">今日一偈 · {{ verse }}</span>
        </div>

        <div v-if="!duel" class="start-actions">
          <button class="btn-main" @click="emit('enter')">进 入 山 门</button>
        </div>

        <div class="start-guide">
          <div class="guide-item"><span class="guide-key">TAP / SPACE</span><span class="guide-text">落拍敲木鱼</span></div>
          <div class="guide-item"><span class="guide-key">1 - 4</span><span class="guide-text">四法器修行</span></div>
          <div class="guide-item"><span class="guide-key">摇杆 / WASD</span><span class="guide-text">场景内走动</span></div>
          <div class="guide-item"><span class="guide-key">禅印</span><span class="guide-text">验签与功德票</span></div>
        </div>

        <div class="start-foot">
          <div class="start-foot-note">无账号、无服务器、无钱包 · 规则全在这份开源前端里，谁都能复核</div>
          <div class="start-foot-stats">
            <template v-if="merit > 0">
              你的功德 {{ merit }} $G · 最高连击 {{ bestCombo }}<template v-if="streak.days > 1"> · 连修 {{ streak.days }} 日</template> ·
            </template>
            <button class="start-reset clickable" @click="emit('share')">分享给同修</button>
            <button class="start-reset clickable" @click="emit('reset')">清空本机账本</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
