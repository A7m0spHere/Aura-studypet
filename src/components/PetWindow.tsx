import { listen } from "@tauri-apps/api/event";
import { currentMonitor, cursorPosition, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from "react";
import { api } from "../lib/api";
import { DEFAULT_PET_PREFERENCES } from "../lib/defaults";
import type { PetAnimationName } from "../lib/petAnimation";
import { usePetController } from "../lib/petAnimation";
import type { DashboardState, PetEmotion, PetPreferences, PetProfile } from "../lib/types";
import { PetBubble } from "./PetBubble";
import { PetSpriteRenderer } from "./PetSpriteRenderer";

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

interface PointerTrace {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  dragged: boolean;
  direction?: "left" | "right";
}

const POINTER_DRAG_THRESHOLD = 4;
const POINTER_DIRECTION_THRESHOLD = 3;

function messageForStatus(status?: string) {
  if (status === "studying") return "我在记录这段专注时间。";
  if (status === "ended") return "这段记录下来了，要不要让我总结一下？";
  return "今天还没进入状态，要不要开一段？";
}

function animationForStatus(status?: string): PetAnimationName {
  if (status === "ended") return "happy";
  return "idle";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function PetWindow() {
  const [preferences, setPreferences] = useState<PetPreferences>(DEFAULT_PET_PREFERENCES);
  const [profiles, setProfiles] = useState<PetProfile[]>([]);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [bubble, setBubble] = useState(messageForStatus("idle"));
  const [bubbleHovered, setBubbleHovered] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDropped, setIsDropped] = useState(false);
  const clickTimerRef = useRef<number | undefined>(undefined);
  const dragSessionRef = useRef<DragSession | null>(null);
  const pointerTraceRef = useRef<PointerTrace | null>(null);
  const suppressNextClickRef = useRef(false);
  const nextClickAnimationRef = useRef<"greet" | "jump">("greet");
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
        showBubble(event.payload);
        return;
      }
      showBubble(event.payload.message, event.payload.emotion);
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, [petDispatch]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== undefined) window.clearTimeout(clickTimerRef.current);
      if (dropTimerRef.current !== undefined) window.clearTimeout(dropTimerRef.current);
      if (dragFrameRef.current !== undefined) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === preferences.active_pet_id),
    [profiles, preferences.active_pet_id],
  );

  function showBubble(message: string, emotion?: PetEmotion) {
    if (!message.trim()) return;
    setBubble(message);
    if (emotion) petDispatch({ type: "bubble.show", animation: emotion });
  }

  useEffect(() => {
    if (!bubble || bubbleHovered) return;
    const timer = window.setTimeout(() => setBubble(""), 4000);
    return () => window.clearTimeout(timer);
  }, [bubble, bubbleHovered]);

  useEffect(() => {
    if (bubble || chatSending) return;
    petDispatch({ type: "animation.play", animation: defaultAnimation, mode: "loop" });
  }, [bubble, chatSending, defaultAnimation, petDispatch]);

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
    pointerTraceRef.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      dragged: false,
    };

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
    } catch {
      try {
        await api.dragPetWindow();
      } catch {
        // Some test/browser contexts do not expose native dragging.
      }
    }
  }

  function trackPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const trace = pointerTraceRef.current;
    if (!trace || trace.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.screenX - trace.startX, event.screenY - trace.startY);
    if (!trace.dragged && distance > POINTER_DRAG_THRESHOLD) {
      trace.dragged = true;
    }
    if (!trace.dragged) return;

    const deltaX = event.screenX - trace.lastX;
    if (Math.abs(deltaX) >= POINTER_DIRECTION_THRESHOLD) {
      const direction = deltaX < 0 ? "left" : "right";
      if (trace.direction !== direction) {
        const actionType = trace.direction ? "drag.move" : "drag.start";
        trace.direction = direction;
        petDispatch({ type: actionType, direction });
      }
      trace.lastX = event.screenX;
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLElement>) {
    trackPointerMove(event);
    const trace = pointerTraceRef.current;
    if (trace?.pointerId === event.pointerId) {
      suppressNextClickRef.current = trace.dragged;
      pointerTraceRef.current = null;
    }
    endDrag(event.pointerId);
  }

  async function openContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    try {
      const window = getCurrentWindow();
      const [position, size] = await Promise.all([window.outerPosition(), window.outerSize()]);
      await api.showPetMenu(position.x + size.width + 8, position.y + 18);
    } catch {
      // The pet menu is only available inside the Tauri app.
    }
  }

  function interact() {
    if (dragSessionRef.current) return;
    const animation = nextClickAnimationRef.current;
    nextClickAnimationRef.current = animation === "greet" ? "jump" : "greet";
    petDispatch({ type: "animation.play", animation, mode: "once" });
    showBubble(activeProfile?.bubble_lines?.[0] || messageForStatus(dashboard?.session_status), animation);
  }

  function scheduleInteract() {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (dragSessionRef.current || chatOpen) return;
    if (clickTimerRef.current !== undefined) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = undefined;
      interact();
    }, 180);
  }

  function openChat() {
    if (clickTimerRef.current !== undefined) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = undefined;
    }
    setChatOpen(true);
  }

  function stopChatEvent(event: SyntheticEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function closeChat(event: SyntheticEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setChatOpen(false);
  }

  async function sendPetChat() {
    const content = chatInput.trim();
    if (!content || chatSending) return;
    setChatSending(true);
    setChatInput("");
    showBubble(content, "thinking");
    try {
      const reply = await api.chatWithAura(content);
      showBubble(reply.content, "talk");
    } catch (error) {
      showBubble(String(error), "thinking");
    } finally {
      setChatSending(false);
    }
  }

  if (!preferences.pet_enabled) {
    return <main className="pet-window pet-window-empty" />;
  }

  return (
    <main className="pet-window" style={{ "--pet-scale": preferences.pet_scale } as CSSProperties}>
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
          trackPointerMove(event);
          if (dragSessionRef.current?.pointerId === event.pointerId) {
            scheduleDragMove(event.pointerId);
          }
        }}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onClick={scheduleInteract}
        onDoubleClick={openChat}
        onContextMenu={openContextMenu}
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
        <div onMouseEnter={() => setBubbleHovered(true)} onMouseLeave={() => setBubbleHovered(false)}>
          {bubble ? <PetBubble message={bubble} compact /> : null}
        </div>
      ) : null}
      {chatOpen ? (
        <form
          className="pet-chat"
          onPointerDown={stopChatEvent}
          onClick={stopChatEvent}
          onDoubleClick={stopChatEvent}
          onContextMenu={stopChatEvent}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            sendPetChat();
          }}
        >
          <button className="pet-chat-close" type="button" onClick={closeChat} aria-label="关闭聊天框">
            <X size={13} />
          </button>
          <input
            autoFocus
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setChatOpen(false);
            }}
            placeholder="和 Aura 说点什么"
          />
          <button type="submit" disabled={chatSending || !chatInput.trim()}>
            {chatSending ? "..." : "发送"}
          </button>
        </form>
      ) : null}
    </main>
  );
}
