import { useEffect, useMemo, useState } from "react";
import { petAssetUrl } from "../lib/api";
import { normalizePetAnimationName } from "../lib/petAnimation";
import type { PetAnimationName, PetMotionName } from "../lib/petAnimation";
import type { PetEmotion, PetProfile } from "../lib/types";

const PET_ATLAS_COLUMNS = 8;
const PET_ATLAS_ROWS = 9;
const PET_ATLAS_FRAME_WIDTH = 192;
const PET_ATLAS_FRAME_HEIGHT = 208;
const PET_ATLAS_FRAME_MS = 140;
const PET_ATLAS_REST_MS = 820;
const FALLBACK_ATLAS_FRAMES = Array.from({ length: PET_ATLAS_COLUMNS }, (_, index) => index);

const ATLAS_ROWS_BY_ANIMATION: Record<PetMotionName, number> = {
  idle: 0,
  walk_right: 2,
  walk_left: 1,
  greet: 3,
  jump: 4,
  happy: 5,
  thinking: 6,
  scold: 7,
  talk: 8,
};

const SPRITE_EMOTION_FALLBACK: Record<PetMotionName, PetEmotion[]> = {
  idle: ["idle"],
  walk_right: ["walk_right", "studying", "idle"],
  walk_left: ["walk_left", "studying", "idle"],
  greet: ["greet", "interact", "idle"],
  jump: ["jump", "interact", "idle"],
  happy: ["happy", "ended", "idle"],
  thinking: ["thinking", "studying", "idle"],
  scold: ["scold", "nudge", "idle"],
  talk: ["talk", "chat", "idle"],
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
  const motion = normalizePetAnimationName(animation);
  const spriteCandidates = SPRITE_EMOTION_FALLBACK[motion] ?? ["idle"];
  const spriteEmotion = spriteCandidates.find((emotion) => profile?.sprites?.[emotion]);
  const spritePath =
    (spriteEmotion ? profile?.sprites?.[spriteEmotion] : undefined) ||
    profile?.sprites?.[profile.default_emotion] ||
    profile?.sprites?.idle ||
    profile?.spritesheet_path ||
    "";
  const staticSprite = Boolean(
    (spriteEmotion ? profile?.sprites?.[spriteEmotion] : undefined) ||
      profile?.sprites?.[profile?.default_emotion ?? "idle"] ||
      profile?.sprites?.idle,
  );
  const spriteUrl = spritePath ? petAssetUrl(spritePath) : "";
  const spriteScale = profile?.sprite_scale ?? 1;
  const atlasRow = profile?.atlas_motion_rows?.[motion] ?? ATLAS_ROWS_BY_ANIMATION[motion] ?? 0;
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

  if (!spriteUrl) return null;

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
