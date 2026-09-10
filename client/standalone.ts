/**
 * 独立聊天窗口入口。
 *
 * 只渲染单个频道的聊天界面（不加载控制台外壳），由服务端挂载在
 * /qq-chat/window?bot=<selfId>&channel=<channelId> 上，可以单独开窗口 / 挂在别的网页里。
 */
import { createApp, h } from 'vue'
import { connect, global } from '@koishijs/client'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import Chat from './vue/index.vue'
import { restoreConsoleLogin, setupAuthBridge } from './auth'
import { CONSOLE_THEME_KEY } from './vue/composables/useTheme'
import './index.scss'
import './standalone.scss'

// 首屏先按「控制台记录的主题 → 系统」快速上色，避免闪白；
// 之后由 useChatTheme 按插件设置（跟随 Koishi / 系统 / 黑色 / 白色）接管。
const stored = (() => {
  try {
    return localStorage.getItem(CONSOLE_THEME_KEY)
  } catch {
    return null
  }
})()
const prefersDark = !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', stored === 'dark' || stored === 'light' ? stored === 'dark' : prefersDark)

const app = createApp({ render: () => h(Chat as any, { standalone: true }) })
app.use(ElementPlus as any)

// 与控制台后端建立同一条 WebSocket 通道（send / receive 都依赖它）
const endpoint = new URL((global as any)?.endpoint || '/status', location.origin).toString()
connect({ emit: () => {} } as any, () => new WebSocket(endpoint.replace(/^http/, 'ws')))
  .catch((error: any) => console.error('[qq-chat] 独立窗口连接失败：', error))
  .then(() => {
    // 开了 auth 插件时：用镜像下来的登录凭证做一次 websocket 登录
    setupAuthBridge()
    return restoreConsoleLogin().then((ok) => {
      if (!ok) console.warn('[qq-chat] 未登录：窗口内的收发 / 群管理接口需要先登录 Koishi 控制台')
    })
  })
  .finally(() => app.mount('#app'))
