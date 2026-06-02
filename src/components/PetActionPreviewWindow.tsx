import { Play, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { DEFAULT_PET_PREFERENCES } from "../lib/defaults";
import type { PetMotionName } from "../lib/petAnimation";
import type { PetPreferences, PetProfile } from "../lib/types";
import { PetSpriteRenderer } from "./PetSpriteRenderer";

const previewActions: Array<{
  id: PetMotionName;
  label: string;
  description: string;
}> = [
  { id: "idle", label: "待机", description: "静止呼吸与默认状态" },
  { id: "walk_right", label: "向右跑", description: "向右移动时的循环动作" },
  { id: "walk_left", label: "向左跑", description: "向左移动时的循环动作" },
  { id: "greet", label: "挥手", description: "点击互动与打招呼" },
  { id: "jump", label: "跳跃", description: "轻快反馈或二次点击" },
  { id: "happy", label: "完成", description: "完成记录或正向反馈" },
  { id: "thinking", label: "等待", description: "思考、生成或处理中" },
  { id: "scold", label: "失败/提醒", description: "失败、打断或提醒状态" },
  { id: "talk", label: "审阅", description: "对话、总结或复盘时" },
];

interface PetActionPreviewPanelProps {
  onClose?: () => void;
}

export function PetActionPreviewPanel({ onClose }: PetActionPreviewPanelProps = {}) {
  const [preferences, setPreferences] = useState<PetPreferences>(DEFAULT_PET_PREFERENCES);
  const [profiles, setProfiles] = useState<PetProfile[]>([]);
  const [activeAction, setActiveAction] = useState<PetMotionName>("idle");
  const [replayKey, setReplayKey] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [nextPreferences, nextProfiles] = await Promise.all([
        api.getPetPreferences(),
        api.getPetProfiles(),
      ]);
      setPreferences(nextPreferences);
      setProfiles(nextProfiles);
      setReplayKey((current) => current + 1);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === preferences.active_pet_id),
    [profiles, preferences.active_pet_id],
  );
  const activeActionMeta = previewActions.find((action) => action.id === activeAction) ?? previewActions[0];
  const previewPetName = activeProfile ? preferences.pet_name || activeProfile.display_name : preferences.pet_name;
  const emptyMessage = loading
    ? "正在读取桌宠..."
    : profiles.length
      ? "当前选择的桌宠不在可用列表中"
      : "还没有可预览的桌宠";

  function preview(action: PetMotionName) {
    setActiveAction(action);
    setReplayKey((current) => current + 1);
  }

  return (
    <main className="pet-preview-shell">
      <section className="pet-preview-panel pet-preview-stage-panel">
        <div className="pet-preview-heading">
          <div>
            <p className="panel-eyebrow">Pet motion lab</p>
            <h1>桌宠动作预览</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="secondary-button" type="button" onClick={load} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button>
            {onClose ? (
              <button className="icon-button" type="button" onClick={onClose} aria-label="关闭动作预览">
                <X size={18} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="pet-preview-stage" aria-label="桌宠动作预览舞台">
          {activeProfile ? (
            <div className="pet-preview-sprite-wrap" data-testid="pet-preview-sprite-wrap">
              <PetSpriteRenderer
                key={`${activeProfile.id}-${activeAction}-${replayKey}`}
                animation={activeAction}
                petName={previewPetName}
                profile={activeProfile}
              />
            </div>
          ) : (
            <div className="pet-preview-empty">
              <Sparkles size={22} />
              <p>{emptyMessage}</p>
            </div>
          )}
        </div>

        <div className="pet-preview-caption">
          <div>
            <span>当前桌宠</span>
            <strong>{activeProfile?.display_name ?? "未导入桌宠"}</strong>
          </div>
          <div>
            <span>当前动作</span>
            <strong>{activeActionMeta.label}</strong>
          </div>
        </div>
        {message ? <p className="settings-status">{message}</p> : null}
      </section>

      <aside className="pet-preview-panel pet-preview-action-panel">
        <div className="pet-preview-action-head">
          <p className="panel-eyebrow">Actions</p>
          <h2>选择要预览的动作</h2>
        </div>
        <div className="pet-preview-action-list">
          {previewActions.map((action) => (
            <button
              className={
                activeAction === action.id
                  ? "pet-preview-action pet-preview-action-active"
                  : "pet-preview-action"
              }
              disabled={!activeProfile}
              key={action.id}
              onClick={() => preview(action.id)}
              type="button"
            >
              <span className="pet-preview-action-icon">
                {activeAction === action.id ? <Play size={14} fill="currentColor" /> : null}
              </span>
              <span className="pet-preview-action-copy">
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>
    </main>
  );
}

export function PetActionPreviewWindow() {
  return <PetActionPreviewPanel />;
}
