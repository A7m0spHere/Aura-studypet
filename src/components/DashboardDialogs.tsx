import { ShieldCheck, Trash2 } from "lucide-react";
import { formatDuration } from "../lib/api";
import type { DailyReport, ExportFormat } from "../lib/types";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function groupReportsByDate(reports: DailyReport[]) {
  const groups = new Map<string, DailyReport[]>();
  for (const report of reports) {
    const key = formatDate(report.ended_at || report.started_at);
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  return Array.from(groups.entries());
}

function summaryExcerpt(summary: string) {
  const compact = summary.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
}

export function HistoryDialog({
  reports,
  onClose,
  onRefresh,
  onDelete,
  onExport,
}: {
  reports: DailyReport[];
  onClose: () => void;
  onRefresh: () => void;
  onDelete: (reportId: number) => void;
  onExport: (reportId: number, format: ExportFormat) => void;
}) {
  const grouped = groupReportsByDate(reports);

  return (
    <div className="dialog-backdrop">
      <section className="history-dialog dialog-surface">
        <header className="dialog-header">
          <div>
            <h2 className="text-lg font-semibold">历史日报</h2>
            <p className="text-sm text-ink/60">按日期归档最近 30 条本地记录</p>
          </div>
          <div className="flex gap-2">
            <button className="secondary-button" onClick={onRefresh}>
              刷新
            </button>
            <button className="secondary-button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>
        <div className="dialog-scroll space-y-3">
          {grouped.length ? (
            grouped.map(([dateLabel, items]) => (
              <section className="space-y-3" key={dateLabel}>
                <h3 className="text-sm font-semibold text-ink/70">{dateLabel}</h3>
                {items.map((report) => (
                  <article className="report-card" key={report.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="font-semibold">专注日报</h4>
                        <p className="text-sm text-ink/60">
                          {formatTime(report.started_at)} - {formatTime(report.ended_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="quiet-pill">记录 {formatDuration(report.total_seconds)}</span>
                        <span className="quiet-pill">专注 {report.focus_score}</span>
                        <span className="quiet-pill">番茄 {report.pomodoro_completed}</span>
                        <button className="secondary-button compact-button" onClick={() => onExport(report.id, "markdown")} type="button">
                          导出 MD
                        </button>
                        <button className="secondary-button compact-button" onClick={() => onExport(report.id, "txt")} type="button">
                          导出 TXT
                        </button>
                        <button className="danger-button compact-button" onClick={() => onDelete(report.id)} type="button">
                          <Trash2 size={14} />
                          删除
                        </button>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-ink/70">
                      Top 应用：
                      {report.app_usage.length
                        ? report.app_usage
                            .slice(0, 3)
                            .map((item) => `${item.app_name} ${formatDuration(item.seconds)}`)
                            .join("、")
                        : "暂无采样数据"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-ink/75">
                      {report.ai_summary ? summaryExcerpt(report.ai_summary) : "尚未生成 AI 总结。"}
                    </p>
                  </article>
                ))}
              </section>
            ))
          ) : (
            <p className="empty-note">
              还没有历史日报。结束一次专注记录后，这里会自动出现记录。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export function PrivacyDialog({
  accepted,
  onAccept,
  onClose,
}: {
  accepted: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <section className="privacy-dialog dialog-surface">
        <header className="dialog-header">
          <div className="flex items-center gap-3">
            <div className="dialog-icon">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">隐私说明</h2>
              <p className="text-sm text-ink/60">第一次使用前建议先看完这段说明</p>
            </div>
          </div>
        </header>
        <div className="space-y-3 p-5 text-sm leading-6 text-ink/75">
          <p>Aura 会在专注/工作记录中统计当前前台应用、窗口标题、应用使用时长和键鼠活跃数量。</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>不记录具体按键，也不记录输入内容。</li>
            <li>不记录鼠标坐标，不截图，不录屏。</li>
            <li>数据默认保存在本机 SQLite 数据库。</li>
            <li>只有主动生成 AI 总结、继续聊天，或启用桌宠主动 AI 关心时，摘要数据才会发送到你配置的 API。</li>
          </ul>
        </div>
        <footer className="dialog-footer">
          {accepted ? (
            <button className="secondary-button" onClick={onClose}>
              关闭
            </button>
          ) : (
            <>
              <button className="secondary-button" onClick={onClose}>
                稍后再看
              </button>
              <button className="primary-button" onClick={onAccept}>
                我知道了
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
