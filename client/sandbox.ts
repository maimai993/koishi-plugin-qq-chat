/**
 * 沙盒窗口入口。
 *
 * 和独立聊天窗口（/qq-chat/window）共用同一个 Chat 组件，所以界面完全一样：
 * 发送图片 / 语音 / 视频、渲染图片 / 语音 / 视频、右键菜单、@、表情等全都在。
 *
 * 区别只有一点：在这里发的消息不会直接发到 QQ，而是推进沙盒虚拟会话走一遍
 * Koishi 完整中间件（指令、插件都会响应），机器人回复被拦截后当成普通聊天消息
 * 画出来；点那条回复下的「发送到当前频道」或「编辑发送」才真的发到 QQ，
 * 而且发出去的是原始元素（图片 / 语音 / 视频不会被压成纯文本）。
 *
 * 由服务端挂载在 /qq-chat/sandbox?bot=<selfId>&channel=<channelId> 上。
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

const app = createApp({ render: () => h(Chat as any, { standalone: true, sandbox: true }) })
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
