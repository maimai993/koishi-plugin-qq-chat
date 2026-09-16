/* 手机端 App 的 Service Worker：缓存外壳资源，接口请求永不缓存 */
const CACHE = 'qq-chat-mobile-v1'
const SHELL = [
  '/qq-chat/m',
  '/qq-chat/m/mobile.js',
  '/qq-chat/m/mobile.css',
  '/qq-chat/m/manifest.webmanifest',
  '/qq-chat/m/icon-192.png',
  '/qq-chat/m/icon-512.png',
  '/qq-chat/m/icon.svg'
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // 接口 / 实时推送 / 媒体一律走网络（媒体本身由服务端缓存）
  if (url.pathname.startsWith('/qq-chat/api/') || url.pathname.startsWith('/qq-chat/media/')) return
  if (event.request.method !== 'GET') return
  if (url.origin !== location.origin) return
  if (!url.pathname.startsWith('/qq-chat/m')) return
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => undefined)
        }
        return response
      })
      .catch(() => caches.match(event.request).then((hit) => hit || Response.error()))
  )
})
