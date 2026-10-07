# 复古电台（Retro Radio）

[在线体验：https://wisemonkey1990.github.io/retro-radio/](https://wisemonkey1990.github.io/retro-radio/)

从 [wisemonkey1990/global-radio](https://github.com/wisemonkey1990/global-radio) 的复古电台模块拆分，保留原 Git 历史。当前源码不包含经典版的搜索、收藏、历史页面、路由、Pinia 状态或播放器。

## 功能

- 八个频道：随心、新发现、专注、在路上、深夜、老歌、运动、爵士。
- 调频旋钮、原声 / 中波 / 电子管音质，音色与电波效果调节。
- 中文 / English 音源偏好、深色 / 复古黄主题、睡眠定时。
- 本地音频播放，以及网络不可用时的内置程序化乐队。
- PWA 与 Android Capacitor 容器。

音源采用精选电台与 Radio Browser 目录，直接连接 HTTPS 音频流。Web Audio 要求音源允许 CORS。频道采用预设规则，内置音乐使用 Web Audio 合成，无模型 API 或密钥要求。

## Web 开发

使用 Node.js 24 LTS 和 npm。

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 4173
npm run typecheck
npm test
npm run build
```

构建产物位于 `dist/`，仅有一个首页入口。设置保存在本机浏览器，不进行跨设备同步。

换台优先直接使用最近成功的镜像或精选音源；首选连接未就绪时，250 毫秒后并行启动备用线路，
两条线路保持静音，谁先能实际播放就切换到谁，并立即关闭未使用的线路。
连接期间原电台继续播放；换台失败时保留原电台，并恢复其频道选择。
精选音源阶段最多等待 6 秒，随后尝试目录音源，避免所有时间都耗在精选服务器上。
单个播放地址最多等待 4.5 秒，整轮网络连接最多等待 20 秒；无原电台可播放时由内置乐队接续。
目录音源仍通过 CORS 探测筛选，并短暂缓存健康状态。切台与暂停会取消过时连接。
实际切换速度仍取决于网络与音源缓冲；诊断日志记录连接耗时与尝试次数。

## Android

需要 JDK 17、Android SDK Platform 33、Build Tools 30.0.3 / 33.0.2 和 Platform Tools；配置 `ANDROID_HOME`，并通过官方 SDK Manager 安装组件与接受许可。

```bash
npm ci
npm run typecheck
npm run android:build
npm run apk:debug
```

APK：`android/app/build/outputs/apk/debug/app-debug.apk`。应用 ID 为 `com.retroradio.app`，可与原项目并存。支持 Android 5.1+。后台播放和系统媒体控件需要实机验证。

现有 release 配置使用调试签名，只适合本地测试；正式分发需配置自己的发布密钥。不要将密钥提交到仓库。

## 部署

```bash
docker compose up --build -d
```

静态部署可参考 `nginx-static.conf`。GitHub Pages 使用 `.github/workflows/pages.yml`，在仓库 Settings → Pages 中选择 GitHub Actions。`main` 更新后自动部署，也可手动运行流程；部署始终构建 `main`。子路径构建使用 `VITE_BASE=/retro-radio/ npm run build`。

PWA 打开时和回到前台会检查更新。新版缓存接管后，暂停状态下自动刷新；播放中显示「暂停并更新」，不会强行中断收听。首次从旧的缓存更新机制迁移时，请关闭该站点的所有标签页后重新打开，或用无痕窗口确认最新界面。

## 目录

- `src/ai-radio/`：界面、频道选择和音频引擎。
- `src/ai-radio/audio/`：收音机模拟、噪声与内置乐队。
- `android/`：Android 容器工程。
- `public/`：图标资源。

上游仓库未附带 LICENSE 文件；本项目没有新增授权声明，公开分发前应确认上游代码及图标的使用许可。

## 应用图标

图标使用炭黑收音机、奶油色扬声器和橙色调频旋钮，与应用界面一致。
原始透明图保存在 `resources/icon-foreground.png`，完整方形预览为 `resources/icon.png`。
Android 的普通、圆形和自适应启动图标已生成并提交到 `android/app/src/main/res/`；
PWA、浏览器和 Apple 主屏幕图标位于 `public/`。正常执行 `npm run android:build` 就会使用这些图标，无需额外生成步骤。

替换原图后，安装 ImageMagick 7 并执行 `npm run icons:generate`，再正常构建。
自适应与 PWA maskable 图标分别留有安全边距，适配不同桌面裁切形状。
