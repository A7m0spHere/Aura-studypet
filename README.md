# Aura

> Aura, formerly StudyPulse.

Aura 是一个轻量级 Windows AI 桌面陪伴工具。它保留 StudyPulse 的学习/工作记录、番茄钟、本地日报和 AI 复盘能力，并新增可选桌宠陪伴层。

## 当前版本

- 最新版本：`v0.3.0`
- 发布状态：安装包已生成，代码已同步到 GitHub
- 上一个发布版本：`v0.2.3`

## 更新记录

完整版本变化、发布说明和历史开发节点请查看 [CHANGELOG.md](CHANGELOG.md)。

## 功能

- 学习/工作会话开始、结束和本次计时
- 今日累计时长与番茄钟
- Windows 前台窗口记录和应用使用时长排行
- 键鼠活跃度统计
- 本地日报、历史日报和 TXT/Markdown 导出
- DeepSeek 与自定义 OpenAI 兼容 API 配置
- AI 总结、聊天追问和 Aura 桌宠气泡
- 主工作区设置页，集中管理通用偏好、桌宠、AI、隐私与本地数据
- 桌宠的文件兼容codex格式宠物，也推荐使用codex宠物文件用在该程序
- 桌宠动作预览窗口，可单独检查待机、行走、挥手、跳跃、完成、等待、提醒和对话动作
- 宠物素材扫描提示，帮助发现无效 `pet.json` 或自动启用的默认素材配置

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
.\scripts\package_windows_release.ps1 -Version 0.3.0
```

发布包建议命名为：

```text
release/Aura_0.3.0_x64_cn.zip
```

## 桌宠素材说明

Aura 支持两类桌宠素材：
> 建议直接使用codex格式宠物
- 单张动作图：在 `pet.json` 的 `sprites` 中分别声明各动作图片。
- 图集素材：在 `pet.json` 中声明 `spritesheetPath`，或在宠物目录放置默认 `spritesheet.webp`。

图集动作可通过 `atlasMotionRows` 自定义行号，支持的动作包括：`idle`、`walk_right`、`walk_left`、`greet`、`jump`、`happy`、`thinking`、`scold`、`talk`。
