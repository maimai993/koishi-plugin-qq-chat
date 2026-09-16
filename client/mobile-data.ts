/**
 * 手机端数据层：把控制台的 websocket RPC（send / receive）换成 HTTP + SSE。
 *
 * 网页端（控制台 / 独立窗口）用 @koishijs/client 的 send / receive 走 websocket；
 * 手机 App 只需要 HTTP，所以这里实现一份同样签名的替代品，构建手机端页面时用
 * vite alias 把 '@koishijs/client' 指到这里 —— 整套聊天界面（vue 组件、chat-logic）
 * 一行不改就能跑在手机 App / PWA 上，功能与网页端完全一致。
 *
 *   send(type, ...args)      → POST /qq-chat/api/rpc（服务端转发给同名监听器）
 *   receive(type, callback)  → 订阅 /qq-chat/api/events（SSE 实时推送）
 */
import { reactive } from 'vue'

const TOKEN_KEY = 'qq-chat:mobile-token'

export const global: any = (typeof window !== 'undefined' && (window as any).KOISHI_CONFIG) || {}

export function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function writeToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* 忽略 */ }
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = readToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`/qq-chat/api/${path}`, { credentials: 'same-origin', ...init, headers: { ...apiHeaders(), ...(init.headers || {}) } })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const error: any = new Error(data?.error || `HTTP ${res.status}`)
    error.status = res.status
    error.body = data
    throw error
  }
  return data
}

/** 登录：用访问密码换令牌（服务端同时下发 cookie，聊天媒体才能显示） */
export async function login(password: string, name = '手机端'): Promise<{ ok: boolean, error?: string }> {
  try {
    const data = await apiFetch('login', { method: 'POST', body: JSON.stringify({ password, name }) })
    if (data?.token) writeToken(data.token)
    return { ok: !!data?.ok }
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error) }
  }
}

export async function fetchInfo(): Promise<any> {
  try {
    return await apiFetch('info')
  } catch {
    return { ok: false, authed: false }
  }
}

/** 与控制台 websocket 版 send 签名一致 */
export async function send(type: string, ...args: any[]): Promise<any> {
  const data = await apiFetch('rpc', { method: 'POST', body: JSON.stringify({ name: type, args }) })
  if (!data?.ok) throw new Error(data?.error || `接口 ${type} 调用失败`)
  return data.value
}

// ===== SSE 实时推送 =====

type Handler = (body: any) => void

const handlers = new Map<string, Set<Handler>>()
let source: EventSource | null = null
let reconnectTimer: any = null
let reconnectDelay = 1000

function ensureSource() {
  if (typeof window === 'undefined' || source) return
  const token = readToken()
  const url = `/qq-chat/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`
  try {
    source = new EventSource(url)
  } catch {
    source = null
    return
  }
  source.addEventListener('message', (event: MessageEvent) => {
    let payload: any = null
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    const list = handlers.get(payload?.type)
    if (!list) return
    for (const fn of [...list]) {
      try {
        fn(payload.body)
      } catch (error) {
        console.error('[qq-chat] SSE 回调异常：', error)
      }
    }
  })
  source.addEventListener('ready', () => {
    reconnectDelay = 1000
  })
  source.addEventListener('error', () => {
    // 断线自动重连（令牌失效时也保持重试，重新登录后即可恢复）
    try {
      source?.close()
    } catch { /* 忽略 */ }
    source = null
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (handlers.size) ensureSource()
    }, reconnectDelay)
    reconnectDelay = Math.min(15000, reconnectDelay * 2)
  })
}

/** 与控制台 websocket 版 receive 签名一致（返回取消订阅函数） */
export function receive(type: string, callback: Handler) {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(callback)
  ensureSource()
  return () => {
    handlers.get(type)?.delete(callback)
  }
}

/** 独立窗口里用不到的连接方法，占位保证接口兼容 */
export async function connect() { /* 手机端走 HTTP，无需 websocket */ }

/** 极简 store：手机端不依赖控制台登录态 */
export const store = reactive<any>({ user: null, status: 'mobile' })
