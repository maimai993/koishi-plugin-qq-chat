/**
 * 控制台登录态桥接。
 *
 * Koishi 的 auth 插件是「websocket 级」鉴权：登录令牌只会发给已建立连接的客户端，
 * 而独立窗口 / 沙盒窗口、聊天媒体走的是普通 HTTP，拿不到这个令牌。于是这里把令牌
 * 同时镜像到 cookie 与 localStorage：
 *
 *  - cookie `qq-chat-auth`：服务端校验普通 HTTP 请求（窗口页面、聊天媒体、图片代理、背景图）
 *  - localStorage `qq-chat:auth`：独立窗口自己重连时用它调 `login/token` 完成 websocket 登录
 *
 * 没启用 auth 插件时 `store.user` 一直是 null，这里什么都不做，行为与以前一致。
 */
import { watch } from 'vue'
import { send, store } from '@koishijs/client'

export const AUTH_STORAGE_KEY = 'qq-chat:auth'
export const AUTH_COOKIE_NAME = 'qq-chat-auth'

export interface AuthCredential {
  id: number
  token: string
}

function readCookie(name: string): string {
  try {
    for (const part of String(document.cookie || '').split(';')) {
      const idx = part.indexOf('=')
      if (idx < 0) continue
      if (part.slice(0, idx).trim() !== name) continue
      return decodeURIComponent(part.slice(idx + 1).trim())
    }
  } catch { /* 忽略 */ }
  return ''
}

function writeCookie(value: string, maxAge?: number) {
  try {
    document.cookie = maxAge === undefined
      ? `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}; path=/; SameSite=Lax`
      : `${AUTH_COOKIE_NAME}=; path=/; Max-Age=0; SameSite=Lax`
  } catch { /* 忽略 */ }
}

function parseCredential(raw: string): AuthCredential | null {
  if (!raw) return null
  const idx = raw.indexOf(':')
  if (idx <= 0) return null
  const id = Number(raw.slice(0, idx))
  const token = raw.slice(idx + 1)
  if (!Number.isFinite(id) || !token) return null
  return { id, token }
}

/** 读取当前可用的登录凭证（先看 localStorage，再看 cookie） */
export function readCredential(): AuthCredential | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Number.isFinite(parsed.id) && parsed.token) return parsed
    }
  } catch { /* 忽略 */ }
  return parseCredential(readCookie(AUTH_COOKIE_NAME))
}

/** 登录成功后把凭证写进 cookie + localStorage */
export function persistCredential(user: any) {
  if (!user || !Number.isFinite(Number(user.id)) || !user.token) return
  const id = Number(user.id)
  const token = String(user.token)
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ id, token }))
  } catch { /* 忽略 */ }
  writeCookie(`${id}:${token}`)
}

/** 退出登录 / 令牌失效：清掉两份凭证 */
export function clearCredential() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch { /* 忽略 */ }
  writeCookie('', 0)
}

/**
 * 监听控制台推送的登录信息（auth 插件用 `data user` 下发），
 * 有则镜像凭证，无则清空。控制台页面 / 独立窗口都可以调用。
 */
export function setupAuthBridge() {
  watch(() => (store as any).user, (user) => {
    if (user && user.token) {
      persistCredential(user)
    } else if (user === null) {
      // 只有明确收到「未登录 / 已退出」才清空：
      // 页面刚加载时 store.user 还是 undefined（服务端数据没推到），
      // 这时清空会把刚镜像好的 cookie 擦掉，导致窗口永远登不上
      clearCredential()
    }
  }, { immediate: true })
}

/**
 * 独立窗口 / 沙盒窗口：用镜像下来的凭证做一次 websocket 登录。
 * 这样开启 auth 插件后，窗口里的收发消息、群管理等功能才能正常用。
 */
export async function restoreConsoleLogin(): Promise<boolean> {
  const credential = readCredential()
  if (!credential) return false
  try {
    await (send as any)('login/token', credential.id, credential.token)
    return true
  } catch {
    return false
  }
}
