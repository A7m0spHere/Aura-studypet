interface PetBubbleProps {
  message: string;
  compact?: boolean;
}

export function PetBubble({ message, compact = false }: PetBubbleProps) {
  if (!message.trim()) return null;

  return (
    <div className={compact ? "pet-bubble pet-bubble-compact" : "pet-bubble"}>
      {message}
    </div>
  );
}
