# Changelog

本文件记录 StudyPulse 的主要开发节点、版本变化和发布说明。

## v0.2.3

本版本重点提升可交付体验，主要面向“安装、试用、反馈、继续迭代”的完整流程。

### Added

- 历史日报按日期分组展示。
- 历史日报新增 TXT 与 Markdown 导出。
- 设置页新增“本地数据”区域，可查看 SQLite 数据目录。
- 设置页新增“打开数据目录”按钮。
- 设置页新增“清空本地数据”按钮，清空前需要二次确认。
- 新增 Tauri commands：`get_data_dir`、`open_data_dir`、`clear_local_data`、`export_daily_report`。
- 发布 ZIP 增加中文更新说明文件。

### Changed

- 版本号统一升级为 `0.2.3`。
- README、中文使用手册和发布说明统一重写，减少乱码和过时描述。
- AI 请求 User-Agent 更新为 `StudyPulse/0.2.3`。
- 清空本地数据时保留 AI 设置和隐私确认状态，只清理学习相关数据。
- 历史日报列表显示更完整的信息：开始时间、学习时长、专注度、番茄钟完成数、Top 应用和 AI 总结摘要。

### Fixed

- 明确删除日报不会影响今日学习总时长。
- 本地日报导出和数据管理错误会返回可读中文提示。
- 发布材料中的版本号、安装文件名和手册内容保持一致。

## v0.2.2

本版本重点清理 API 配置逻辑和优化发布形象。

### Changed

- 将应用版本统一更新为 `0.2.2`，同步修改前端、Tauri、Rust、打包脚本和请求 User-Agent 中的版本号。
- 移除“内置公益 API”供应商入口，避免在公开仓库中保留内置公益 API 配置。
- 保留 DeepSeek 与自定义 OpenAI 兼容 API 两种配置方式。
- 自定义 API 支持检测 `/models` 并选择可用模型。
- 更新应用图标方向为“番茄钟 + 脉冲”视觉。
- 更新 README 和 `.env.example`，删除旧的内置公益 API 环境变量说明。

## v0.2.1

本版本是 StudyPulse 第一个正式同步到 Git 仓库并发布到 GitHub 的版本。从这一版开始，项目进入正式 Git/GitHub 版本管理阶段。

### Added

- 接入 Git 和 GitHub 版本管理规范。
- 新增 `.gitignore`，排除 `node_modules`、`dist`、`src-tauri/target`、数据库、日志、环境变量和发布缓存。
- 新增 `.env.example`，说明本地开发配置项。
- 补充 README，包含项目简介、运行命令、打包命令和版本发布说明。
- 整理基础发布材料，为 GitHub Release 上传安装包做准备。

### Changed

- 修复鼠标粘连感：移除低级鼠标 hook，改为后台低频轮询。
- AI 请求改为 Rust 原生 HTTP 客户端，并增加明确超时和错误提示。
- 增加键鼠活跃度统计开关，方便用户在遇到输入卡顿时关闭采集。
- 明确后续正式版本使用 Git tag，例如 `v0.2.1`、`v0.2.2`、`v0.2.3`。

## v0.2.0

本版本形成可安装、可试用的 Windows MVP，完成核心闭环。

### Added

- 接入 SQLite、本地日报、Windows 前台窗口采集、应用排行、键鼠活跃度计数和 AI 总结。
- 生成 Windows MSI 安装包和中文发布 ZIP。
- 增加自签名测试证书和 TXT 使用手册。
- 生成项目说明与用户体验反馈 Word 文档，用于课程提交和项目汇报。

## Pre-Git Development Notes

以下记录是正式同步 Git/GitHub 之前的开发里程碑，用于项目归档和说明开发过程。这些 `v0.1.x` 记录不一定对应独立的 Git commit 或 Git tag。

### v0.1.8

- 修复前端中文文案和 AI prompt 中的乱码问题。
- 更新 README 初稿和项目说明材料。
- 补充前端基础测试，覆盖 idle、studying、ended 等状态。
- 生成产品说明 HTML、可交互 HTML 原型、项目简介 Word 文档、用户体验反馈 Word 文档和最新版使用报告。
- 整理 Windows 安装包、中文 TXT 使用手册和 ZIP 发布目录。

### v0.1.7

- 实现 Windows 键鼠活跃度计数。
- 活跃度只统计 `keyboard_count` 和 `mouse_count`，不保存具体按键、输入内容、鼠标坐标或截图。
- 活跃度事件写入 `activity_events`，日报中保存活跃度趋势。
- 后续针对鼠标拖拽粘连问题，将鼠标低级 hook 改为后台低频轮询。

### v0.1.6

- 实现 AI 总结模块。
- 使用 `ai_settings` 中保存的 Base URL、API Key 和模型名。
- 兼容 OpenAI chat completions 格式。
- 支持根据本地日报生成总结，并基于日报上下文继续聊天。
- API 请求失败时保留本地日报，并返回可读错误。

### v0.1.5

- 实现 `daily_reports` 真实读写。
- `stop_session` 生成真实日报，包含学习时长、应用排行、专注度和番茄钟完成数。
- Dashboard 统计开始从 SQLite 读取真实数据。
- 今日学习时间支持累计多个已结束 session，并包含当前进行中的 session。

### v0.1.4

- 实现 Windows 前台窗口采集。
- `start_session` 后启动采样任务，`stop_session` 后停止采样任务。
- 每 1 秒采样当前前台窗口，写入 `window_samples`。
- `stop_session` 时聚合 `app_usage`。
- 明确不截图、不记录输入内容、不上传采集数据。

### v0.1.3

- 实现后端番茄钟状态机。
- 支持 `idle`、`running`、`paused`、`completed` 状态。
- 支持开始、暂停、重置和自然完成。
- 完成事件写入 `pomodoro_events`。

### v0.1.2

- 接入 SQLite 基础数据层。
- 创建 `sessions`、`window_samples`、`app_usage`、`activity_events`、`pomodoro_events`、`daily_reports`、`ai_settings`、`chat_messages` 表。
- 先实现 `sessions`、`pomodoro_events`、`ai_settings` 的真实读写。
- `start_session` 写入 session，`stop_session` 更新结束时间。
- `get_ai_settings_masked` 返回脱敏 API Key。

### v0.1.1

- 补齐最小 Tauri 2 工程。
- 新增 `src-tauri/Cargo.toml`、`tauri.conf.json`、`build.rs`、`src/main.rs` 和 capabilities 配置。
- 注册前端需要的 Tauri commands，先返回 mock 数据。
- 保证 `npm run tauri dev` 可以启动桌面应用，前端不会出现 `command not found`。

### v0.1.0

- 初始化 Vite + React + TypeScript + TailwindCSS 前端骨架。
- 完成 StudyPulse 主仪表盘 UI 初版。
- 设计首页核心区域：今日学习时间、当前状态、番茄钟、专注度、常用软件排行、AI 总结区。
- 建立前端类型、Tauri API 调用封装和基础测试文件。
