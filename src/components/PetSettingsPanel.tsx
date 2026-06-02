import { Clapperboard, Eye, EyeOff, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { DEFAULT_PET_PREFERENCES } from "../lib/defaults";
import type { PetPreferences, PetProfile } from "../lib/types";

const defaultPersona =
  "你是 Aura，一个轻量桌面 AI 伙伴。你会陪伴用户学习、工作和复盘。你的语气温和、简短、带一点轻微吐槽，但不能羞辱用户。你只能基于提供的行为数据回应，不要编造。如果用户表现不错，要具体夸奖。如果用户分心，要提醒但不要攻击。每次回复尽量控制在 80 字以内。";

const defaultPetPreferences: PetPreferences = {
  ...DEFAULT_PET_PREFERENCES,
  pet_persona_prompt: defaultPersona,
};

interface PetSettingsPanelProps {
  onPreviewActions?: () => void;
  onPreferencesSaved?: (preferences: PetPreferences) => void;
}

function defaultPersonaForPet(name: string) {
  return `你是 ${name}，Aura Companion 的桌面 AI 伙伴。你的性格：温柔、可爱、带一点孩子气、偶尔认真、鼓励型、轻微吐槽型。你的回复风格：简短、可爱、和编程有关，不要太幼稚，不要过度卖萌。你只能基于提供的行为摘要回应，不要编造；提醒用户时要克制、友好，不要攻击用户。每次回复尽量控制在 80 字以内。`;
}

export function PetSettingsPanel({ onPreviewActions, onPreferencesSaved }: PetSettingsPanelProps = {}) {
  const [preferences, setPreferences] = useState<PetPreferences>(defaultPetPreferences);
  const [profiles, setProfiles] = useState<PetProfile[]>([]);
  const [libraryDir, setLibraryDir] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [nextPreferences, nextProfiles, nextLibraryDir] = await Promise.all([
        api.getPetPreferences(),
        api.getPetProfiles(),
        api.getPetLibraryDir(),
      ]);
      setPreferences(nextPreferences);
      setProfiles(nextProfiles);
      setLibraryDir(nextLibraryDir);
    } catch (error) {
      setMessage(String(error));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === preferences.active_pet_id),
    [profiles, preferences.active_pet_id],
  );
  const missingActiveProfile = Boolean(preferences.active_pet_id && profiles.length && !activeProfile);
  const activeSpriteCount = activeProfile ? Object.keys(activeProfile.sprites ?? {}).length : 0;

  async function save(next: PetPreferences, windowAction = true) {
    setBusy(true);
    setMessage("");
    try {
      const saved = await api.savePetPreferences(next);
      setPreferences(saved);
      onPreferencesSaved?.(saved);
      if (windowAction) {
        if (saved.pet_enabled) await api.showPetWindow();
        else await api.hidePetWindow();
      }
      await api.applyPetWindowPreferences();
      setMessage(saved.pet_enabled ? "Aura 桌宠设置已保存。" : "桌宠模式已关闭，主功能不受影响。");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function togglePetEnabled(checked: boolean) {
    if (!checked) {
      await save({ ...preferences, pet_enabled: false, proactive_ai_enabled: false });
      return;
    }
    if (!profiles.length) {
      setMessage("请先添加一个兼容 Codex 格式的桌宠文件夹，再启用桌宠。");
      return;
    }

    let proactive = preferences.proactive_ai_enabled;
    if (!preferences.first_pet_enable_seen) {
      const confirmed = window.confirm(
        "Aura 桌宠会悬浮在桌面上，根据你的学习/工作状态显示气泡和 AI 回复。\n\nAura 不会截图、录屏、记录输入内容或鼠标坐标。你可以随时在设置中关闭桌宠模式。\n\n点击“确定”开启桌宠。",
      );
      if (!confirmed) return;
      proactive = window.confirm(
        "是否同时开启主动 AI 关心？开启后，Aura 会在你长时间停留某个应用或发生明显应用切换时，低频调用 AI 生成一句关心提醒。",
      );
    }

    await save({
      ...preferences,
      pet_enabled: true,
      proactive_ai_enabled: proactive,
      first_pet_enable_seen: true,
    });
  }

  async function refreshProfiles() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api.rescanPetProfiles();
      setProfiles(result.profiles);
      const scanNote = result.messages.length ? ` ${result.messages.join("；")}` : "";
      setMessage(`已刷新宠物列表，找到 ${result.profiles.length} 个可用宠物。${scanNote}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openLibraryDir() {
    setMessage("");
    try {
      await api.openPetLibraryDir();
      setMessage("已打开 Aura 宠物文件夹。把 Codex 宠物文件夹放进去后点击刷新。");
    } catch (error) {
      setMessage(String(error));
    }
  }

  function preferencesForProfile(profile: PetProfile): PetPreferences {
    return {
      ...preferences,
      active_pet_id: profile.id,
      pet_name: profile.display_name,
      pet_persona_prompt: profile.persona?.trim() || defaultPersonaForPet(profile.display_name),
    };
  }

  return (
    <div className="settings-stack">
      <section className="settings-section">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="settings-section-title">桌宠模式</h3>
            <p className="settings-section-desc">桌宠是可选陪伴层，关闭后不影响学习记录、番茄钟和日报。</p>
          </div>
          <label className="settings-switch settings-switch-strong">
            <input
              checked={preferences.pet_enabled}
              disabled={busy || !profiles.length}
              type="checkbox"
              onChange={(event) => togglePetEnabled(event.target.checked)}
            />
            启用
          </label>
        </div>

        <div className="settings-info-grid">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              当前宠物：
              <strong className="font-semibold text-ink">
                {activeProfile?.display_name ??
                  (missingActiveProfile ? `${preferences.pet_name || preferences.active_pet_id}（配置存在，但宠物文件夹未通过扫描）` : "尚未导入宠物")}
              </strong>
              {!preferences.pet_enabled ? "（已配置，尚未启用）" : ""}
            </span>
            <span>{activeProfile ? (activeSpriteCount ? `${activeSpriteCount} 个状态图` : "spritesheet 宠物") : "请先导入宠物文件夹"}</span>
          </div>
          <p className="break-all">宠物库：{libraryDir || "正在读取..."}</p>
        </div>

        <div className="settings-button-row">
          <button className="secondary-button" type="button" onClick={openLibraryDir}>
            <FolderOpen size={16} />
            打开宠物文件夹
          </button>
          <button className="secondary-button" type="button" onClick={refreshProfiles} disabled={busy}>
            <RefreshCw size={16} />
            刷新列表
          </button>
          <button className="secondary-button" type="button" onClick={onPreviewActions} disabled={!activeProfile}>
            <Clapperboard size={16} />
            预览动作
          </button>
          <button className="secondary-button" type="button" onClick={() => api.showPetWindow()} disabled={!preferences.pet_enabled}>
            <Eye size={16} />
            显示桌宠
          </button>
          <button className="secondary-button" type="button" onClick={() => api.hidePetWindow()} disabled={!preferences.pet_enabled}>
            <EyeOff size={16} />
            隐藏桌宠
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">宠物与人格</h3>
        <div className="settings-form-grid sm:grid-cols-2">
          <label className="field">
            <span>当前宠物</span>
            <select
              value={preferences.active_pet_id}
              onChange={(event) => {
                const nextProfile = profiles.find((profile) => profile.id === event.target.value);
                if (nextProfile) save(preferencesForProfile(nextProfile), false);
              }}
            >
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.display_name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>桌宠名称</span>
            <input
              value={preferences.pet_name}
              onChange={(event) => setPreferences({ ...preferences, pet_name: event.target.value })}
              onBlur={() => save(preferences, false)}
            />
          </label>
        </div>

        <label className="field mt-3">
          <span>角色设定 prompt</span>
          <textarea
            className="min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal text-ink outline-none focus:border-moss"
            value={preferences.pet_persona_prompt}
            onChange={(event) => setPreferences({ ...preferences, pet_persona_prompt: event.target.value })}
            onBlur={() => save(preferences, false)}
          />
        </label>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">互动提醒</h3>
        <div className="settings-toggle-grid">
          <label className="settings-check">
            <input
              checked={preferences.pet_bubble_enabled}
              type="checkbox"
              onChange={(event) => save({ ...preferences, pet_bubble_enabled: event.target.checked }, false)}
            />
            显示气泡
          </label>
          <label className="settings-check">
            <input
              checked={preferences.proactive_ai_enabled}
              disabled={!preferences.pet_enabled}
              type="checkbox"
              onChange={(event) => save({ ...preferences, proactive_ai_enabled: event.target.checked }, false)}
            />
            主动 AI 关心
          </label>
          <label className="settings-check">
            <input
              checked={preferences.app_switch_nudge_enabled}
              disabled={!preferences.pet_enabled}
              type="checkbox"
              onChange={(event) => save({ ...preferences, app_switch_nudge_enabled: event.target.checked }, false)}
            />
            应用切换提醒
          </label>
        </div>

        <label className="field mt-3 max-w-[220px]">
          <span>停留提醒阈值（分钟）</span>
          <input
            min={5}
            max={240}
            type="number"
            value={preferences.idle_nudge_minutes}
            onChange={(event) =>
              setPreferences({
                ...preferences,
                idle_nudge_minutes: Number(event.target.value || 30),
              })
            }
            onBlur={() => save(preferences, false)}
          />
        </label>

        <div className="settings-form-grid mt-3 sm:grid-cols-2">
          <label className="settings-check">
            <input
              checked={preferences.pet_always_on_top}
              type="checkbox"
              onChange={(event) => save({ ...preferences, pet_always_on_top: event.target.checked }, false)}
            />
            桌宠置顶显示
          </label>
          <label className="field">
            <span>桌宠大小</span>
            <select
              value={preferences.pet_scale}
              onChange={(event) => save({ ...preferences, pet_scale: Number(event.target.value) }, false)}
            >
              <option value={0.8}>80%</option>
              <option value={1}>100%</option>
              <option value={1.2}>120%</option>
              <option value={1.4}>140%</option>
            </select>
          </label>
        </div>
      </section>

      <p className="settings-note">
        兼容 Codex 宠物文件夹，例如 <strong>pets/xinhua/pet.json</strong> 和 <strong>pets/xinhua/spritesheet.webp</strong>。
      </p>
      {message ? <p className="settings-status">{message}</p> : null}
    </div>
  );
}
