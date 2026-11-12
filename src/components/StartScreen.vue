<script setup>
defineProps({
  merit: { type: Number, default: 0 },
  bestCombo: { type: Number, default: 0 }
})
const emit = defineEmits(['enter', 'reset'])
</script>

<template>
  <Transition name="fade">
    <div class="start-screen">
      <div class="start-inner">
        <div class="start-kicker">// NEON SANCTUARY · COMMUNAL PRACTICE</div>
        <h1 class="start-title">赛博禅寺</h1>
        <div class="start-title-en">CYBER TEMPLE / $GONGDE</div>
        <div class="start-divider"></div>
        <p class="start-desc">
          <em>敲木鱼就是出块。</em>全网共修一炷香，六十四拍分八句，跟着光点落拍 —— 合拍才有权重，乱敲不计。<br />
          一个心愿可以很多人一起诵，没有抢单：悬赏按各人击数分，人越多送达越快。<br />
          万佛墙上永远有一座常住共修愿，没人挂单也有愿可敲、有人同诵。<br />
          四法器与共修共用每日香火额度，重复修行收益递减 —— 挂机刷不出佛果。<br />
          烧香的人买的是别人的时间与专注，敲木鱼的人卖的也是。
        </p>

        <div class="start-actions">
          <button class="btn-main" @click="emit('enter')">进 入 山 门</button>
          <button class="btn-ghost" @click="emit('reset')">清空功德账本</button>
        </div>

        <div class="start-guide">
          <div class="guide-item"><span class="guide-key">TAP / SPACE</span><span class="guide-text">落拍敲木鱼</span></div>
          <div class="guide-item"><span class="guide-key">1 - 4</span><span class="guide-text">四法器修行</span></div>
          <div class="guide-item"><span class="guide-key">寺规</span><span class="guide-text">看全部规则</span></div>
          <div class="guide-item"><span class="guide-key">摇杆 / WASD</span><span class="guide-text">场景内走动</span></div>
        </div>

        <div class="start-foot">
          当前 $GONGDE {{ merit }} · 最高连击 {{ bestCombo }}<br />
          实验原型：数值全部本地模拟，未上链、无钱包、不承诺收益
        </div>
      </div>
    </div>
  </Transition>
</template>
