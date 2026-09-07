
import { defineComponent, h, resolveComponent } from 'vue'
import { Context } from '@koishijs/client'
import Chat from './vue/index.vue'
// 不导入 Element Plus CSS，Koishi 已经包含了
// import 'element-plus/dist/index.css'
import './index.scss'
import './icons'

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
