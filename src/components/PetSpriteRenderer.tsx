import { useEffect, useMemo, useState } from "react";
import { petAssetUrl } from "../lib/api";
import type { PetAnimationName } from "../lib/petAnimation";
import type { PetEmotion, PetProfile } from "../lib/types";

const PET_ATLAS_COLUMNS = 8;
const PET_ATLAS_ROWS = 9;
const PET_ATLAS_FRAME_WIDTH = 192;
const PET_ATLAS_FRAME_HEIGHT = 208;
const PET_ATLAS_FRAME_MS = 140;
const PET_ATLAS_REST_MS = 820;
const FALLBACK_ATLAS_FRAMES = Array.from({ length: PET_ATLAS_COLUMNS }, (_, index) => index);

const ATLAS_ROWS_BY_ANIMATION: Record<PetAnimationName, number> = {
  idle: 0,
  studying: 1,
  thinking: 2,
  happy: 3,
  nudge: 4,
  ended: 5,
  interact: 6,
  chat: 7,
  dragging: 0,
  dropped: 0,
};

const ANIMATION_EMOTION_FALLBACK: Record<PetAnimationName, PetEmotion> = {
  idle: "idle",
  studying: "studying",
  thinking: "thinking",
  happy: "happy",
  nudge: "nudge",
  ended: "ended",
  interact: "interact",
  chat: "chat",
  dragging: "idle",
  dropped: "idle",
};

interface PetSpriteRendererProps {
  animation: PetAnimationName;
  petName: string;
  profile?: PetProfile;
  dragging?: boolean;
  dropped?: boolean;
}

export function PetSpriteRenderer({
  animation,
  petName,
  profile,
  dragging = false,
  dropped = false,
}: PetSpriteRendererProps) {
  const [atlasFrame, setAtlasFrame] = useState(0);
  const emotion = ANIMATION_EMOTION_FALLBACK[animation] ?? "idle";
  const spritePath =
    profile?.sprites?.[emotion] ||
    profile?.sprites?.[profile.default_emotion] ||
    profile?.sprites?.idle ||
    profile?.spritesheet_path ||
    "";
  const staticSprite = Boolean(
    profile?.sprites?.[emotion] ||
      profile?.sprites?.[profile?.default_emotion ?? "idle"] ||
      profile?.sprites?.idle,
  );
  const spriteUrl = spritePath ? petAssetUrl(spritePath) : "";
  const spriteScale = profile?.sprite_scale ?? 1;
  const atlasRow = ATLAS_ROWS_BY_ANIMATION[animation] ?? 0;
  const atlasFrames = useMemo(() => {
    if (staticSprite) return [0];
    const rows = profile?.atlas?.rows ?? [];
    const rowFrames = rows[atlasRow]?.length ? rows[atlasRow] : rows[0];
    return rowFrames?.length ? rowFrames : FALLBACK_ATLAS_FRAMES;
  }, [atlasRow, profile?.atlas?.rows, staticSprite]);

  useEffect(() => {
    if (!spriteUrl || staticSprite) {
      setAtlasFrame(0);
      return;
    }

    let frameIndex = 0;
    let timer: number | undefined;
    setAtlasFrame(atlasFrames[0] ?? 0);

    function schedule(delay: number) {
      timer = window.setTimeout(() => {
        frameIndex = frameIndex >= atlasFrames.length - 1 ? 0 : frameIndex + 1;
        const nextFrame = atlasFrames[frameIndex] ?? 0;
        setAtlasFrame(nextFrame);
        schedule(frameIndex === 0 ? PET_ATLAS_REST_MS : PET_ATLAS_FRAME_MS);
      }, delay);
    }

    schedule(PET_ATLAS_FRAME_MS);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [animation, atlasFrames, profile?.id, spriteUrl, staticSprite]);

  const style = useMemo(() => {
    if (!spriteUrl) return undefined;
    const transform = `scale(${spriteScale})`;
    const columns = profile?.atlas?.columns || PET_ATLAS_COLUMNS;
    const rowCount = profile?.atlas?.row_count || PET_ATLAS_ROWS;
    const frameWidth = profile?.atlas?.frame_width || PET_ATLAS_FRAME_WIDTH;
    const frameHeight = profile?.atlas?.frame_height || PET_ATLAS_FRAME_HEIGHT;
    if (staticSprite) {
      return {
        backgroundImage: `url("${spriteUrl}")`,
        transform,
      };
    }
    return {
      backgroundImage: `url("${spriteUrl}")`,
      backgroundPosition: `-${atlasFrame * frameWidth}px -${atlasRow * frameHeight}px`,
      backgroundSize: `${columns * frameWidth}px ${rowCount * frameHeight}px`,
      transform,
    };
  }, [atlasFrame, atlasRow, profile?.atlas, spriteScale, spriteUrl, staticSprite]);

  if (!spriteUrl) return <DefaultAuraPet />;

  return (
    <div
      className={[
        "pet-sprite",
        staticSprite ? "pet-sprite-static" : "",
        dragging ? "pet-sprite-dragging" : "",
        dropped ? "pet-sprite-dropped" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={petName}
      style={style}
    />
  );
}

function DefaultAuraPet() {
  return (
    <svg className="default-aura-pet" viewBox="0 0 180 170" role="img" aria-label="Aura">
      <ellipse cx="90" cy="154" rx="48" ry="9" fill="#20302b" opacity="0.12" />
      <path d="M66 20c8-12 36-12 48 0" fill="none" stroke="#f5c84b" strokeWidth="8" strokeLinecap="round" />
      <path
        d="M45 86c0-33 20-56 45-56s45 23 45 56c0 34-18 61-45 61S45 120 45 86Z"
        fill="#f6f1e9"
        stroke="#20302b"
        strokeWidth="5"
      />
      <path d="M57 82c-15 8-22 20-20 31 12 0 21-5 27-15" fill="#f3a7a0" stroke="#20302b" strokeWidth="4" />
      <path d="M123 82c15 8 22 20 20 31-12 0-21-5-27-15" fill="#9fd0c2" stroke="#20302b" strokeWidth="4" />
      <circle cx="73" cy="82" r="5" fill="#20302b" />
      <circle cx="107" cy="82" r="5" fill="#20302b" />
      <path d="M80 103c7 6 14 6 21 0" fill="none" stroke="#20302b" strokeWidth="4" strokeLinecap="round" />
      <path d="M69 126c13 7 29 7 42 0" fill="none" stroke="#d94c3d" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
