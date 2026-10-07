# 复古电台（Retro Radio）

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
npm run build
```

构建产物位于 `dist/`，仅有一个首页入口。设置保存在本机浏览器，不进行跨设备同步。

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

静态部署可参考 `nginx-static.conf`。GitHub Pages 使用 `.github/workflows/pages.yml`，在仓库 Settings → Pages 中选择 GitHub Actions。子路径构建使用 `VITE_BASE=/retro-radio/ npm run build`。

## 目录

- `src/ai-radio/`：界面、频道选择和音频引擎。
- `src/ai-radio/audio/`：收音机模拟、噪声与内置乐队。
- `android/`：Android 容器工程。
- `public/`：图标资源。

上游仓库未附带 LICENSE 文件；本项目没有新增授权声明，公开分发前应确认上游代码及图标的使用许可。
