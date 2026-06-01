import {
  Activity,
  Clock3,
  Coffee,
  Eye,
  History,
  MessageSquareText,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  Square,
  TimerReset,
  Trash2,
} from "lucide-react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HistoryDialog, PrivacyDialog } from "./components/DashboardDialogs";
import { AuraMark, FoldPanel, MetricTile } from "./components/DashboardUi";
import { SettingsModal } from "./components/SettingsModal";
import { api, formatDuration } from "./lib/api";
import { DEFAULT_APP_PREFERENCES, DEFAULT_PET_PREFERENCES } from "./lib/defaults";
import type {
  AiSummaryTone,
  AppPreferences,
  AuraChatMessage,
  ChatMessage,
  DailyReport,
  DashboardState,
  ExportFormat,
  PetEmotion,
  PetPreferences,
} from "./lib/types";

const toneLabels: Record<AiSummaryTone, string> = {
  gentle: "温和鼓励",
  normal: "正常复盘",
  witty: "轻微吐槽",
  strict: "严格监督",
};

function todayLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

function statusLabel(status?: string) {
  if (status === "studying") return "专注中";
  if (status === "ended") return "已结束";
  return "待开始";
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function emitPetBubble(message: string, emotion: PetEmotion = "idle") {
  if (!message.trim()) return;
  try {
    await emitTo("pet", "pet-bubble", { message, emotion });
  } catch {
    // 桌宠窗口可能处于隐藏状态，忽略即可。
  }
}

function appCategory(appName: string) {
  const normalized = appName.toLowerCase();
  if (/code|cursor|idea|webstorm|pycharm|visual studio|terminal|powershell|cmd/.test(normalized)) return "work";
  if (/chrome|edge|firefox|browser|notion|obsidian|word|excel|powerpoint|wps/.test(normalized)) return "study";
  if (/bilibili|youtube|steam|game|netflix|spotify|music|qqmusic/.test(normalized)) return "entertainment";
  if (/wechat|qq|telegram|discord|slack|teams/.test(normalized)) return "social";
  return "other";
}

function isMeaningfulAppSwitch(previousApp: string, nextApp: string) {
  const previous = appCategory(previousApp);
  const next = appCategory(nextApp);
  return previous !== next && next !== "other";
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [lastReport, setLastReport] = useState<DailyReport | null>(null);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_APP_PREFERENCES);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "pet" | "ai" | "privacy-data" | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [auraInput, setAuraInput] = useState("");
  const [auraMessages, setAuraMessages] = useState<AuraChatMessage[]>([]);
  const [petPreferences, setPetPreferences] = useState<PetPreferences>(DEFAULT_PET_PREFERENCES);
  const lastPetApp = useRef("");
  const appEnteredAt = useRef(Date.now());
  const lastNudgeAt = useRef(0);

  const pomodoroMinutes = preferences.default_pomodoro_minutes;

  async function refresh() {
    try {
      setDashboard(await api.getCurrentStatus());
    } catch (refreshError) {
      setError(String(refreshError));
    }
  }

  async function loadPreferences() {
    try {
      const next = await api.getAppPreferences();
      setPreferences(next);
      if (!next.privacy_notice_accepted) setPrivacyOpen(true);
    } catch (preferenceError) {
      setError(String(preferenceError));
    }
  }

  async function loadPetPreferences() {
    try {
      setPetPreferences(await api.getPetPreferences());
    } catch {
      setPetPreferences(DEFAULT_PET_PREFERENCES);
    }
  }

  async function loadReports() {
    try {
      setReports(await api.getRecentReports(30));
    } catch (reportError) {
      setError(String(reportError));
    }
  }

  async function loadAuraMessages() {
    try {
      setAuraMessages(await api.getAuraChatHistory());
    } catch {
      setAuraMessages([]);
    }
  }

  useEffect(() => {
    refresh();
    loadPreferences();
    loadPetPreferences();
    loadReports();
    loadAuraMessages();
    const timer = window.setInterval(refresh, 1000);
    const petTimer = window.setInterval(loadPetPreferences, 5000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(petTimer);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    listen<"pet" | "ai" | "privacy-data">("open-settings", (event) => {
      setSettingsTab(event.payload);
      setSettingsOpen(true);
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, []);

  const isStudying = dashboard?.session_status === "studying";
  const reportId = isStudying ? null : lastReport?.id ?? dashboard?.active_report_id ?? null;
  const aiSummary = lastReport?.ai_summary ?? dashboard?.ai_summary;
  const topApps = dashboard?.app_usage.slice(0, 6) ?? [];
  const focusScore = dashboard?.focus_score ?? 0;
  const focusTone = focusScore >= 70 ? "稳定专注" : focusScore >= 40 ? "状态一般" : "刚刚起步";

  const activityData = useMemo(() => {
    if (dashboard?.activity.length) return dashboard.activity;
    return [{ label: "现在", keyboard: 0, mouse: 0 }];
  }, [dashboard]);

  useEffect(() => {
    if (!dashboard || !petPreferences.pet_enabled || !petPreferences.proactive_ai_enabled) return;
    const appName = dashboard.current_app || "Unknown";
    const now = Date.now();
    const cooldownMs = 30 * 60 * 1000;
    const idleMs = petPreferences.idle_nudge_minutes * 60 * 1000;

    async function sendNudge(eventType: "idle_app" | "app_switch") {
      if (now - lastNudgeAt.current < cooldownMs) return;
      lastNudgeAt.current = now;
      try {
        const nudge = await api.sendProactivePetNudge(eventType);
        await emitPetBubble(nudge.message, nudge.emotion);
      } catch {
        // 主动关心失败时不影响主窗口记录和总结。
      }
    }

    if (!lastPetApp.current) {
      lastPetApp.current = appName;
      appEnteredAt.current = now;
      return;
    }

    if (lastPetApp.current !== appName) {
      const previous = lastPetApp.current;
      lastPetApp.current = appName;
      appEnteredAt.current = now;
      if (petPreferences.app_switch_nudge_enabled && isMeaningfulAppSwitch(previous, appName)) {
        sendNudge("app_switch");
      }
      return;
    }

    if (now - appEnteredAt.current >= idleMs) {
      sendNudge("idle_app");
      appEnteredAt.current = now;
    }
  }, [dashboard, petPreferences]);

  async function runAction<T>(action: () => Promise<T>, after?: (value: T) => void) {
    setBusy(true);
    setError("");
    try {
      const value = await action();
      after?.(value);
      await refresh();
      await loadReports();
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences(next: AppPreferences) {
    setPreferences(next);
    try {
      setPreferences(await api.saveAppPreferences(next));
    } catch (saveError) {
      setError(String(saveError));
    }
  }

  async function acceptPrivacyNotice() {
    await savePreferences({ ...preferences, privacy_notice_accepted: true });
    setPrivacyOpen(false);
  }

  async function generateSummary() {
    if (!reportId) {
      setError("请先结束一次专注记录，再生成 AI 总结。");
      return;
    }
    await runAction(() => api.generateAiSummary(reportId, preferences.ai_summary_tone), (summary) => {
      setLastReport((current) => (current ? { ...current, ai_summary: summary } : current));
      emitPetBubble(summary, "ended");
    });
  }

  async function stopSessionAndSummarize() {
    await runAction(
      async () => {
        const report = await api.stopSession();
        try {
          const summary = await api.generateAiSummary(report.id, preferences.ai_summary_tone);
          return { ...report, ai_summary: summary };
        } catch (summaryError) {
          setError(`日报已保存，但 AI 总结生成失败：${String(summaryError)}`);
          return report;
        }
      },
      (report) => {
        setLastReport(report);
        if (report.ai_summary) emitPetBubble(report.ai_summary, "ended");
      },
    );
  }

  async function sendChat() {
    if (!reportId || !chatInput.trim()) return;
    const content = chatInput.trim();
    setChatInput("");
    const optimistic: ChatMessage = {
      id: Date.now(),
      report_id: reportId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    await runAction(() => api.chatWithAi(reportId, content), (reply) => {
      setMessages((current) => [...current, reply]);
      emitPetBubble(reply.content, "happy");
    });
  }

  async function sendAuraChat() {
    if (!auraInput.trim()) return;
    const content = auraInput.trim();
    setAuraInput("");
    const optimistic: AuraChatMessage = {
      id: Date.now(),
      role: "user",
      content,
      emotion: "idle",
      created_at: new Date().toISOString(),
    };
    setAuraMessages((current) => [...current, optimistic]);
    await runAction(() => api.chatWithAura(content), (reply) => {
      setAuraMessages((current) => [...current, reply]);
      emitPetBubble(reply.content, reply.emotion);
    });
  }

  async function clearAuraChat() {
    await runAction(api.clearAuraChatHistory, () => {
      setAuraMessages([]);
      emitPetBubble("聊天记录清空了，我们可以从这一刻重新开始。", "idle");
    });
  }

  async function deleteReport(reportIdToDelete: number) {
    if (!window.confirm("确定删除这条日报记录吗？今日累计时长不会被清零。")) return;
    await runAction(() => api.deleteDailyReport(reportIdToDelete), () => {
      if (lastReport?.id === reportIdToDelete) {
        setLastReport(null);
        setMessages([]);
      }
      loadReports();
    });
  }

  async function exportReport(reportIdToExport: number, format: ExportFormat) {
    await runAction(() => api.exportDailyReport(reportIdToExport, format), (path) => {
      setError(`日报已导出：${path}`);
      window.setTimeout(() => setError(""), 4500);
    });
  }

  const latestAuraReply = [...auraMessages].reverse().find((message) => message.role === "assistant");
  const totalActivity = (dashboard?.keyboard_count ?? 0) + (dashboard?.mouse_count ?? 0);
  const currentApp = dashboard?.current_app || "尚未开始";
  const currentWindowTitle = dashboard?.current_window_title || "开始后会显示当前窗口";
  const petStatus = petPreferences.pet_enabled ? "桌宠已启用" : "桌宠未启用";
  const pomodoroRemaining = dashboard?.pomodoro.remaining_seconds ?? pomodoroMinutes * 60;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-paper/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-ink text-paper">
            <AuraMark />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Aura</h1>
            <p className="text-sm text-ink/60">AI Desktop Companion · {todayLabel()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink/70">
            {statusLabel(dashboard?.session_status)}
          </span>
          <button
            className="secondary-button"
            onClick={() => {
              setHistoryOpen(true);
              loadReports();
            }}
          >
            <History size={17} />
            历史日报
          </button>
          {petPreferences.pet_enabled ? (
            <button className="secondary-button" onClick={() => api.showPetWindow()} title="桌宠已启用，隐藏时可点击这里唤醒">
              <Eye size={17} />
              显示桌宠
            </button>
          ) : null}
          <button
            className="icon-button"
            onClick={() => {
              setSettingsTab(undefined);
              setSettingsOpen(true);
            }}
            aria-label="打开设置"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="grid gap-5 p-6 xl:grid-cols-[330px_minmax(420px,1fr)_380px]">
        <section className="space-y-5">
          <FoldPanel title="专注计时" defaultOpen>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/50">Focus</p>
                <h2 className="mt-2 text-5xl font-semibold tabular-nums">
                  {formatDuration(dashboard?.current_session_seconds ?? 0)}
                </h2>
                <p className="mt-2 text-sm font-semibold text-ink/70">
                  {isStudying ? "Aura 正在陪你记录这段专注。" : "准备好时，开一段新的节奏。"}
                </p>
              </div>
              <Clock3 className="text-moss" size={24} />
            </div>
            <div className="mt-5 space-y-2 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink/65">
              <p className="truncate font-semibold text-ink">{currentApp}</p>
              <p className="truncate">{currentWindowTitle}</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="primary-button justify-center" disabled={busy || isStudying} onClick={() => runAction(api.startSession)}>
                <Play size={17} />
                开始专注
              </button>
              <button className="danger-button justify-center" disabled={busy || !isStudying} onClick={stopSessionAndSummarize}>
                <Square size={16} />
                结束记录
              </button>
            </div>
            <button className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-moss" onClick={() => setPrivacyOpen(true)}>
              <ShieldCheck size={16} />
              查看隐私边界
            </button>
          </FoldPanel>

          <FoldPanel title="番茄钟" defaultOpen={false}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/50">Pomodoro</p>
                <h2 className="mt-2 text-4xl font-semibold tabular-nums">{formatDuration(pomodoroRemaining)}</h2>
                <p className="mt-2 text-sm text-ink/60">已完成 {dashboard?.pomodoro.completed_count ?? 0} 个番茄钟</p>
              </div>
              <Coffee className="text-tomato" size={24} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[25, 40, 50].map((minutes) => (
                <button
                  className={pomodoroMinutes === minutes ? "primary-button justify-center" : "secondary-button justify-center"}
                  key={minutes}
                  onClick={() => savePreferences({ ...preferences, default_pomodoro_minutes: minutes })}
                >
                  {minutes}m
                </button>
              ))}
            </div>
            <label className="field mt-3">
              <span>自定义分钟数</span>
              <input
                min={1}
                max={180}
                type="number"
                value={pomodoroMinutes}
                onChange={(event) =>
                  savePreferences({
                    ...preferences,
                    default_pomodoro_minutes: Number(event.target.value || 25),
                  })
                }
              />
            </label>
            <div className="mt-4 flex gap-2">
              <button className="secondary-button" onClick={() => runAction(() => api.startPomodoro(pomodoroMinutes))}>
                <Play size={16} />
                开始
              </button>
              <button className="secondary-button" onClick={() => runAction(api.pausePomodoro)}>
                暂停/继续
              </button>
              <button className="icon-button" onClick={() => runAction(api.resetPomodoro)} aria-label="重置番茄钟">
                <RefreshCw size={17} />
              </button>
            </div>
          </FoldPanel>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricTile
              label="今日累计"
              value={formatDuration(dashboard?.today_study_seconds ?? 0)}
              hint={isStudying ? "当前会话记录中" : "开始后自动累计"}
              icon={<Clock3 size={17} />}
            />
            <MetricTile label="专注度" value={`${focusScore}`} hint={focusTone} icon={<Activity size={17} />} />
            <MetricTile
              label="活跃度"
              value={`${totalActivity}`}
              hint={`键盘 ${dashboard?.keyboard_count ?? 0} / 鼠标 ${dashboard?.mouse_count ?? 0}`}
              icon={<TimerReset size={17} />}
            />
          </div>

          <FoldPanel title="实时观察" defaultOpen={false}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">实时观察</h2>
                <p className="text-sm text-ink/60">键鼠活跃趋势</p>
              </div>
              <span className="rounded-md bg-paper px-2 py-1 text-xs font-semibold text-ink/55">最近采样</span>
            </div>
            <div className="h-60 min-h-60 min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={220}>
                <LineChart data={activityData}>
                  <CartesianGrid stroke="#ebe5da" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="keyboard" stroke="#2f6f5e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="mouse" stroke="#d94c3d" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </FoldPanel>

          <FoldPanel title="应用排行" defaultOpen={false}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">应用排行</h2>
                <p className="text-sm text-ink/60">这段时间主要停留在哪里</p>
              </div>
              <span className="rounded-md bg-paper px-2 py-1 text-xs font-semibold text-ink/55">Top {topApps.length}</span>
            </div>
            {topApps.length ? (
              <div className="h-56 min-h-56 min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={210}>
                  <BarChart data={topApps} layout="vertical" margin={{ left: 12, right: 16 }}>
                    <CartesianGrid stroke="#ebe5da" horizontal={false} />
                    <XAxis type="number" tickFormatter={(value) => `${Math.round(Number(value) / 60)}m`} />
                    <YAxis dataKey="app_name" type="category" width={92} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatDuration(Number(value))} />
                    <Bar dataKey="seconds" fill="#2f6f5e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="rounded-md border border-line bg-paper p-4 text-sm text-ink/60">
                开始专注并切换几个窗口后，这里会显示应用使用时长排行。
              </p>
            )}
          </FoldPanel>
        </section>

        <aside className="space-y-5">
          <FoldPanel title="桌宠" defaultOpen={false} tone="moss">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Aura Dock</p>
                <h2 className="mt-2 text-lg font-semibold">桌宠陪伴</h2>
                <p className="mt-1 text-sm text-ink/60">
                  {petStatus} · {petPreferences.pet_name || "未选择宠物"}
                </p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-md bg-moss text-white">
                <MessageSquareText size={20} />
              </div>
            </div>
            <div className="mt-4 rounded-md border border-line bg-paper px-3 py-3 text-sm leading-6 text-ink/70">
              {latestAuraReply?.content ||
                (petPreferences.pet_enabled
                  ? "我在旁边。你开始专注后，我会把状态和回复同步到桌宠气泡里。"
                  : "桌宠是可选的。开启后，Aura 会显示悬浮宠物和状态气泡。")}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <button className="secondary-button justify-center" disabled={!petPreferences.pet_enabled} onClick={() => api.showPetWindow()}>
                <Eye size={16} />
                显示桌宠
              </button>
              <button
                className="secondary-button justify-center"
                onClick={() => {
                  setSettingsTab(undefined);
                  setSettingsOpen(true);
                }}
              >
                <Settings size={16} />
                桌宠设置
              </button>
            </div>
          </FoldPanel>

          <FoldPanel title="和 Aura 对话" defaultOpen={false}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">和 Aura 对话</h2>
                <p className="text-sm text-ink/60">独立于日报的陪伴聊天</p>
              </div>
              <button className="icon-button" onClick={clearAuraChat} aria-label="清空 Aura 对话">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="max-h-72 min-h-48 space-y-2 overflow-auto pr-1">
              {auraMessages.length ? (
                auraMessages.map((message) => (
                  <p
                    className={message.role === "user" ? "chat-bubble ml-auto bg-moss text-white" : "chat-bubble bg-paper text-ink"}
                    key={message.id}
                  >
                    {message.content}
                  </p>
                ))
              ) : (
                <p className="rounded-md border border-line bg-paper p-4 text-sm leading-6 text-ink/60">
                  可以直接和 Aura 说一句，她会结合当前学习状态回应，并同步切换桌宠表情。
                </p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-moss"
                value={auraInput}
                onChange={(event) => setAuraInput(event.target.value)}
                placeholder="和 Aura 说点什么"
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendAuraChat();
                }}
              />
              <button className="secondary-button" disabled={busy || !auraInput.trim()} onClick={sendAuraChat}>
                发送
              </button>
            </div>
          </FoldPanel>

          <FoldPanel title="复盘" defaultOpen>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">复盘</h2>
                <p className="text-sm text-ink/60">结束一次记录后生成总结</p>
              </div>
              <MessageSquareText className="text-moss" size={20} />
            </div>
            <label className="field mb-3">
              <span>总结语气</span>
              <select
                className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal text-ink outline-none focus:border-moss"
                value={preferences.ai_summary_tone}
                onChange={(event) => savePreferences({ ...preferences, ai_summary_tone: event.target.value as AiSummaryTone })}
              >
                {Object.entries(toneLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="min-h-24 rounded-md border border-line bg-paper p-4 text-sm leading-6 text-ink/75">
              {aiSummary || "还没有总结。结束一次专注记录后，可以生成本地日报和 AI 反馈。"}
            </div>
            <button className="primary-button mt-4 w-full justify-center" disabled={busy || !reportId} onClick={generateSummary}>
              {busy ? "处理中..." : "生成 AI 总结"}
            </button>
            <div className="mt-4 space-y-3">
              <div className="max-h-32 space-y-2 overflow-auto pr-1">
                {messages.map((message) => (
                  <p
                    className={message.role === "user" ? "chat-bubble ml-auto bg-moss text-white" : "chat-bubble bg-paper text-ink"}
                    key={message.id}
                  >
                    {message.content}
                  </p>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-moss"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="继续追问这次复盘"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") sendChat();
                  }}
                />
                <button className="secondary-button" disabled={!reportId || busy} onClick={sendChat}>
                  发送
                </button>
              </div>
            </div>
          </FoldPanel>
        </aside>
      </div>

      {historyOpen ? (
        <HistoryDialog
          reports={reports}
          onClose={() => setHistoryOpen(false)}
          onRefresh={loadReports}
          onDelete={deleteReport}
          onExport={exportReport}
        />
      ) : null}
      {privacyOpen ? (
        <PrivacyDialog
          accepted={preferences.privacy_notice_accepted}
          onAccept={acceptPrivacyNotice}
          onClose={() => setPrivacyOpen(false)}
        />
      ) : null}
      {error ? <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-ink px-4 py-3 text-sm text-white">{error}</div> : null}
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsTab(undefined);
        }}
        onShowPrivacy={() => setPrivacyOpen(true)}
        initialTab={settingsTab}
        preferences={preferences}
        onSavePreferences={savePreferences}
        onDataCleared={() => {
          setLastReport(null);
          setMessages([]);
          loadReports();
          refresh();
        }}
      />
    </main>
  );
}
