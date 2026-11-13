import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

createApp(App).mount('#app')

// 仅生产注册：dev 下缓存会把 HMR 的模块更新挡住，看起来像「改了没生效」
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 隐私模式 / 不支持 SW 时不影响游戏本身
    })
  })
}
