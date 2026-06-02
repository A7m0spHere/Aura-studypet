import {
  emitTo,
  listen,
} from "@tauri-apps/api/event";
import {
  Bot,
  Check,
  ChevronRight,
  DoorOpen,
  KeyRound,
  Maximize2,
  Pin,
  Rocket,
  Settings,
  Sparkles,
  TimerReset,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, formatDuration } from "../lib/api";
import { DEFAULT_PET_PREFERENCES } from "../lib/defaults";
import type { DashboardState, PetPreferences } from "../lib/types";

const scaleOptions = [0.8, 1, 1.2, 1.4];

function moodLabel(dashboard: DashboardState | null) {
  if (!dashboard) return "今日状态：整理中";
  if (dashboard.session_status === "studying") return "今日状态：专注中";
  if (dashboard.today_study_seconds >= 60 * 60) return "今日状态：稳稳推进";
  if (dashboard.focus_score < 40 && dashboard.today_study_seconds > 0) return "今日状态：需要休息";
  return "今日状态：刚开始";
}

function statusHint(dashboard: DashboardState | null) {
  if (!dashboard) return "相识时间：Aura 正在读取状态";
  if (dashboard.today_study_seconds <= 0) return "相识时间：今天还没正式开局呢~";
  return `相识时间：今天已陪伴 ${formatDuration(dashboard.today_study_seconds)}`;
}

export function PetContextMenu() {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [preferences, setPreferences] = useState<PetPreferences>(DEFAULT_PET_PREFERENCES);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [nextDashboard, nextPreferences] = await Promise.all([
        api.getCurrentStatus(),
        api.getPetPreferences(),
      ]);
      setDashboard(nextDashboard);
      setPreferences(nextPreferences);
    } catch (error) {
      setMessage(String(error));
    }
  }

  useEffect(() => {
    load();
    const onBlur = () => api.hidePetMenu().catch(() => undefined);
    let unlisten: (() => void) | undefined;
    listen("pet-menu-opened", () => {
      load();
    }).then((value) => {
      unlisten = value;
    });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      unlisten?.();
    };
  }, []);

  const canStop = dashboard?.session_status === "studying";
  const currentScale = useMemo(() => preferences.pet_scale || 1, [preferences.pet_scale]);

  async function run(action: () => Promise<void>, keepOpen = false) {
    setMessage("");
    try {
      await action();
      await load();
      if (!keepOpen) await api.hidePetMenu();
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function stopAndSummarize() {
    const report = await api.stopSession();
    await api.generateAiSummary(report.id);
  }

  async function savePet(next: PetPreferences) {
    const saved = await api.savePetPreferences(next);
    setPreferences(saved);
    await api.applyPetWindowPreferences();
  }

  async function openSettings(tab: "pet" | "ai" | "privacy-data") {
    await api.showMainWindow(tab);
  }

  async function encourageAura() {
    const nudge = await api.sendProactivePetNudge("idle_app");
    await emitTo("pet", "pet-bubble", { message: nudge.message, emotion: nudge.emotion });
  }

  return (
    <main
      className="pet-menu-shell"
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <section className="pet-menu-card">
        <div className="pet-menu-mood">
          <Sparkles size={16} />
          <span>{moodLabel(dashboard)}</span>
        </div>

        <MenuItem
          icon={<Pin size={17} />}
          label="置顶显示"
          active={preferences.pet_always_on_top}
          onClick={() =>
            run(
              () =>
                savePet({
                  ...preferences,
                  pet_always_on_top: !preferences.pet_always_on_top,
                }),
              true,
            )
          }
        />

        <MenuGroup icon={<Maximize2 size={17} />} label="调节大小">
          <div className="pet-menu-scale-grid">
            {scaleOptions.map((scale) => (
              <button
                className={Math.abs(currentScale - scale) < 0.01 ? "pet-menu-scale active" : "pet-menu-scale"}
                key={scale}
                onClick={() => run(() => savePet({ ...preferences, pet_scale: scale }), true)}
                type="button"
              >
                {Math.round(scale * 100)}%
              </button>
            ))}
          </div>
        </MenuGroup>

        <MenuItem
          icon={<Settings size={17} />}
          label="菜单界面设置"
          onClick={() => run(() => openSettings("pet"))}
        />

        <MenuItem
          icon={<DoorOpen size={17} />}
          label="Aura 传送门"
          onClick={() => run(() => api.showMainWindow())}
        />

        <MenuGroup icon={<Rocket size={17} />} label="快捷菜单">
          <div className="pet-menu-submenu">
            <button
              disabled={dashboard?.session_status === "studying"}
              onClick={() => run(async () => void (await api.startSession()))}
              type="button"
            >
              开始学习
            </button>
            <button disabled={!canStop} onClick={() => run(async () => void (await stopAndSummarize()))} type="button">
              结束学习
            </button>
            <button onClick={() => run(async () => void (await api.startPomodoro(25)))} type="button">
              开始 25 分钟番茄钟
            </button>
            <button onClick={() => run(encourageAura)} type="button">
              让 Aura 鼓励一下
            </button>
            <button
              disabled={!dashboard?.active_report_id}
              onClick={() =>
                run(async () => {
                  if (dashboard?.active_report_id) await api.generateAiSummary(dashboard.active_report_id);
                })
              }
              type="button"
            >
              生成复盘
            </button>
          </div>
        </MenuGroup>

        <MenuItem
          icon={<TimerReset size={17} />}
          label="番茄钟（25分钟）"
          onClick={() => run(async () => void (await api.startPomodoro(25)))}
        />

        <MenuItem icon={<KeyRound size={17} />} label="API 配置" onClick={() => run(() => openSettings("ai"))} />

        <p className="pet-menu-note">{message || statusHint(dashboard)}</p>

        <MenuItem icon={<X size={17} />} label="退出" danger onClick={() => run(api.hidePetWindow)} />
      </section>
    </main>
  );
}

function MenuItem({
  icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={danger ? "pet-menu-item pet-menu-danger" : "pet-menu-item"} onClick={onClick} type="button">
      <span className="pet-menu-check">{active ? <Check size={13} /> : null}</span>
      <span className="pet-menu-icon">{icon}</span>
      <span className="pet-menu-label">{label}</span>
    </button>
  );
}

function MenuGroup({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="pet-menu-group">
      <summary>
        <span className="pet-menu-check" />
        <span className="pet-menu-icon">{icon}</span>
        <span className="pet-menu-label">{label}</span>
        <ChevronRight className="pet-menu-chevron" size={16} />
      </summary>
      {children}
    </details>
  );
}
