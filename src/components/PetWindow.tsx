import { listen } from "@tauri-apps/api/event";
import { currentMonitor, cursorPosition, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../lib/api";
import type { PetAnimationName } from "../lib/petAnimation";
import { usePetController } from "../lib/petAnimation";
import type { DashboardState, PetEmotion, PetPreferences, PetProfile } from "../lib/types";
import { PetBubble } from "./PetBubble";
import { PetSpriteRenderer } from "./PetSpriteRenderer";

const fallbackPreferences: PetPreferences = {
  pet_enabled: false,
  pet_name: "Aura",
  pet_persona_prompt: "",
  pet_bubble_enabled: true,
  proactive_ai_enabled: false,
  idle_nudge_minutes: 30,
  app_switch_nudge_enabled: true,
  active_pet_id: "default-aura",
  first_pet_enable_seen: false,
};

interface PetBubbleEvent {
  message: string;
  emotion?: PetEmotion;
}

interface DragSession {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function messageForStatus(status?: string) {
  if (status === "studying") return "我在记录这段专注时间。";
  if (status === "ended") return "这段记录下来了，要不要让我总结一下？";
  return "今天还没进入状态，要不要开一段？";
}

function animationForStatus(status?: string): PetAnimationName {
  if (status === "studying") return "studying";
  if (status === "ended") return "ended";
  return "idle";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function PetWindow() {
  const [preferences, setPreferences] = useState<PetPreferences>(fallbackPreferences);
  const [profiles, setProfiles] = useState<PetProfile[]>([]);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [bubble, setBubble] = useState(messageForStatus("idle"));
  const [isDragging, setIsDragging] = useState(false);
  const [isDropped, setIsDropped] = useState(false);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragFrameRef = useRef<number | undefined>(undefined);
  const dropTimerRef = useRef<number | undefined>(undefined);

  const defaultAnimation = animationForStatus(dashboard?.session_status);
  const { pet, petDispatch } = usePetController(defaultAnimation);

  async function refreshPetState() {
    try {
      const nextPreferences = await api.getPetPreferences();
      setPreferences(nextPreferences);
      if (!nextPreferences.pet_enabled) return;
      const [nextDashboard, nextProfiles] = await Promise.all([
        api.getCurrentStatus(),
        api.getPetProfiles(),
      ]);
      setDashboard(nextDashboard);
      setProfiles(nextProfiles);
      if (nextPreferences.pet_bubble_enabled) {
        setBubble((current) => current || messageForStatus(nextDashboard.session_status));
      }
    } catch {
      setBubble("Aura 正在整理状态，稍等一下。");
    }
  }

  useEffect(() => {
    refreshPetState();
    const timer = window.setInterval(refreshPetState, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string | PetBubbleEvent>("pet-bubble", (event) => {
      if (typeof event.payload === "string") {
        if (event.payload.trim()) setBubble(event.payload);
        return;
      }
      if (event.payload.message.trim()) setBubble(event.payload.message);
      petDispatch({ type: "bubble.show", animation: event.payload.emotion });
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, [petDispatch]);

  useEffect(() => {
    if (preferences.pet_bubble_enabled) {
      setBubble(messageForStatus(dashboard?.session_status));
    }
  }, [dashboard?.session_status, preferences.pet_bubble_enabled]);

  useEffect(() => {
    return () => {
      if (dropTimerRef.current !== undefined) window.clearTimeout(dropTimerRef.current);
      if (dragFrameRef.current !== undefined) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === preferences.active_pet_id),
    [profiles, preferences.active_pet_id],
  );

  function endDrag(pointerId?: number, dropped = true) {
    const session = dragSessionRef.current;
    if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;
    dragSessionRef.current = null;
    if (dragFrameRef.current !== undefined) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = undefined;
    }
    setIsDragging(false);
    setIsDropped(dropped);
    petDispatch({ type: "drag.end" });
    if (dropTimerRef.current !== undefined) window.clearTimeout(dropTimerRef.current);
    if (dropped) {
      dropTimerRef.current = window.setTimeout(() => setIsDropped(false), 220);
    }
  }

  async function fallBackToNativeDrag(pointerId: number) {
    endDrag(pointerId, false);
    try {
      await api.dragPetWindow();
    } catch {
      // Some test/browser contexts do not expose native dragging.
    }
  }

  async function moveWindow(screenX: number, screenY: number) {
    const session = dragSessionRef.current;
    if (!session) return;
    const x = clamp(Math.round(screenX - session.offsetX), session.minX, session.maxX);
    const y = clamp(Math.round(screenY - session.offsetY), session.minY, session.maxY);
    try {
      await getCurrentWindow().setPosition(new PhysicalPosition(x, y));
    } catch {
      await fallBackToNativeDrag(session.pointerId);
    }
  }

  function scheduleDragMove(pointerId: number) {
    if (dragFrameRef.current !== undefined) return;
    dragFrameRef.current = window.requestAnimationFrame(async () => {
      dragFrameRef.current = undefined;
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== pointerId) return;
      try {
        const cursor = await cursorPosition();
        await moveWindow(cursor.x, cursor.y);
      } catch {
        await fallBackToNativeDrag(pointerId);
      }
    });
  }

  async function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if ((event.button ?? 0) !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    try {
      const window = getCurrentWindow();
      const [position, size, monitor, cursor] = await Promise.all([
        window.outerPosition(),
        window.outerSize(),
        currentMonitor(),
        cursorPosition(),
      ]);
      const workArea = monitor?.workArea;
      const minX = workArea?.position.x ?? 0;
      const minY = workArea?.position.y ?? 0;
      const maxX = (workArea ? workArea.position.x + workArea.size.width : position.x + 2000) - size.width;
      const maxY = (workArea ? workArea.position.y + workArea.size.height : position.y + 1600) - size.height;

      dragSessionRef.current = {
        pointerId: event.pointerId,
        offsetX: cursor.x - position.x,
        offsetY: cursor.y - position.y,
        minX,
        minY,
        maxX: Math.max(minX, maxX),
        maxY: Math.max(minY, maxY),
      };
      setIsDragging(true);
      setIsDropped(false);
      petDispatch({ type: "drag.start" });
    } catch {
      try {
        await api.dragPetWindow();
      } catch {
        // Some test/browser contexts do not expose native dragging.
      }
    }
  }

  if (!preferences.pet_enabled) {
    return <main className="pet-window pet-window-empty" />;
  }

  return (
    <main className="pet-window">
      <button className="pet-close" aria-label="隐藏桌宠" onClick={() => api.hidePetWindow()}>
        <X size={14} />
      </button>
      <section
        className={[
          "pet-stage",
          isDragging ? "pet-stage-dragging" : "",
          isDropped ? "pet-stage-dropped" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={preferences.pet_name}
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          if (dragSessionRef.current?.pointerId === event.pointerId) {
            scheduleDragMove(event.pointerId);
          }
        }}
        onPointerUp={(event) => endDrag(event.pointerId)}
        onPointerCancel={(event) => endDrag(event.pointerId)}
      >
        <PetSpriteRenderer
          animation={pet.animation.name}
          petName={preferences.pet_name}
          profile={activeProfile}
          dragging={isDragging}
          dropped={isDropped}
        />
      </section>
      {preferences.pet_bubble_enabled ? (
        <PetBubble message={bubble || messageForStatus(dashboard?.session_status)} compact />
      ) : null}
    </main>
  );
}
