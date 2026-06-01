import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

export function MetricTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <section className="metric-tile">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="metric-label">{label}</p>
          <p className="metric-value">{value}</p>
          <p className="metric-hint">{hint}</p>
        </div>
        <div className="metric-icon">{icon}</div>
      </div>
    </section>
  );
}

export function FoldPanel({
  title,
  defaultOpen,
  tone = "default",
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  tone?: "default" | "moss";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <details className={tone === "moss" ? "fold-panel fold-panel-moss" : "fold-panel"} open={open}>
      <summary
        className="fold-panel-summary"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span>{title}</span>
        <ChevronDown size={17} />
      </summary>
      <div className="fold-panel-body">{children}</div>
    </details>
  );
}

export function AuraMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-6 w-6">
      <circle cx="16" cy="17" r="11" fill="currentColor" opacity="0.96" />
      <path d="M12 7.5c1.2-2 3.1-2.8 5.2-2.2" fill="none" stroke="#2f6f5e" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M7.5 17.5h5l2.1-4.2 3.3 8.1 2.5-5.2h4.1"
        fill="none"
        stroke="#f6f1e9"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 11.2v5.5l3.5 2.3" fill="none" stroke="#20302b" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
