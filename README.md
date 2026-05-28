# Aura

> Aura, formerly StudyPulse.

Aura 是一个轻量级 Windows AI 桌面陪伴工具。它保留 StudyPulse 的学习/工作记录、番茄钟、本地日报和 AI 复盘能力，并新增可选桌宠陪伴层。

## 功能

- 学习/工作会话开始、结束和本次计时
- 今日累计时长与番茄钟
- Windows 前台窗口记录和应用使用时长排行
- 键鼠活跃度统计
- 本地日报、历史日报和 TXT/Markdown 导出
- DeepSeek 与自定义 OpenAI 兼容 API 配置
- AI 总结、聊天追问和 Aura 桌宠气泡
- 可选 Aura 桌宠模式与 Codex 风格宠物库

## 隐私说明

Aura 默认把数据保存在本机 SQLite 数据库中。

- 不记录具体按键内容
- 不记录输入文本
- 不保存鼠标坐标
- 不截图、不录屏
- 不主动上传本地采集数据
- 只有用户主动生成 AI 总结或发送 AI 聊天消息时，才会把摘要发送到当前配置的 AI API

## 安装运行

```powershell
npm install
npm run tauri dev
```

## 开发命令

```powershell
npm test -- --run
npm run build
cd src-tauri
cargo check
cargo test
```

## 打包

```powershell
npm run tauri build -- --bundles msi
.\scripts\package_windows_release.ps1 -Version 0.2.3
```

发布包建议命名为：

```text
release/Aura_0.2.3_x64_cn.zip
```
