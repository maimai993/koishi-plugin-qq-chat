# koishi-plugin-qq-chat

![](https://socialify.git.ci/maimai993/koishi-plugin-qq-chat/image?custom_description=%E5%A4%BA%E8%88%8D+QQ+%E5%AE%98%E6%96%B9%E6%9C%BA%E5%99%A8%E4%BA%BA%EF%BC%9A%E5%9C%A8+Koishi+%E6%8E%A7%E5%88%B6%E5%8F%B0%E7%9B%B4%E6%8E%A5%E6%8E%A5%E7%AE%A1%E5%AE%98%E6%96%B9+QQ+%E6%9C%BA%E5%99%A8%E4%BA%BA%E7%9A%84%E7%BE%A4%E8%81%8A&description=1&font=Jost&forks=1&issues=1&language=1&logo=https%3A%2F%2Fforum.koishi.xyz%2Fuploads%2Fdefault%2Foriginal%2F1X%2F72b32c99d52e391ce7dfc08d7fff86bd50ae1d03.png&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)

[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-chat?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-qq-chat)   [![npm downloads](https://img.shields.io/npm/dm/koishi-plugin-qq-chat)](https://www.npmjs.com/package/koishi-plugin-qq-chat)  [![](https://img.shields.io/badge/QQ%E7%BE%A4-1050229473-12B7F5?style=flat-square&logo=qq&logoColor=white)](https://qm.qq.com/q/FUY2sWwNyy)

> **夺舍 QQ 官方机器人**：在 Koishi 控制台直接接管官方 QQ 机器人的群聊 —— 收发消息、群管理、指令沙盒一应俱全。

本插件把官方 QQ 机器人变成"能用鼠标操作"的聊天软件：控制台内就是一套接近真机 QQ 的聊天界面，图片 / 语音 / 视频 / 文件收发、群成员管理、Markdown 面板、指令桥接、独立窗口与沙盒模式全部内置。

## 📸 界面演示

### 控制台主界面

![控制台主界面](./screenshots/01-console-chat.jpg)

气泡、头像、群角色徽章、时间、未读提醒全部对齐真机 QQ；左侧是机器人与频道列表，右侧是群成员面板。

### 消息与频道右键菜单

| 消息右键菜单 | 频道右键菜单 |
| --- | --- |
| ![消息右键菜单](./screenshots/03-message-menu.jpg) | ![频道右键菜单](./screenshots/02-channel-menu.jpg) |

复制 / 查看原始报文 / 转发 / 收藏 / 多选 / 引用 / **+1 复读** / @TA / 查看资料 / 查看 OpenID / 撤回 / 删除；频道菜单里可以直接**打开独立聊天窗口**、**在沙盒窗口中打开**、**用沙盒模式打开主界面**。

### 群成员 / 黑名单面板

![群成员面板](./screenshots/04-members-panel.jpg)

成员列表、角色徽章、批量移除、黑名单维护，成员右键即可私聊 / @TA / 禁言。

### QQ 表情 与 Markdown 面板

| QQ 表情（经典 / 大表情） | Markdown 面板 |
| --- | --- |
| ![QQ 表情面板](./screenshots/05-emoji-panel.jpg) | ![Markdown 面板](./screenshots/06-md-panel.jpg) |

表情素材直接用公网 QFace 资源（`koishi.js.org/QFace`），无需本地素材目录；点一下就以动图 apng 的形式发到 QQ。Markdown 面板支持原生按钮、指令交互按钮（`/指令`、回车发送、引用），面板里拖入 / 粘贴的图片会走 `assets` 服务上传。

### @ 成员 / 收藏 / 多选

| @ 成员面板 | 收藏 | 多选操作 |
| --- | --- | --- |
| ![@ 成员面板](./screenshots/07-mention-panel.jpg) | ![收藏](./screenshots/08-favorites.jpg) | ![多选](./screenshots/09-multi-select.jpg) |

### 群聊天设置

![群聊天设置](./screenshots/10-channel-settings.jpg)

群备注、置顶、消息免打扰、清空本地聊天记录。

### 沙盒窗口（独立悬浮窗）

![沙盒窗口](./screenshots/11-sandbox-window.jpg)

`/qq-chat/sandbox?bot=<机器人>&channel=<频道>` 是**和主界面完全一样**的独立窗口：侧边栏、工具栏、右键菜单、群成员面板一个不少。区别只有一点 —— **消息只在本机跑一遍 Koishi 完整中间件，不会发到 QQ**。

### 沙盒里发送与渲染图片 / 文件 / 语音 / 视频

![沙盒媒体渲染](./screenshots/12-sandbox-media.jpg)

图片直接渲染、文件是下载卡片、语音是可点击播放的语音条、视频是可播放的 `<video>`。

### 沙盒回复：发送到当前频道 / 编辑发送

![沙盒回复](./screenshots/13-sandbox-reply.jpg)

机器人的回复被拦截后当成普通聊天消息画出来（带「沙盒」标记），点「**发送到当前频道**」按原始元素发到 QQ，点「**编辑发送**」可以先改文字、删掉不要的元素再发（图片 / 语音 / 视频不会被压成文本）。

### 编辑发送弹窗

![编辑发送](./screenshots/14-element-editor.jpg)

### 图片查看器

![图片查看器](./screenshots/15-image-viewer.jpg)

### 主界面沙盒模式

![主界面沙盒模式](./screenshots/16-sandbox-mode-console.jpg)

不想开新窗口时，用 `/qq-chat?sandbox=1&bot=..&channel=..`（或频道右键「用沙盒模式打开主界面」）即可让**控制台主页本身**进入沙盒语义：顶部有沙盒横幅，随时点「退出沙盒」。

### 独立聊天窗口

![独立聊天窗口](./screenshots/17-standalone-window.jpg)

`/qq-chat/window?bot=<机器人>&channel=<频道>` 只渲染单个频道，可以单独开窗、拖到副屏，或直接 iframe 嵌到别的网页里。

### 指令桥接（执行指令）

![指令桥接](./screenshots/18-command-bridge.jpg)

输入框里写 `/指令`，点工具栏的「执行指令」，插件会在 Koishi 本地执行它、拦截全部输出（含图片 / 语音 / 视频元素），放进可编辑弹窗，改完再发到 QQ —— 不走适配器、不会因为 QQ 侧的指令面板限制而失败。

## ✨ 功能特性

### 💬 聊天界面

- 控制台内直接查看机器人聊天记录，多机器人 / 多频道切换，频道搜索与置顶
- 接近真机 QQ 的界面：气泡、头像、群主 / 管理员徽章、时间分隔、消息分组、未读角标、"有人@你"提醒
- 频道备注、消息免打扰、置顶、从列表移除（本地）
- 合并转发卡片、B 站小程序卡片、网易云音乐卡片解析与播放
- 引用消息展示（自动补全引用者昵称）、@ 成员胶囊、QQ 表情与"不支持的第三方表情"提示
- 手机端适配：滑动返回、输入框避让、容器高度可配

### 📤 消息收发

- 接收：文本、图片、语音、视频、文件、Markdown、卡片、合并转发、系统提示（入群 / 退群 / 入群申请）
- 发送：文字、图片、文件、语音、视频、QQ 表情（经典 / 大表情 apng）、Markdown（原生 / 按钮交互）、截图（框选屏幕）
- 引用回复、@ 成员、**+1 复读**、多选批量转发、转发到其他频道、收藏（本地）
- 撤回消息、群成员禁言 / 解除禁言、入群申请处理

### 🗂️ 媒体处理

- 图片 / 语音 / 视频 / 文件 / 头像自动下载并持久化到 `data/qq-chat`
- 浏览器端 IndexedDB 图片缓存 + 视频按需加载（点击才下载）
- 远程图片走本地代理 `/qq-chat/fetch-image`（QQ CDN 带鉴权，直接引用显示不出来）
- 配合 `koishi-plugin-silk` / 系统 ffmpeg 自动完成语音格式转换，QQ 语音在浏览器里直接播放

### 🧪 沙盒与指令桥接

- **沙盒窗口**：`/qq-chat/sandbox`，独立悬浮窗，完整主界面，消息只在本机执行
- **主界面沙盒模式**：`/qq-chat?sandbox=1`，控制台主页直接进入沙盒语义
- **指令桥接**：控制台里发 `/指令` 由 Koishi 本地执行，拦截输出 → 可编辑 → 再发 QQ
- 沙盒回复支持「发送到当前频道 / 编辑发送（按原始元素）」，图片 / 语音 / 视频不会被压成文本
- 沙盒产生的消息**不会**写进真实聊天记录，也不会真的发到 QQ

### 🛠️ 群管理

- 群成员 / 黑名单面板，成员角色与禁言状态
- 禁言 / 解除禁言、批量移除成员、黑名单增删
- 入群申请一键同意 / 拒绝
- 机器人被移出群聊、群全员禁言、无主动推送权限等状态提示

### 🎨 外观与持久化

- 主题：跟随 Koishi 控制台 / 跟随系统 / 深色 / 浅色（独立窗口同样生效）
- 聊天区自定义背景图（本地路径或 http(s) 链接）+ 模糊度、遮罩浓度
- 聊天记录分块持久化（`data/qq-chat/v2/chat-history`），可配置每群上限、分块大小、内存缓存数量，超限自动清理

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
| `clearIndexedDBOnStart` | `boolean` | `true` | 启动时强制清空 IndexedDB 图片缓存（浏览器卡死时的急救开关） |
| `loggerinfo` | `boolean` | `false` | 日志调试模式（开发者选项） |

## 🗃️ 数据目录

| 路径 | 内容 |
| --- | --- |
| `data/qq-chat/v2/metadata.json` | 机器人、频道、置顶等元数据 |
| `data/qq-chat/v2/chat-history/<机器人>/<频道>/` | 聊天记录（分块 `chunk-*.json` + `index.json`） |
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
QQ 官方 CDN 的图片链接带鉴权参数，浏览器直接引用会 403。插件会自动把它们改写到本地代理 `/qq-chat/fetch-image?u=...`，由服务端下载缓存后再显示。

**Q：语音点不开 / 没有声音？**
QQ 语音是 silk 格式，浏览器播不了。启用 `koishi-plugin-silk` 并保证系统里有 ffmpeg 即可自动转码。

**Q：沙盒里发的消息会不会发到 QQ？**
不会。沙盒窗口 / 沙盒模式里的消息只在本地走一遍 Koishi 中间件，回复被拦截后画在界面上；只有你点回复下的「发送到当前频道」或「编辑发送」里的发送按钮，才会真的发到 QQ。

**Q：Markdown 面板的图片发到 QQ 后不显示？**
需要 `assets` 服务（推荐 `koishi-plugin-assets-qqbot-part-file`）。没有它时插件会退回本地地址，QQ 端拉不到图。

**Q：开了 auth 插件后，独立窗口 / 沙盒窗口提示「需要登录 Koishi 控制台」？**
这是预期行为：未登录的浏览器不允许访问窗口与聊天媒体。先在控制台登录一次，插件会把令牌镜像到本域 cookie，之后重新打开窗口即可。确实要让这些地址公开时，把插件配置里的 **访问控制 → loginRequired** 关掉。

## 📝 更新日志

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
- 🐛 修复编辑发送弹窗里大图预览过大、引用消息发送者显示 unknown 的问题
- 🔧 包结构改为源码形态：服务端 TypeScript 源码进入 `src/`，`lib/` 与 `dist/` 均由源码构建

### 2.2.0

- 优化控制台界面与消息渲染，修复若干媒体加载问题

## 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。
本项目基于 [chat-patch](https://github.com/koishi-shangxue-plugins/koishi-shangxue-apps/tree/main/plugins/chat-patch) 修改。
