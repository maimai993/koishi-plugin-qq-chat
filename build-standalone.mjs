/**
 * 构建独立聊天窗口与沙盒窗口（dist/standalone.html + window.js + window.css、
 * dist/sandbox.html + sandbox.js + sandbox.css）。
 *
 * 控制台页面仍然由 `koishi-console build` 构建成 dist/index.js + dist/style.css，
 * 这里用 emptyOutDir: false 追加产物，两个构建可以任意顺序执行。
 *
 * 说明：两个窗口只需要 @koishijs/client 的 websocket 数据层（send / receive / connect），
 * 所以把 '@koishijs/client' 别名到它的 client/data.ts，避免把整个控制台运行时打进来。
 */
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { basename, resolve } from 'node:path'
import fs from 'node:fs'

const root = fileURLToPath(new URL('.', import.meta.url))
// node_modules/@koishijs/client/client/data.ts（exports 里没开放子路径，这里直接按目录取）
const dataEntry = resolve(root, '..', '@koishijs', 'client', 'client', 'data.ts')

// 每个窗口一份构建：base 决定 HTML 里引用资源的相对地址，服务端按同样的前缀挂载
const windows = [
  { html: 'client/standalone.html', base: '/qq-chat/window/', js: 'window.js', asset: 'window.[ext]' },
  { html: 'client/sandbox.html', base: '/qq-chat/sandbox/', js: 'sandbox.js', asset: 'sandbox.[ext]' },
]

for (const win of windows) {
  await build({
    root,
    base: win.base,
    build: {
      outDir: 'dist',
      assetsDir: '',
      emptyOutDir: false,
      minify: true,
      chunkSizeWarningLimit: 4096,
      rollupOptions: {
        input: resolve(root, win.html),
        output: {
          entryFileNames: win.js,
          assetFileNames: win.asset,
          chunkFileNames: 'chunk-[hash].js',
        },
      },
    },
    plugins: [vue()],
    resolve: {
      alias: {
        '@koishijs/client': dataEntry,
      },
    },
    css: {
      preprocessorOptions: { scss: { api: 'modern-compiler' } },
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  // vite 会按输入文件相对 root 的路径输出到 dist/client/<name>.html，这里挪到 dist 根目录
  const emitted = resolve(root, 'dist', 'client', basename(win.html))
  const target = resolve(root, 'dist', basename(win.html))
  if (fs.existsSync(emitted)) fs.renameSync(emitted, target)
  console.log(`[qq-chat] 窗口构建完成：dist/${basename(win.html)}`)
}

fs.rmSync(resolve(root, 'dist', 'client'), { recursive: true, force: true })
