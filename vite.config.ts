import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

// 部署在子路径（如 GitHub Pages 的 /global-radio/）时用 VITE_BASE 指定，默认为根路径
const base = (process.env.VITE_BASE || '/').replace(/\/?$/, '/')

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // 启用生产模式优化
          hoistStatic: true,
          cacheHandlers: true
        }
      }
    }),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 3000000, // 3MB
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.radio-browser\.info\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'radio-api-cache',
              expiration: {
                maxEntries: 1000,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 天
              },
            },
          },
        ],
      },
      manifest: {
        name: '复古电台 - Retro Radio',
        short_name: '复古电台',
        description: 'AI 电台：八个快捷调频、仿真调频旋钮，音质旋钮可调成老式中波 / 电子管收音机',
        theme_color: '#1b1b1b',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        icons: [
          {
            src: 'icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        categories: ['music', 'entertainment', 'news', 'multimedia'],

      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
    cors: true,
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'terser',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  }
})
