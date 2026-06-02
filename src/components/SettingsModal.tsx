import {
  Bot,
  CheckCircle2,
  Database,
  FolderOpen,
  KeyRound,
  Loader2,
  MousePointer2,
  Search,
  Shield,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  AiProviderSettingsMasked,
  AiSettingsInput,
  AiSettingsMasked,
  AppPreferences,
  PetPreferences,
} from "../lib/types";
import { PetSettingsPanel } from "./PetSettingsPanel";

interface SettingsPageProps {
  active?: boolean;
  onShowPrivacy: () => void;
  initialTab?: SettingsTab;
  preferences: AppPreferences;
  onSavePreferences: (preferences: AppPreferences) => Promise<void>;
  onDataCleared?: () => void;
  onPreviewPetActions?: () => void;
  onPetPreferencesSaved?: (preferences: PetPreferences) => void;
}

interface SettingsModalProps extends SettingsPageProps {
  open: boolean;
  onClose: () => void;
}

type AiProvider = string;
type AiForms = Record<AiProvider, AiSettingsInput>;
type SettingsTab = "general" | "pet" | "ai" | "privacy-data";

const DEEPSEEK_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"];

const DEFAULT_FORMS: AiForms = {
  deepseek: {
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    api_key: "",
    model: DEEPSEEK_MODELS[0],
  },
  custom: {
    provider: "custom",
    base_url: "",
    api_key: "",
    model: "",
  },
};

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: string;
  description: string;
  icon: typeof MousePointer2;
}> = [
  { id: "general", label: "常规", description: "采集与基础开关", icon: MousePointer2 },
  { id: "pet", label: "Aura 桌宠", description: "宠物、人格与提醒", icon: Bot },
  { id: "ai", label: "AI 配置", description: "模型与 API Key", icon: KeyRound },
  { id: "privacy-data", label: "隐私与数据", description: "边界说明与本地数据", icon: Shield },
];

export function SettingsPage({
  active = true,
  onShowPrivacy,
  initialTab,
  preferences,
  onSavePreferences,
  onDataCleared,
  onPreviewPetActions,
  onPetPreferencesSaved,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [activeProvider, setActiveProvider] = useState<AiProvider>("deepseek");
  const [forms, setForms] = useState<AiForms>(cloneDefaultForms());
  const [masked, setMasked] = useState<AiSettingsMasked | null>(null);
  const [message, setMessage] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [detectingModels, setDetectingModels] = useState(false);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [dataDir, setDataDir] = useState("");
  const [clearingData, setClearingData] = useState(false);

  useEffect(() => {
    if (!active) return;
    setMessage("");
    setTestMessage("");
    setCustomModels([]);
    setActiveTab(initialTab ?? "general");
    api.getDataDir().then(setDataDir).catch(() => setDataDir(""));
    api
      .getAiSettingsMasked()
      .then((value) => {
        setMasked(value);
        setActiveProvider(value.active_provider);
        setForms(formsFromMasked(value));
        const active = value.providers.find((item) => item.provider === value.active_provider);
        setCustomModels(active?.available_models ?? []);
      })
      .catch((error) => setMessage(String(error)));
  }, [active, initialTab]);

  useEffect(() => {
    if (!message && !testMessage) return;
    const timer = window.setTimeout(() => {
      setMessage("");
      setTestMessage("");
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [message, testMessage]);

  const activeSettings = forms[activeProvider] ?? DEFAULT_FORMS.deepseek;
  const activeMasked = useMemo(
    () => masked?.providers.find((item) => item.provider === activeProvider),
    [activeProvider, masked],
  );
  const activeTabMeta = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0];

  function updateActiveForm(patch: Partial<AiSettingsInput>) {
    setForms((current) => ({
      ...current,
      [activeProvider]: {
        ...(current[activeProvider] ?? { ...DEFAULT_FORMS.custom, provider: activeProvider }),
        ...patch,
      },
    }));
  }

  async function save() {
    setMessage("");
    setTestMessage("");
    try {
      await api.saveAiSettings(activeSettings);
      setMessage("已保存。DeepSeek 和自定义 API 的 Key 会分别保存在本机配置中，界面不会显示明文。");
      setForms((current) => ({
        ...current,
        [activeProvider]: {
          ...(current[activeProvider] ?? activeSettings),
          api_key: "",
        },
      }));
      const nextMasked = await api.getAiSettingsMasked();
      setMasked(nextMasked);
      setActiveProvider(nextMasked.active_provider);
      setForms(formsFromMasked(nextMasked));
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestMessage("");
    try {
      const result = await api.testAiConnection(activeSettings);
      setTestMessage(result.message);
    } catch (error) {
      setTestMessage(String(error));
    } finally {
      setTesting(false);
    }
  }

  async function detectCustomModels() {
    setDetectingModels(true);
    setTestMessage("");
    try {
      const result = await api.listAiModels(activeSettings);
      setTestMessage(result.message);
      if (result.ok) {
        setCustomModels(result.models);
        if (!activeSettings.model.trim() && result.models.length > 0) {
          setForms((current) => ({
            ...current,
            [activeProvider]: { ...(current[activeProvider] ?? activeSettings), model: result.models[0] },
          }));
        }
      }
    } catch (error) {
      setTestMessage(String(error));
    } finally {
      setDetectingModels(false);
    }
  }

  async function toggleActivityCapture() {
    await onSavePreferences({
      ...preferences,
      activity_capture_enabled: !preferences.activity_capture_enabled,
    });
    setMessage(
      preferences.activity_capture_enabled
        ? "已关闭键鼠活跃度统计。下次开始学习时生效。"
        : "已开启键鼠活跃度统计。下次开始学习时生效。",
    );
  }

  async function openDataDir() {
    setMessage("");
    try {
      await api.openDataDir();
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function clearLocalData() {
    if (!window.confirm("确定清空本地学习数据吗？AI 设置和隐私确认状态会保留。")) return;
    if (!window.confirm("再次确认：这会删除会话、窗口采样、应用排行、活跃度、番茄钟事件、日报和聊天记录。")) return;
    setClearingData(true);
    setMessage("");
    try {
      await api.clearLocalData();
      setMessage("本地学习数据已清空，AI 设置和隐私确认状态已保留。");
      onDataCleared?.();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setClearingData(false);
    }
  }

  function addCustomProfile() {
    const provider = `custom:${Date.now()}`;
    setActiveProvider(provider);
    setCustomModels([]);
    setForms((current) => ({
      ...current,
      [provider]: {
        ...DEFAULT_FORMS.custom,
        provider,
      },
    }));
  }

  async function deleteCustomProfile() {
    if (activeProvider === "deepseek" || activeProvider === "custom") return;
    setMessage("");
    try {
      await api.deleteAiSettingsProvider(activeProvider);
      const nextMasked = await api.getAiSettingsMasked();
      setMasked(nextMasked);
      setActiveProvider(nextMasked.active_provider);
      setForms(formsFromMasked(nextMasked));
      setCustomModels([]);
      setMessage("已删除该自定义 API 配置。");
    } catch (error) {
      setMessage(String(error));
    }
  }

  const deepseek = activeProvider === "deepseek";
  const custom = activeProvider !== "deepseek";
  const customProfiles = masked?.providers.filter((item) => item.provider !== "deepseek") ?? [];
  const apiKeyPlaceholder = apiKeyPlaceholderFor(activeMasked);

  return (
      <section className="settings-shell settings-shell-page">
        <header className="settings-header settings-page-header">
          <div>
            <h2 className="text-lg font-semibold text-ink">设置</h2>
            <p className="text-sm text-ink/60">管理桌宠、AI、采集开关和本地数据。</p>
          </div>
        </header>

        <div className="settings-body settings-body-page">
          <nav className="settings-tabs" aria-label="设置分类">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? "settings-tab settings-tab-active" : "settings-tab"}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={17} />
                  <span className="min-w-0">
                    <span className="block truncate">{tab.label}</span>
                    <span className="block truncate text-xs font-normal opacity-65">{tab.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <main className="settings-content">
            <div className="settings-content-head">
              <h3 className="text-base font-semibold text-ink">{activeTabMeta.label}</h3>
              <p className="text-sm text-ink/60">{activeTabMeta.description}</p>
            </div>

            <div className="settings-content-scroll">
              {activeTab === "general" ? (
                <SettingsSection title="采集开关" description="控制键盘与鼠标活跃度统计，不记录具体按键、输入文本或鼠标坐标。">
                  <div className="settings-row">
                    <div>
                      <p className="text-sm font-semibold text-ink">键鼠活跃度统计</p>
                      <p className="mt-1 text-sm leading-6 text-ink/60">
                        关闭后不会启动键盘 hook 和鼠标轮询；学习会话、窗口采样和日报仍可使用。
                      </p>
                    </div>
                    <button
                      className={preferences.activity_capture_enabled ? "primary-button" : "secondary-button"}
                      onClick={toggleActivityCapture}
                    >
                      {preferences.activity_capture_enabled ? "已开启" : "已关闭"}
                    </button>
                  </div>
                </SettingsSection>
              ) : null}

              {activeTab === "pet" ? (
                <PetSettingsPanel
                  onPreviewActions={onPreviewPetActions}
                  onPreferencesSaved={onPetPreferencesSaved}
                />
              ) : null}

              {activeTab === "ai" ? (
                <div className="settings-stack">
                  <SettingsSection title="供应商" description="DeepSeek 使用预设地址；自定义模式兼容 OpenAI 风格接口。">
                    <div className="settings-provider-grid">
                      <button
                        className={deepseek ? "primary-button" : "secondary-button"}
                        onClick={() => {
                          setActiveProvider("deepseek");
                          setCustomModels([]);
                        }}
                      >
                        DeepSeek
                      </button>
                      <button
                        className={custom ? "primary-button" : "secondary-button"}
                        onClick={() => {
                          setActiveProvider(customProfiles[0]?.provider ?? "custom");
                          setCustomModels(customProfiles[0]?.available_models ?? []);
                        }}
                      >
                        自定义 OpenAI 兼容 API
                      </button>
                    </div>
                    {custom ? (
                      <div className="settings-provider-row">
                        <select
                          className="h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-moss"
                          value={activeProvider}
                          onChange={(event) => {
                            const provider = event.target.value;
                            const profile = customProfiles.find((item) => item.provider === provider);
                            setActiveProvider(provider);
                            setCustomModels(profile?.available_models ?? []);
                          }}
                        >
                          {customProfiles.map((profile, index) => (
                            <option key={profile.provider} value={profile.provider}>
                              {customProfileLabel(profile.provider, index)}
                            </option>
                          ))}
                          {!customProfiles.length ? <option value="custom">自定义 API 1</option> : null}
                        </select>
                        <button className="secondary-button justify-center" onClick={addCustomProfile} type="button">
                          新增
                        </button>
                        <button
                          className="danger-button justify-center"
                          onClick={deleteCustomProfile}
                          disabled={activeProvider === "custom"}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    ) : null}
                  </SettingsSection>

                  <SettingsSection title="连接参数">
                    <div className="settings-form-grid">
                      <label className="field">
                        <span>API URL (Base URL)</span>
                        <input
                          value={activeSettings.base_url}
                          disabled={!custom}
                          onChange={(event) => updateActiveForm({ base_url: event.target.value })}
                          placeholder={custom ? "例如 https://api.example.com/v1" : activeSettings.base_url}
                        />
                      </label>

                      <label className="field">
                        <span>模型名称</span>
                        {deepseek ? (
                          <select
                            value={activeSettings.model}
                            onChange={(event) => updateActiveForm({ model: event.target.value })}
                          >
                            {DEEPSEEK_MODELS.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="space-y-2">
                            {customModels.length > 0 ? (
                              <select
                                value={customModels.includes(activeSettings.model) ? activeSettings.model : ""}
                                onChange={(event) => updateActiveForm({ model: event.target.value })}
                              >
                                <option value="">手动输入模型名</option>
                                {customModels.map((model) => (
                                  <option key={model} value={model}>
                                    {model}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <input
                              value={activeSettings.model}
                              onChange={(event) => updateActiveForm({ model: event.target.value })}
                              placeholder="可先检测模型，也可以手动输入"
                            />
                          </div>
                        )}
                      </label>

                      <label className="field">
                        <span>API Key</span>
                        <input
                          value={activeSettings.api_key}
                          onChange={(event) => updateActiveForm({ api_key: event.target.value })}
                          type="password"
                          placeholder={apiKeyPlaceholder}
                        />
                      </label>
                    </div>
                  </SettingsSection>

                  <div className="settings-actions">
                    {custom ? (
                      <button className="secondary-button" onClick={detectCustomModels} disabled={detectingModels}>
                        {detectingModels ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                        检测可用模型
                      </button>
                    ) : null}
                    <button className="secondary-button" onClick={testConnection} disabled={testing}>
                      {testing ? <Loader2 className="animate-spin" size={16} /> : null}
                      测试 API
                    </button>
                    <button className="primary-button" onClick={save}>
                      保存
                    </button>
                  </div>
                </div>
              ) : null}

              {activeTab === "privacy-data" ? (
                <div className="settings-stack">
                  <SettingsSection title="隐私边界">
                    <div className="settings-note">
                      AI 总结只会在你主动生成总结或继续聊天时，将本地日报摘要发送到当前选择的 API。API Key 不会以明文返回前端，也不会写入日志。
                      <button className="ml-2 font-semibold text-moss" onClick={onShowPrivacy}>
                        查看完整隐私说明
                      </button>
                    </div>
                  </SettingsSection>

                  <SettingsSection title="本地数据">
                    <div className="space-y-3">
                      <div className="rounded-md border border-line bg-paper px-3 py-2 text-xs leading-5 text-ink/60">
                        <div className="mb-1 flex items-center gap-2 font-semibold text-ink">
                          <Database size={15} />
                          数据目录
                        </div>
                        <p className="break-all">{dataDir || "正在读取数据目录..."}</p>
                      </div>
                      <p className="text-xs leading-5 text-ink/55">
                        清空本地学习数据会删除会话、窗口采样、应用排行、活跃度、番茄钟事件、日报和聊天记录；AI 设置与隐私确认状态会保留。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button className="secondary-button" type="button" onClick={openDataDir}>
                          <FolderOpen size={16} />
                          打开数据目录
                        </button>
                        <button className="danger-button" type="button" onClick={clearLocalData} disabled={clearingData}>
                          {clearingData ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                          清空本地数据
                        </button>
                      </div>
                    </div>
                  </SettingsSection>
                </div>
              ) : null}
            </div>

            <SettingsStatus message={message} testMessage={testMessage} />
          </main>
        </div>
      </section>
  );
}

export function SettingsModal({
  open,
  onClose,
  ...props
}: SettingsModalProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop">
      <div className="settings-modal-frame">
        <button className="icon-button settings-modal-close" onClick={onClose} aria-label="关闭设置">
          <X size={18} />
        </button>
        <SettingsPage active {...props} />
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="mb-3">
        <h4 className="settings-section-title">{title}</h4>
        {description ? <p className="settings-section-desc">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SettingsStatus({ message, testMessage }: { message: string; testMessage: string }) {
  if (!message && !testMessage) return null;
  const success =
    testMessage.includes("可用") || testMessage.includes("检测到") || testMessage.includes("available");

  return (
    <div className="settings-status-bar">
      {message ? <p>{message}</p> : null}
      {testMessage ? (
        <p className="flex items-center gap-2">
          {success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {testMessage}
        </p>
      ) : null}
    </div>
  );
}

function formsFromMasked(masked: AiSettingsMasked): AiForms {
  return masked.providers.reduce<AiForms>((forms, provider) => {
    const defaults = provider.provider === "deepseek" ? DEFAULT_FORMS.deepseek : DEFAULT_FORMS.custom;
    forms[provider.provider] = {
      provider: provider.provider,
      base_url: provider.base_url.trim() || defaults.base_url,
      api_key: "",
      model: provider.model.trim() || defaults.model,
    };
    return forms;
  }, cloneDefaultForms());
}

function cloneDefaultForms(): AiForms {
  return {
    deepseek: { ...DEFAULT_FORMS.deepseek },
    custom: { ...DEFAULT_FORMS.custom },
  };
}

function customProfileLabel(provider: string, index: number) {
  if (provider === "custom") return "自定义 API 1";
  return `自定义 API ${index + 1}`;
}

function apiKeyPlaceholderFor(provider: AiProviderSettingsMasked | undefined) {
  if (provider?.configured) return provider.api_key_masked;
  return "sk-...";
}
