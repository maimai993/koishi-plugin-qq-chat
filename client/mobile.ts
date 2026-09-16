/**
 * 手机端 App（PWA）入口。
 *
 * 服务端挂在 /qq-chat/m 上，界面与独立窗口完全一致（同一个 Chat 组件），
 * 区别只有数据层：send / receive 被别名到 mobile-data.ts，走 HTTP + SSE，
 * 所以手机浏览器可以直接用，也可以「添加到主屏幕」当 App 用。
 */
import { createApp, h, ref } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import Chat from './vue/index.vue'
import { CONSOLE_THEME_KEY } from './vue/composables/useTheme'
import { fetchInfo, login } from './mobile-data'
import './index.scss'
import './standalone.scss'
import './mobile.scss'

const stored = (() => {
  try {
    return localStorage.getItem(CONSOLE_THEME_KEY)
  } catch {
    return null
  }
})()
const prefersDark = !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', stored === 'dark' || stored === 'light' ? stored === 'dark' : prefersDark)

/** 登录页：没登录时不挂载聊天界面，先让用户输访问密码 */
const Login = {
  setup() {
    const password = ref('')
    const busy = ref(false)
    const error = ref('')
    const submit = async () => {
      if (busy.value) return
      busy.value = true
      error.value = ''
      const result = await login(password.value)
      busy.value = false
      if (!result.ok) {
        error.value = result.error || '登录失败'
        return
      }
      location.reload()
    }
    return () => h('div', { class: 'qq-mobile-login' }, [
      h('div', { class: 'qq-mobile-login-card' }, [
        h('div', { class: 'qq-mobile-login-logo' }, 'QQ'),
        h('h1', 'QQ 机器人手机端'),
        h('p', { class: 'qq-mobile-login-tip' }, '输入插件配置里的「手机端访问密码」即可登录'),
        h('input', {
          class: 'qq-mobile-login-input',
          type: 'password',
          placeholder: '访问密码',
          value: password.value,
          autocomplete: 'current-password',
          onInput: (e: any) => { password.value = e.target.value },
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') void submit() }
        }),
        error.value ? h('div', { class: 'qq-mobile-login-error' }, error.value) : null,
        h('button', {
          class: 'qq-mobile-login-btn',
          disabled: busy.value,
          onClick: () => void submit()
        }, busy.value ? '登录中…' : '登录')
      ])
    ])
  }
}

// 注册 Service Worker：「添加到主屏幕」后离线也能打开外壳，接口照常走网络
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/qq-chat/m/sw.js', { scope: '/qq-chat/m/' }).catch(() => undefined)
  })
}

async function bootstrap() {
  const info = await fetchInfo()
  if (info?.passwordRequired && !info?.authed) {
    createApp(Login).mount('#app')
    return
  }
  const app = createApp({ render: () => h(Chat as any, { standalone: true, mobileApp: true }) })
  app.use(ElementPlus as any)
  app.mount('#app')
}

void bootstrap()
