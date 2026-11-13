/**
 * 赛博禅寺 · 离线缓存
 *
 * 项目全部逻辑都在这份静态前端里，没有服务端、没有账号、没有链，
 * 所以「添加到主屏」之后断网也应该照样能敲木鱼。
 *
 * 策略：
 *  - 安装时预缓存页面壳 + 当前 index.html 引用的 JS/CSS。首访时 SW 还
 *    没接管页面，资源请求不会经过它，不主动拉一次就会「在线能开、断网白屏」。
 *  - /assets/* 是 Vite 带内容哈希的文件 → cache-first，命中即不发请求
 *  - 页面、manifest、图标 → network-first，失败回落缓存；离线时用缓存的 index.html
 *  - 只缓存同源 GET，跨域请求一律交给浏览器默认处理
 */
/** 公开信标是跨域请求，不进离线缓存；断网时前端会明确降级为本机种子 */
const CACHE = 'cyber-temple-v3'
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/icon.svg', '/icon-192.png', '/icon-512.png'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE)
      await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))
      // 把这份构建真正引用的资源也拉进来；正则只看同源 /assets/ 路径
      try {
        const html = await fetch('/index.html').then((r) => r.text())
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
        await Promise.all(assets.map((u) => c.add(u).catch(() => {})))
      } catch { /* 离线安装时跳过，下次在线访问会补上 */ }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  const remember = (res) => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
    }
    return res
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then(remember))
    )
    return
  }

  event.respondWith(
    fetch(req)
      .then(remember)
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
  )
})
