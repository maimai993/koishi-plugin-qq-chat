import { onBeforeUnmount, onMounted, watch } from 'vue'

/** 控制台主题记录：控制台页面写入，独立窗口读取（同源 localStorage） */
export const CONSOLE_THEME_KEY = 'qq-chat:console-theme'

export type ChatThemeMode = 'koishi' | 'system' | 'dark' | 'light'

const readStoredTheme = (): 'dark' | 'light' | null => {
  try {
    const value = localStorage.getItem(CONSOLE_THEME_KEY)
    return value === 'dark' || value === 'light' ? value : null
  } catch {
    return null
  }
}

const systemPrefersDark = () => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches

/**
 * 聊天界面主题：
 * - koishi：控制台页面不覆盖样式（跟随控制台），只把当前深浅色记到 localStorage；
 *           独立窗口读这份记录，并监听 storage 事件实时跟随
 * - system：跟随系统深浅色
 * - dark / light：强制黑色 / 白色
 * 非 koishi 模式会临时覆盖 html.dark，组件卸载时还原控制台原本的样式。
 */
export function useChatTheme(getMode: () => ChatThemeMode | undefined, standalone = false) {
  const root = () => document.documentElement
  let originalDark: boolean | null = null
  let media: MediaQueryList | null = null
  let observer: MutationObserver | null = null

  const isForced = () => {
    const mode = getMode()
    return mode === 'dark' || mode === 'light' || mode === 'system'
  }

  const resolve = (): boolean => {
    const mode = getMode()
    if (mode === 'dark') return true
    if (mode === 'light') return false
    if (mode === 'system') return systemPrefersDark()
    if (!standalone) return root().classList.contains('dark')
    return (readStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light')) === 'dark'
  }

  // 把控制台当前的深浅色记下来，独立窗口才能「跟随 Koishi」
  const recordConsoleTheme = () => {
    if (standalone || isForced()) return
    try {
      localStorage.setItem(CONSOLE_THEME_KEY, root().classList.contains('dark') ? 'dark' : 'light')
    } catch { /* 忽略写入失败 */ }
  }

  const apply = () => {
    if (isForced()) {
      if (originalDark === null) originalDark = root().classList.contains('dark')
      root().classList.toggle('dark', resolve())
      return
    }
    // koishi 模式：还原被覆盖过的样式，控制台页面交还给控制台
    if (originalDark !== null) {
      root().classList.toggle('dark', originalDark)
      originalDark = null
    }
    if (standalone) root().classList.toggle('dark', resolve())
    else recordConsoleTheme()
  }

  onMounted(() => {
    recordConsoleTheme()
    apply()
    // 控制台切主题时同步记录（koishi 模式只观察，不覆盖）
    observer = new MutationObserver(() => recordConsoleTheme())
    observer.observe(root(), { attributes: true, attributeFilter: ['class'] })
    media = window.matchMedia?.('(prefers-color-scheme: dark)') || null
    media?.addEventListener?.('change', apply)
    window.addEventListener('storage', apply)
  })

  // 插件配置是异步下发的，配置到位后重新应用
  watch(() => getMode(), apply)

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    media?.removeEventListener?.('change', apply)
    window.removeEventListener('storage', apply)
    if (originalDark !== null) {
      root().classList.toggle('dark', originalDark)
      originalDark = null
    }
  })
}
