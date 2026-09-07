
# koishi-plugin-qq-chat

![](https://socialify.git.ci/maimai993/koishi-plugin-qq-chat/image?custom_description=%E5%A4%BA%E8%88%8D+QQ+%E5%AE%98%E6%96%B9%E6%9C%BA%E5%99%A8%E4%BA%BA%EF%BC%9A%E5%9C%A8+Koishi+%E6%8E%A7%E5%88%B6%E5%8F%B0%E7%9B%B4%E6%8E%A5%E6%8E%A5%E7%AE%A1%E5%AE%98%E6%96%B9+QQ+%E6%9C%BA%E5%99%A8%E4%BA%BA%E7%9A%84%E7%BE%A4%E8%81%8A&description=1&font=Jost&forks=1&issues=1&language=1&logo=https%3A%2F%2Fforum.koishi.xyz%2Fuploads%2Fdefault%2Foriginal%2F1X%2F72b32c99d52e391ce7dfc08d7fff86bd50ae1d03.png&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)

[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-chat?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-qq-chat)   [![npm downloads](https://img.shields.io/npm/dm/koishi-plugin-qq-chat)](https://www.npmjs.com/package/koishi-plugin-qq-chat)  [![](https://img.shields.io/badge/QQ%E7%BE%A4-1050229473-12B7F5?style=flat-square&logo=qq&logoColor=white)](https://qm.qq.com/q/FUY2sWwNyy)

> 夺舍 QQ 官方机器人：在 Koishi 控制台直接接管官方 QQ 机器人的群聊。

本项目是一个 Koishi 控制台聊天插件，让你可以在 Koishi 的控制台内直接查看并操作机器人的聊天记录。它面向 QQ 平台做了深度适配，并提供接近真机微信 / QQ 的聊天软件风格界面。

## ✨ 功能特性

- **聊天界面**：在 Koishi 控制台内直接查看机器人的聊天记录，支持多机器人、多频道切换。
- **消息收发**：支持接收文本、图片、语音、视频、文件等多种消息，并可主动发送文字与媒体。
- **媒体自动缓存**：图片 / 视频 / 音频 / 头像会被自动下载并持久化到 `data/qq-chat`，减少重复请求、加速加载。
- **撤回消息**：支持撤回消息，包括撤回他人发送的消息。
- **未读提醒**：提供未读消息提醒与角标，便于快速定位新消息。
- **群角色徽章**：解析并展示 QQ 群成员的角色徽章。
- **合并转发与卡片解析**：支持解析合并转发消息与各类卡片消息。
- **群组 / 机器人置顶**：支持置顶常用机器人与频道，方便管理。
- **聊天记录持久化**：消息自动写入本地存储（`data/qq-chat/v2/chat-history`），重启后仍可恢复历史。
- **图片缓存（IndexedDB）**：浏览器端通过 IndexedDB 缓存图片，优化加载速度并减少网络请求。
- **语音自动转码**：配合 `koishi-plugin-silk` 与系统 ffmpeg，自动完成语音格式转换。
- **手机端优化**：针对手机端进行适配，提供滑动返回等手势操作，并可配置聊天容器高度以防止输入框被遮挡。

## 📦 安装

在 Koishi 控制台中安装
推荐配合adapter-qq-crack适配器使用

## ⚙️ 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `maxMessagesPerChannel` | `number` | `500` | 每个群组最大保存的消息数量（50 ~ 1500） |
| `messageChunkSize` | `number` | `100` | 单个消息分块文件最大消息数量（20 ~ 500） |
| `channelCacheLimit` | `number` | `50` | 内存中最多缓存的频道消息数量（1 ~ 200） |
| `maxPersistImages` | `number` | `100` | 持久化存储的图片缓存数量（10 ~ 500） |
| `clearIndexedDBOnStart` | `boolean` | `true` | 启动时强制清空 IndexedDB 缓存（适用于紧急情况，防止浏览器卡死） |
| `loggerinfo` | `boolean` | `false` | 日志调试模式（开发者选项） |

## 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。
本项目基于 [chat-patch](https://github.com/koishi-shangxue-plugins/koishi-shangxue-apps/tree/main/plugins/chat-patch) 修改

![image|690x329, 75%](https://forum.koishi.xyz/uploads/default/optimized/3X/4/3/433432629bb69316967ab36a69fdf8d1ff308d7d_2_517x246.jpeg)

撤回

![image|270x105](https://forum.koishi.xyz/uploads/default/original/3X/c/b/cb754c6a45950796024a91407ad56dc904ef200d.png)

![image|690x439, 75%](https://forum.koishi.xyz/uploads/default/optimized/3X/9/7/974618111830bfc860336870442f5d29c7cc28e9_2_517x329.jpeg)

卡片解析
![image|690x443, 75%](https://forum.koishi.xyz/uploads/default/optimized/3X/a/c/ace44407a12d3e1dee0fd5a6383140408b148062_2_517x332.png)

![image|690x237, 75%](https://forum.koishi.xyz/uploads/default/optimized/3X/c/9/c9bcae4e29daf5c29fd70b752914084dcef8d4b2_2_517x177.jpeg)

渲染聊天记录

![62a7bdd5cdcf33e7e3081fda09dea0c9|227x155](https://forum.koishi.xyz/uploads/default/original/3X/c/0/c0bef5fd0bb4d8913ae6d087f25272c55547e7b5.png)

语音发送

![image|690x248, 75%](https://forum.koishi.xyz/uploads/default/optimized/3X/e/c/ec6e26aaa7f9a78c098358a18d9fe04f459be648_2_517x186.jpeg)

文件发送/下载

![image|690x166, 75%](https://forum.koishi.xyz/uploads/default/optimized/3X/7/d/7d2cd6848b6c672f96c03fcbc13eadde0db6d909_2_517x124.png)

引用信息

![image|690x362, 75%](https://forum.koishi.xyz/uploads/default/optimized/3X/6/8/68fedb1d7b615dd4d72c033e67276deb4458a51a_2_517x271.png)

新信息通知

![image|334x84](https://forum.koishi.xyz/uploads/default/original/3X/0/e/0e569189f110f0b325e4340c142c16a59c50891f.png)

未读信息

![image|277x73](https://forum.koishi.xyz/uploads/default/original/3X/a/b/ab596d852b4d011f0490f741090d2da7aee574eb.png)

身份渲染

![image|180x87](https://forum.koishi.xyz/uploads/default/original/3X/f/a/face04a53a6ddaf31cf0a97ee172b5b08771e853.png)

![image|157x71](https://forum.koishi.xyz/uploads/default/original/3X/b/b/bb9b5565f6aac525b7db2dc409a437d0401f439d.png)

以下是2.1.0的功能演示
发送md消息

<img width="789" height="542" alt="image" src="https://github.com/user-attachments/assets/364ab6ab-d9d4-4ee2-9700-ad45431125a3" />

<img width="429" height="169" alt="image" src="https://github.com/user-attachments/assets/fdf8506d-481d-4ef5-a43a-2b5ce73cbe16" />

<img width="622" height="265" alt="image" src="https://github.com/user-attachments/assets/888128ab-66c4-4431-9eb1-6f3ce0b0762f" />

<img width="224" height="152" alt="image" src="https://github.com/user-attachments/assets/f56ae963-3b3d-4731-8bfe-a4b0b1883803" />


管理群

<img width="523" height="500" alt="image" src="https://github.com/user-attachments/assets/2843d309-a510-4658-b3fb-03af09360d25" />

<img width="558" height="240" alt="image" src="https://github.com/user-attachments/assets/937cfe08-0243-456a-b589-fb46b5872e79" />



群状态

<img width="492" height="48" alt="image" src="https://github.com/user-attachments/assets/3cd94b65-3568-4f51-b352-84622557eec5" />


<img width="596" height="58" alt="image" src="https://github.com/user-attachments/assets/bbffd538-b501-4f45-8c23-eaf843acb97d" />

禁言

<img width="551" height="422" alt="image" src="https://github.com/user-attachments/assets/66e54c7f-d6b0-4b2a-967c-b671cc8709e1" />

查看用户 OpenID

<img width="479" height="222" alt="image" src="https://github.com/user-attachments/assets/f6eef502-aad8-4579-a514-eea180bcf8f2" />

新成员加入/退出提醒

<img width="385" height="215" alt="image" src="https://github.com/user-attachments/assets/58e47397-94e6-4b99-a3dc-0ca358e1ce79" />


机器人被移除提示

<img width="348" height="375" alt="image" src="https://github.com/user-attachments/assets/b83d716e-34dd-4d8b-a16d-040ba222be0c" />