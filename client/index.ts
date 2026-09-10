
import { defineComponent, h, resolveComponent } from 'vue'
import { Context } from '@koishijs/client'
import Chat from './vue/index.vue'
import { setupAuthBridge } from './auth'
// 不导入 Element Plus CSS，Koishi 已经包含了
// import 'element-plus/dist/index.css'
import './index.scss'
import './icons'

// 把当前登录令牌镜像到 cookie / localStorage：开了 auth 插件之后，
// 独立窗口与聊天媒体（普通 HTTP 请求）要靠它通过服务端校验
setupAuthBridge()

export default (ctx: Context) => {
  ctx.page({
    name: '夺舍官BOT',
    path: '/qq-chat',
    desc: "",
    authority: 4,
    icon: 'activity:chat',
    component: defineComponent({
      setup() {
        return () => h(resolveComponent('k-layout'), {}, {
          default: () => h(Chat)
        })
      },
    }),
  })
}
