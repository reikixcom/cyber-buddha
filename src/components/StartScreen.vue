<script setup>
defineProps({
  merit: { type: Number, default: 0 },
  bestCombo: { type: Number, default: 0 },
  online: { type: Number, default: 0 },
  live: { type: Boolean, default: false }
})
const emit = defineEmits(['enter', 'reset', 'share'])
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

        <div class="start-steps">
          <div class="start-step">
            <b>01</b>
            <h3>跟着光点敲</h3>
            <p>六十四拍分八句，合拍才记功德。乱敲不计，挂机刷不出来。</p>
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

        <div class="start-actions">
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
            <template v-if="merit > 0">你的功德 {{ merit }} $G · 最高连击 {{ bestCombo }} · </template>
            <button class="start-reset clickable" @click="emit('share')">分享给同修</button>
            <button class="start-reset clickable" @click="emit('reset')">清空本机账本</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
