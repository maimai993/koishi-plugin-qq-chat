# koishi-plugin-qq-chat

![](https://socialify.git.ci/maimai993/koishi-plugin-qq-chat/image?custom_description=%E5%A4%BA%E8%88%8D+QQ+%E5%AE%98%E6%96%B9%E6%9C%BA%E5%99%A8%E4%BA%BA%EF%BC%9A%E5%9C%A8+Koishi+%E6%8E%A7%E5%88%B6%E5%8F%B0%E7%9B%B4%E6%8E%A5%E6%8E%A5%E7%AE%A1%E5%AE%98%E6%96%B9+QQ+%E6%9C%BA%E5%99%A8%E4%BA%BA%E7%9A%84%E7%BE%A4%E8%81%8A&description=1&font=Jost&forks=1&issues=1&language=1&logo=https%3A%2F%2Fforum.koishi.xyz%2Fuploads%2Fdefault%2Foriginal%2F1X%2F72b32c99d52e391ce7dfc08d7fff86bd50ae1d03.png&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)

[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-chat?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-qq-chat)   [![npm downloads](https://img.shields.io/npm/dm/koishi-plugin-qq-chat)](https://www.npmjs.com/package/koishi-plugin-qq-chat)  [![](https://img.shields.io/badge/QQ%E7%BE%A4-1050229473-12B7F5?style=flat-square&logo=qq&logoColor=white)](https://qm.qq.com/q/FUY2sWwNyy)

> **夺舍 QQ 官方机器人**：在 Koishi 控制台直接接管官方 QQ 机器人的群聊 —— 收发消息、群管理、指令沙盒一应俱全。

本插件把官方 QQ 机器人变成"能用鼠标操作"的聊天软件：控制台内就是一套接近真机 QQ 的聊天界面，图片 / 语音 / 视频 / 文件收发、群成员管理、Markdown 面板、指令桥接、独立窗口与沙盒模式全部内置；手机浏览器打开独立窗口还能用**左滑引用 / 右滑返回**的真机手势，未读消息会**持久化保存**，打开群聊自动停在未读区域。

## 📸 界面演示

### 控制台主界面

![控制台主界面](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/01-console-chat.jpg)

气泡、头像、群角色徽章、时间、未读提醒全部对齐真机 QQ；左侧是机器人与频道列表，右侧是群成员面板。

### 频道列表：每个频道都带最后一条消息预览

![频道列表预览](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/19-channel-previews.jpg)

打开控制台就会**一次性补齐所有频道的最后一条消息 + 时间**（不用点进去），未读角标同样直接显示。

### 未读消息与「回到未读区域」

![未读消息与回到未读区域](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/20-unread-jump.jpg)

未读数**持久化在服务端**（刷新页面、重启 Koishi 都不会丢）。打开群聊时自动停在**第一条未读消息**处并画出「以下为新消息」分割线；未读区域不在视野里时，右下角浮出「**N 条新消息 ↓**」胶囊，点一下跳回未读区域。

### 电脑端：Windows 式框选

![框选选择框](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/21-marquee-select.jpg)

按住左键拖出一个虚线选择框，和框相交的消息全部选中，接着就能批量转发 / 复制 / 删除。

### 消息与频道右键菜单

| 消息右键菜单 | 频道右键菜单 |
| --- | --- |
| ![消息右键菜单](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/03-message-menu.jpg) | ![频道右键菜单](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/02-channel-menu.jpg) |

复制 / 查看原始报文 / 转发 / 收藏 / 多选 / 引用 / **+1 复读** / @TA / 查看资料 / 查看 OpenID / 撤回 / 删除；频道菜单里可以直接**打开独立聊天窗口**、**在沙盒窗口中打开**、**用沙盒模式打开主界面**。把频道卡片**拖到浏览器窗口外松手**，也会直接在新窗口打开这个频道。

### 手机端手势

| 左滑引用（气泡跟手 + 「引用」） | 右滑返回（整页跟手 + 若隐若现的会话列表） |
| --- | --- |
| ![左滑引用](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/22-mobile-swipe-quote.jpg) | ![右滑返回](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/23-mobile-swipe-back.jpg) |

左滑消息 = 引用（气泡跟着手指滑动，右侧露出「引用」）；右滑 = 返回会话列表（整页跟着手指滑动，后面若隐若现地露出会话列表，够远顺势滑出、不够远弹回原位）；聊天页左上角是返回箭头。

### 手机端频道列表

![手机端频道列表](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/24-mobile-channel-list.jpg)

### 群成员 / 黑名单面板

![群成员面板](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/04-members-panel.jpg)

成员列表、角色徽章、批量移除、黑名单维护，成员右键即可私聊 / @TA / 禁言。

### QQ 表情 与 Markdown 面板

| QQ 表情（经典 / 大表情） | Markdown 面板 |
| --- | --- |
| ![QQ 表情面板](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/05-emoji-panel.jpg) | ![Markdown 面板](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/06-md-panel.jpg) |

表情素材直接用公网 QFace 资源（`koishi.js.org/QFace`），无需本地素材目录；点一下就以动图 apng 的形式发到 QQ。Markdown 面板支持原生按钮、指令交互按钮（`/指令`、回车发送、引用），面板里拖入 / 粘贴的图片会走 `assets` 服务上传。

### @ 成员 / 收藏 / 多选

| @ 成员面板 | 收藏 | 多选操作 |
| --- | --- | --- |
| ![@ 成员面板](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/07-mention-panel.jpg) | ![收藏](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/08-favorites.jpg) | ![多选](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/09-multi-select.jpg) |

### 群聊天设置

![群聊天设置](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/10-channel-settings.jpg)

群备注、置顶、消息免打扰、清空本地聊天记录。

### 沙盒窗口（独立悬浮窗）

![沙盒窗口](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/11-sandbox-window.jpg)

`/qq-chat/sandbox?bot=<机器人>&channel=<频道>` 是**和主界面完全一样**的独立窗口：侧边栏、工具栏、右键菜单、群成员面板一个不少。区别只有一点 —— **消息只在本机跑一遍 Koishi 完整中间件，不会发到 QQ**。

### 沙盒里发送与渲染图片 / 文件 / 语音 / 视频

![沙盒媒体渲染](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/12-sandbox-media.jpg)

图片直接渲染、文件是下载卡片、语音是可点击播放的语音条、视频是可播放的 `<video>`。

### 沙盒回复：发送到当前频道 / 编辑发送

![沙盒回复](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/13-sandbox-reply.jpg)

机器人的回复被拦截后当成普通聊天消息画出来（带「沙盒」标记），点「**发送到当前频道**」按原始元素发到 QQ，点「**编辑发送**」可以先改文字、删掉不要的元素再发（图片 / 语音 / 视频不会被压成文本）。

### 编辑发送弹窗

![编辑发送](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/14-element-editor.jpg)

### 图片查看器

![图片查看器](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/15-image-viewer.jpg)

### 主界面沙盒模式

![主界面沙盒模式](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/16-sandbox-mode-console.jpg)

不想开新窗口时，用 `/qq-chat?sandbox=1&bot=..&channel=..`（或频道右键「用沙盒模式打开主界面」）即可让**控制台主页本身**进入沙盒语义：顶部有沙盒横幅，随时点「退出沙盒」。

### 独立聊天窗口

![独立聊天窗口](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/17-standalone-window.jpg)

`/qq-chat/window?bot=<机器人>&channel=<频道>` 只渲染单个频道，可以单独开窗、拖到副屏，或直接 iframe 嵌到别的网页里。

### 手机端 App（PWA）

| 登录页 | 频道列表 | 手机端聊天 |
| --- | --- | --- |
| ![手机端登录](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/25-mobile-app-login.jpg) | ![手机端频道列表](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/26-mobile-channel-list.jpg) | ![手机端 App](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/26-mobile-app.jpg) |

手机浏览器打开 `http://<你的服务器>:5140/qq-chat/m`，输入访问密码就能用；Safari / Chrome 里「**添加到主屏幕**」后会像原生 App 一样全屏运行（PWA：manifest + Service Worker + 图标）。界面和独立窗口完全一致（左滑引用 / 右滑返回 / 未读持久化 / 频道预览全都在），只是数据层换成了 HTTP + SSE，所以手机不依赖控制台登录态。

### 指令桥接（执行指令）

![指令桥接](https://github.com/maimai993/koishi-plugin-qq-chat/raw/main/screenshots/18-command-bridge.jpg)

输入框里写 `/指令`，点工具栏的「执行指令」，插件会在 Koishi 本地执行它、拦截全部输出（含图片 / 语音 / 视频元素），放进可编辑弹窗，改完再发到 QQ —— 不走适配器、不会因为 QQ 侧的指令面板限制而失败。

## ✨ 功能特性

### 💬 聊天界面

- 控制台内直接查看机器人聊天记录，多机器人 / 多频道切换，频道搜索与置顶
- 接近真机 QQ 的界面：气泡、头像、群主 / 管理员徽章、时间分隔、消息分组、未读角标、"有人@你"提醒
- **频道列表默认显示每个频道的最后一条消息预览**（时间 + 发送者 + 内容，不用点进去）
- **未读消息持久化**：已读水位与未读数存在服务端，刷新页面 / 重启 Koishi 后未读角标仍在
- **打开群聊自动停在未读区域**，画出「以下为新消息」分割线；未读区域不在视野里时右下角出现「N 条新消息」箭头，点一下跳回
- 频道备注、消息免打扰、置顶、从列表移除（本地）
- 合并转发卡片、B 站小程序卡片、网易云音乐卡片解析与播放
- 引用消息展示（自动补全引用者昵称）、@ 成员胶囊、QQ 表情与"不支持的第三方表情"提示
- 私聊频道名自动使用**对方昵称**（不再显示「私聊（未知用户）」）
- 手机端适配：左滑引用 / 右滑返回的跟手动画、输入框避让、容器高度可配
- 交互动画统一加固：页面切换、列表项、右键菜单、悬浮按钮、未读分割线、对话框内容都带过渡，并跟随系统「减少动态效果」

### 📤 消息收发

- 接收：文本、图片、语音、视频、文件、Markdown、卡片、合并转发、系统提示（入群 / 退群 / 入群申请）
- 发送：文字、图片、文件、语音、视频、QQ 表情（经典 / 大表情 apng）、Markdown（原生 / 按钮交互）、截图（框选屏幕）
- 引用回复、@ 成员、**+1 复读**、多选批量转发、转发到其他频道、收藏（本地）
- **发送失败一定会标出来**：适配器报错、QQ 接口报错、返回空数组、没返回消息 ID 这几种情况都会把对应消息标成「发送失败」并带上原因（覆盖 `sendMessage`、`bot.internal.*`、`bot.http.post` 三条出口）
- 撤回消息、群成员禁言 / 解除禁言、入群申请处理

### 🗂️ 媒体处理

- 图片 / 语音 / 视频 / 文件 / 头像自动下载并持久化到 `data/qq-chat`
- 浏览器端 IndexedDB 图片缓存 + 视频按需加载（点击才下载）
- 远程图片走本地代理 `/qq-chat/fetch-image`（QQ CDN 带鉴权，直接引用显示不出来；卡片封面、QQ 表情同样走代理）
- 配合 `koishi-plugin-silk` / 系统 ffmpeg 自动完成语音格式转换，QQ 语音在浏览器里直接播放

### 🧪 沙盒与指令桥接

- **沙盒窗口**：`/qq-chat/sandbox`，独立悬浮窗，完整主界面，消息只在本机执行
- **主界面沙盒模式**：`/qq-chat?sandbox=1`，控制台主页直接进入沙盒语义
- **指令桥接**：控制台里发 `/指令` 由 Koishi 本地执行，拦截输出 → 可编辑 → 再发 QQ
- 沙盒回复支持「发送到当前频道 / 编辑发送（按原始元素）/ 以 MD 发送（QQ 原生 markdown）」，图片 / 语音 / 视频不会被压成文本
- 沙盒发送键的下拉里可以「以 Markdown 格式发送到当前频道」，插件产出的原生 markdown（自带按钮 / 链接）不会丢格式
- 沙盒产生的消息**不会**写进真实聊天记录，也不会真的发到 QQ

### 📱 手机端 App 与开放 API

- **手机端 App（PWA）**：`/qq-chat/m`，支持「添加到主屏幕」，全屏运行、断线自愈（Service Worker 缓存外壳，接口永不缓存）
- **访问密码**：配置 `mobilePassword` 后，手机端页面与所有 `/qq-chat/api/*` 都要求先用密码换令牌（令牌写在 `data/qq-chat/v2/mobile-tokens.json`，可随时失效）
- **手机 API**（REST + SSE），可以直接给第三方客户端 / 自研 App 用：

  | 接口 | 说明 |
  | --- | --- |
  | `POST /qq-chat/api/login` | `{ password, name }` → `{ token }`（同时下发 cookie，聊天媒体才能显示） |
  | `GET  /qq-chat/api/info` | 插件版本、是否需要密码、当前是否已登录 |
  | `GET  /qq-chat/api/me` | 机器人 / 频道列表 + 每个频道最后一条消息预览 + 未读状态 + 消息条数 |
  | `GET  /qq-chat/api/channels` | 只要频道列表与预览 |
  | `GET  /qq-chat/api/messages?selfId=&channelId=&limit=&offset=` | 拉历史消息（从新到旧分页） |
  | `POST /qq-chat/api/send` | `{ selfId, channelId, content, images?, files? }` 发消息（真的发到 QQ） |
  | `POST /qq-chat/api/read` | `{ selfId, channelId }` 标记已读 |
  | `POST /qq-chat/api/rpc` | `{ name, args }` 通用桥：调用控制台里注册的任意接口（群管理、表情、Markdown、指令桥接…功能与网页端完全对齐） |
  | `GET  /qq-chat/api/events` | SSE 实时推送：新消息、发送成功 / 失败、未读变化、群状态变化 |

- **鉴权**：`Authorization: Bearer <token>`（手机 App / 第三方客户端）或控制台登录 cookie（同一个浏览器登录过控制台即可直接用）
- **跨域**：`/qq-chat/api/*` 带 CORS 头，原生 App / 网页应用可以直接调

```bash
# 换令牌
curl -X POST http://127.0.0.1:5140/qq-chat/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"你的访问密码","name":"我的手机"}'

# 拉频道列表
curl http://127.0.0.1:5140/qq-chat/api/me -H "Authorization: Bearer <token>"

# 发消息
curl -X POST http://127.0.0.1:5140/qq-chat/api/send \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"selfId":"<机器人>","channelId":"<频道>","content":"来自 API 的问候"}'

# 实时推送（新消息 / 发送状态）
curl -N "http://127.0.0.1:5140/qq-chat/api/events?token=<token>"
```

### 🛠️ 群管理

- 群成员 / 黑名单面板，成员角色与禁言状态
- 禁言 / 解除禁言、批量移除成员、黑名单增删
- 入群申请一键同意 / 拒绝
- 机器人被移出群聊、群全员禁言、无主动推送权限等状态提示

### 🎨 外观与持久化

- 主题：跟随 Koishi 控制台 / 跟随系统 / 深色 / 浅色（独立窗口同样生效）
- 聊天区自定义背景图（本地路径或 http(s) 链接）+ 模糊度、遮罩浓度
- 聊天记录分块持久化（`data/qq-chat/v2/chat-history`），可配置每群上限、分块大小、内存缓存数量，超限自动清理
- 未读状态持久化（`data/qq-chat/v2/read-state.json`）

## 📦 安装

在 Koishi 控制台的插件市场搜索 `qq-chat` 安装，推荐配合 `adapter-qq-crack` 适配器使用。

**可选依赖**

| 插件 | 说明 |
| --- | --- |
| [koishi-plugin-adapter-qq-crack](https://www.npmjs.com/package/koishi-plugin-adapter-qq-crack) | 推荐：本插件针对该 QQ 适配器做了深度适配，缺少它时群聊相关能力不可用 |
| [koishi-plugin-assets-qqbot-part-file](https://www.npmjs.com/package/koishi-plugin-assets-qqbot-part-file) | 提供 `assets` 服务。启用后 Markdown 面板里拖入 / 粘贴的图片、QQ 表情才能上传到 QQ 并拿到公网地址 |
| koishi-plugin-silk + 系统 ffmpeg | 语音自动转码（QQ 语音 silk → 浏览器可播放的 mp3） |
| koishi-plugin-puppeteer | 需要"截图"或 `/shot` 类指令时使用 |

## 🔐 访问控制（配合 auth 插件）

启用 [@koishijs/plugin-auth](https://www.npmjs.com/package/@koishijs/plugin-auth) 后，本插件会跟着一起上锁：

| 范围 | 未登录时的表现 |
| --- | --- |
| 控制台接口（收发消息、群管理、上传媒体、撤回、删除数据…） | 被 auth 插件以 `unauthorized` 拦截，页面上的操作全部不可用 |
| 独立聊天窗口 `/qq-chat/window`、沙盒窗口 `/qq-chat/sandbox` | 返回 `401`，页面提示「需要登录 Koishi 控制台」 |
| 聊天媒体缓存 `/qq-chat/media/persist-media/**`、下载接口、图片代理 `/qq-chat/fetch-image`、背景图 `/qq-chat/background` | 返回 `401` |
| 机器人消息推送（广播） | 未登录的客户端收不到聊天内容 |

**登录一次即可**：打开 Koishi 控制台登录后，插件会把登录令牌镜像到本域 cookie 与 localStorage，之后独立窗口 / 沙盒窗口会自动完成 websocket 登录，聊天记录与媒体照常显示。

- 这套限制只影响浏览器直接访问；机器人自己收发消息、转发媒体不受影响（服务端内部请求照常）
- 想把窗口 / 媒体重新开放（例如内网大屏、嵌入第三方页面），可在插件配置里关闭 **访问控制 → loginRequired**
- **没启用 auth 插件时这些限制完全不生效**，行为与以前一模一样

## ⚙️ 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `maxMessagesPerChannel` | `number` | `500` | 每个群组最大保存消息数量（50 ~ 1500） |
| `messageChunkSize` | `number` | `100` | 单个消息分块文件最大消息数量（20 ~ 500） |
| `channelCacheLimit` | `number` | `50` | 内存中最多缓存的频道消息数量（1 ~ 200） |
| `maxPersistImages` | `number` | `100` | 持久化存储的图片缓存数量（10 ~ 500） |
| `ocrApiKey` | `string` | `helloworld` | OCR 接口密钥（OCR.space 免费 key），用于识别 B 站卡片封面上的 UP 主 |
| `chatBackground` | `string` | `''` | 聊天区背景图：本地图片绝对路径或 http(s) 链接（留空为纯色） |
| `chatBackgroundBlur` | `number` | `0` | 背景图片模糊程度（0 ~ 30 px） |
| `chatBackgroundDim` | `number` | `12` | 背景图片遮罩浓度（0 ~ 90 %，越大文字越清晰） |
| `theme` | `string` | `koishi` | 主题：`koishi` 跟随控制台 / `system` 跟随系统 / `dark` 深色 / `light` 浅色（独立窗口同样生效） |
| `commandBridge` | `boolean` | `true` | 控制台发送的 `/指令` 由 Koishi 本地执行，拦截输出后再发到 QQ |
| `commandPrefix` | `string` | `/` | 本地指令前缀 |
| `commandAuthority` | `number` | `4` | 执行指令时使用的权限等级（4 = 管理员，保证多数指令可用） |
| `commandTimeoutMs` | `number` | `50000` | 指令执行超时（毫秒），绘图类指令建议 ≥ 50000（客户端 RPC 上限 60 秒） |
| `commandMaxLength` | `number` | `1200` | 指令输出发送到 QQ 的最大长度 |
| `commandEditRules` | `string` | `''` | 输出编辑规则：每行一条「查找=>替换」，按顺序应用，用 \n 表示换行 |
| `loginRequired` | `boolean` | `true` | 启用 auth 插件时，独立窗口 / 沙盒窗口与聊天媒体是否要求先登录控制台（关闭后这些地址重新变为公开，仅建议内网调试时关闭） |
| `mobilePassword` | `string` | `''` | 手机端 App / 手机 API 的访问密码。填写后 `/qq-chat/m` 与 `/qq-chat/api/*` 都要求先输密码换令牌；留空则跟随「访问控制」（启用 auth 时用控制台登录态，否则公开） |
| `clearIndexedDBOnStart` | `boolean` | `true` | 启动时强制清空 IndexedDB 图片缓存（浏览器卡死时的急救开关） |
| `loggerinfo` | `boolean` | `false` | 日志调试模式（开发者选项） |

## 🗃️ 数据目录

| 路径 | 内容 |
| --- | --- |
| `data/qq-chat/v2/metadata.json` | 机器人、频道、置顶等元数据 |
| `data/qq-chat/v2/chat-history/<机器人>/<频道>/` | 聊天记录（分块 `chunk-*.json` + `index.json`） |
| `data/qq-chat/v2/read-state.json` | 未读状态（每个频道的已读水位 + 未读数） |
| `data/qq-chat/v2/mobile-tokens.json` | 手机端 / API 的访问令牌（最多保留 20 个） |
| `data/qq-chat/temp/` | 待发送的图片 / 文件临时目录 |
| `data/qq-chat/persist-media/` | 图片 / 语音 / 视频 / 头像缓存 |

## 🧑‍💻 从源码构建

本仓库以**源码形态**发布：服务端 TypeScript 在 `src/`，控制台界面在 `client/`（`.vue` / `.ts` / `.scss`）。

```bash
npm install
npm run build          # tsc：src/*.ts -> lib/*.js
npm run build:client   # 构建控制台页面 + 独立窗口 / 沙盒窗口 -> dist/
```

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 编译服务端源码到 `lib/` |
| `npm run build:console` | 构建控制台页面（`dist/index.js`、`dist/style.css`） |
| `npm run build:window` | 构建独立窗口 / 沙盒窗口（`dist/window.*`、`dist/sandbox.*`） |
| `npm run build:client` | 上面两个一起跑 |

## ❓ 常见问题

**Q：为什么 QQ 里的图片显示不出来？**
QQ 官方 CDN 的图片链接带鉴权参数，浏览器直接引用会 403。插件会自动把它们改写到本地代理 `/qq-chat/fetch-image?u=...`，由服务端下载缓存后再显示（B 站卡片封面、QQ 表情同理）。

**Q：语音点不开 / 没有声音？**
QQ 语音是 silk 格式，浏览器播不了。启用 `koishi-plugin-silk` 并保证系统里有 ffmpeg 即可自动转码。

**Q：未读数刷新后还在吗？**
在。未读状态写在 `data/qq-chat/v2/read-state.json`，刷新页面、重启 Koishi 都不会丢；打开频道时会把已读水位推到最新并清零。

**Q：沙盒里发的消息会不会发到 QQ？**
不会。沙盒窗口 / 沙盒模式里的消息只在本地走一遍 Koishi 中间件，回复被拦截后画在界面上；只有你点回复下的「发送到当前频道」或「编辑发送」里的发送按钮，才会真的发到 QQ。

**Q：Markdown 面板的图片发到 QQ 后不显示？**
需要 `assets` 服务（推荐 `koishi-plugin-assets-qqbot-part-file`）。没有它时插件会退回本地地址，QQ 端拉不到图。

**Q：开了 auth 插件后，独立窗口 / 沙盒窗口提示「需要登录 Koishi 控制台」？**
这是预期行为：未登录的浏览器不允许访问窗口与聊天媒体。先在控制台登录一次，插件会把令牌镜像到本域 cookie，之后重新打开窗口即可。确实要让这些地址公开时，把插件配置里的 **访问控制 → loginRequired** 关掉。

**Q：手机 App 怎么用？**
在 `/qq-chat/m` 打开页面（或用手机浏览器扫描同一个地址），输入插件配置里的 **访问密码** 即可；iOS Safari / Android Chrome 里选择「添加到主屏幕」就会像原生 App 一样全屏运行。想给自研 App 用，直接调 `/qq-chat/api/*`（见上面的手机 API 表）。

**Q：消息明明发失败了，为什么没标出来？**
3.2.0 起不会再有这种情况：适配器报错、QQ 接口报错、返回空数组、没返回消息 ID 都会标「发送失败」。如果还有漏网的，欢迎带日志反馈。

## 📝 更新日志

### 3.3.0

**新增**

- ✨ **手机端 App（PWA）**：`/qq-chat/m`，手机浏览器打开即可用，支持「添加到主屏幕」全屏运行；界面与独立窗口完全一致（滑动引用 / 右滑返回 / 未读持久化 / 频道预览 / 群管理全都在），数据层换成 HTTP + SSE
- ✨ **手机 API（REST + SSE）**：`/qq-chat/api/*`，提供登录、频道 / 消息读取、发消息、标记已读、通用 RPC 桥与实时推送，方便自研 App / 第三方客户端接入；带 CORS，鉴权支持 `Authorization: Bearer` 或控制台登录 cookie
- ✨ **访问密码**：新增配置项 `mobilePassword`，手机端页面与 API 都要求先用密码换令牌（令牌持久化在 `data/qq-chat/v2/mobile-tokens.json`，可单独失效）
- ✨ 手机端媒体（图片 / 语音 / 视频）随登录自动放行：登录时下发 cookie，`<img>/<video>` 这类普通请求也能带鉴权

**说明**

- 手机端与网页端共用同一套后端接口：手机 App 的功能调用会转发到控制台注册的同一个监听器（`/qq-chat/api/rpc`），因此不会出现「网页端能用、手机端没有」的功能
- 不填 `mobilePassword` 时行为与以前一致：启用 auth 插件就要求控制台登录，没启用则公开

### 3.2.0

**新增**

- ✨ **未读消息持久化**：已读水位与未读数存到 `data/qq-chat/v2/read-state.json`，刷新页面 / 重启 Koishi 后未读角标依然在；多窗口之间通过广播实时同步
- ✨ **打开群聊停在未读区域**：自动定位到第一条未读消息，并画出「以下为新消息」分割线
- ✨ **「N 条新消息」跳转箭头**：未读区域不在视野里时右下角浮出胶囊，点一下跳回未读区域（手机端浮在输入区上方）
- ✨ **频道列表默认加载每个频道的最后一条消息预览**（一次性批量读取，未打开的频道也有时间与内容）
- ✨ **手机端手势重做**：左滑引用（气泡跟手滑动 + 右侧「引用」提示）、右滑返回（整页跟手滑动，后面若隐若现地露出会话列表，够远顺势滑出、不够远弹回）
- ✨ **电脑端 Windows 式框选**：按住左键拖出虚线选择框，框到的消息全部选中，直接批量转发 / 复制 / 删除
- ✨ **把频道卡片拖到浏览器窗口外松手**即可在新窗口打开该频道（改为指针事件实现）
- ✨ **交互动画统一加固**：页面切换、会话列表项、右键菜单、悬浮按钮、未读分割线、框选框、对话框内容都带过渡，跟随系统「减少动态效果」

**修复**

- 🐛 **私聊消息刷新后消失**：频道 key 用 `split(':')` 取值，而私聊频道号本身带冒号（`private:<openid>`），消息被写进了不存在的 `chat-history/<机器人>/private/` 目录，读取时又按完整 key 找 → 显示 0 条。已按第一个冒号切分，并把历史上错位的数据搬回各自频道
- 🐛 **独立聊天窗口打开是旧消息**：深链先加载的最新一页会被 `loadInitialData` 整体覆盖，改成合并
- 🐛 **「回到最新消息」按钮点了没反应**：滚动容器引用失效 + `scrollToBottom` 没有导出
- 🐛 **QQ 表情图片 403**：表情 / 卡片封面统一走本地代理下载
- 🐛 **部分发送失败的消息不显示「发送失败」**：补全 `bot.internal.*`（原生 markdown / 表情 / 上传）、`bot.http.post`（`/messages`、`/files`、`/stream_messages`、`/panels`）、返回空数组、没返回消息 ID 四条判定路径
- 🐛 **私聊频道显示「私聊（未知用户）」**：服务端「是否需要刷新频道名」的判断写反了（只有拿不到昵称时才刷新），已修正；客户端再用消息里的对方昵称兜底
- 🐛 **B 站 / 网易云卡片里的图片点一下会弹出图片查看器**：卡片图片有各自的点击行为，已从「点击放大」的委托里排除
- 🐛 **独立窗口手机端右滑返回后整页空白**：独立窗口默认隐藏会话列表，返回时没放出来
- 🐛 **拖动频道卡片到窗口外整页无响应**：不再使用原生 HTML5 拖拽（拖出浏览器窗口会挂住页面），改为指针捕获 + 自行计算位移

### 3.1.0

- ✨ 沙盒发送按钮新增 **「以 Markdown 格式发送到当前频道」**：输入框内容按 QQ 原生 markdown 直发，格式 / 按钮 / 链接都不丢
- ✨ 沙盒回复新增 **「以 MD 发送」**：把拦截到的回复（如 `/help` 的 markdown 菜单）按原生 markdown 发到当前频道
- 🔐 沙盒模式隐藏所有「直接发到 QQ」的入口（QQ 表情、发送 Markdown、+1 复读、转发、多选），只保留明确的「发送到当前频道 / 编辑发送 / 以 MD 发送」
- 🐛 修复**机器人回复被记到「随机群」**的问题：回复一律按会话所在频道落库，不再套用「webui 最后一次发消息的频道」（旧逻辑会导致别人在别的群触发指令时，消息出现在你最后操作过的群里）
- 🐛 修复沙盒 / 指令桥接拦截下来的 QQ 原生 markdown 在控制台里显示成 `##` 原始语法的问题（现在按 markdown 渲染）
- 🐛 修复**发送失败的消息被当成已发送**：QQ 拒收 / 无主动推送权限 / 网络错误时，历史里那条会标记「发送失败」（悬停显示失败原因），不再冒充正常消息
- 🐛 修复指令桥接里插件直接调用官方 API（`session.bot.internal.*`）时会绕过沙盒、把消息真的发到 QQ 的问题

### 3.0.0

- ✨ 新增**沙盒窗口**（`/qq-chat/sandbox`）：独立悬浮窗、完整主界面，消息只在本机执行
- ✨ 新增**主界面沙盒模式**（`/qq-chat?sandbox=1`）与频道右键「在沙盒窗口中打开 / 用沙盒模式打开主界面」
- ✨ 新增**指令桥接**：控制台里执行 `/指令`，拦截输出后编辑再发
- ✨ 沙盒回复支持「发送到当前频道」与「编辑发送」（按原始元素发送，图片 / 语音 / 视频不压文本）
- ✨ 新增独立聊天窗口 `/qq-chat/window`，可单独开窗或嵌入其它网页
- ✨ 新增聊天背景（图片 + 模糊 + 遮罩）与主题设置
- ✨ 新增 B 站小程序卡片解析（Wbi 签名 + 封面 OCR）、网易云音乐卡片播放
- ✨ 新增群成员 / 黑名单面板、入群申请处理、批量移除成员
- 🔐 **安全加固**：启用 auth 插件后，控制台接口 / 消息推送全部按权限拦截，未登录的客户端无法读聊天记录、发消息或改数据
- 🔐 **安全加固**：独立窗口、沙盒窗口与聊天媒体缓存（图片 / 语音 / 视频 / 头像）、图片代理、背景图在未登录时统一返回 401；登录后由 cookie 自动放行
- 🐛 修复沙盒消息会被写进真实聊天记录的问题（历史脏数据一并清理）
- 🐛 修复沙盒里自己发出的消息不显示、沙盒回复里的图片 / 语音 / 视频渲染不出来的问题
- 🐛 修复消息被记到错误频道、独立窗口无法深链定位等问题
