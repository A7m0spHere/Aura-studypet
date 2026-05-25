# StudyPulse 更新说明

## v0.2.2

发布日期：2026-05-25

### 更新内容

- 将应用版本统一更新为 `0.2.2`，同步修改前端、Tauri、Rust、打包脚本和请求 User-Agent 中的版本号。
- 移除“内置公益 API”供应商入口，避免在公开仓库中保留内置公益 API 配置。
- AI 设置页现在只保留 `DeepSeek` 和 `自定义 OpenAI 兼容 API` 两种模式。
- DeepSeek 模式固定使用 `https://api.deepseek.com`，模型可在 `deepseek-v4-pro` 和 `deepseek-v4-flash` 之间选择，API Key 由用户自行填写。
- 自定义 API 模式不再预设 Base URL、API Key 或模型名，用户需要自行填写。
- 自定义 API 增加“检测可用模型”功能，程序会请求 `{base_url}/models`，并把可用模型显示为可选项。
- 更新应用图标，采用“番茄钟 + 脉冲线”的视觉方向，替换原来的占位图标。
- 程序内左上角品牌图标同步优化，与新版安装图标保持一致。
- 更新 README 和 `.env.example`，删除旧的内置公益 API 环境变量说明。

### 修改声明

本版本重点是清理 API 配置逻辑和优化发布形象。为了避免误用或泄露公共 API Key，StudyPulse 不再提供内置公益 API 模板，用户需要在本机设置页中自行配置 DeepSeek 或其他 OpenAI 兼容接口。API Key 仍只保存在本机配置中，界面不会显示明文，也不会写入日志。

自定义 API 的模型检测只用于辅助选择模型。如果服务商不支持 `/models` 接口，用户仍然可以手动填写模型名并保存。该功能不会改变 StudyPulse 的隐私边界：程序不会记录具体按键内容、输入文本、鼠标坐标或截图，也不会主动上传本地采集数据。

### 验证结果

- `cargo check` 通过
- `npm run build` 通过

### 已知说明

- 当前版本主要面向 Windows 桌面端。
- 未签名或自签名安装包在其他电脑上可能仍会触发 Windows SmartScreen 提示。
- AI 功能依赖用户配置的 API 服务状态、网络环境和模型权限。
