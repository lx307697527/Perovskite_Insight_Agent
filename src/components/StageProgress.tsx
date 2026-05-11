import React from 'react';
import type { SSEEvent } from '../types';

interface StageProgressProps {
  event: SSEEvent | null;
  onCancel?: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  downloading: '下载 PDF',
  parsing: '解析文档',
  analyzing_si: '分析 SI 附件',
  extracting: 'AI 提取数据',
  ai_analyzing: 'AI 分析主文',
  ai_analyzing_si: 'AI 分析 SI',
  screening: 'Stage1 筛选',
  saving: '保存结果',
};

const STAGE_ORDER = ['downloading', 'parsing', 'analyzing_si', 'screening', 'ai_analyzing', 'ai_analyzing_si', 'extracting', 'saving'];

function formatETA(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `~${m}m${s > 0 ? `${s}s` : ''}`;
}

const StageProgress: React.FC<StageProgressProps> = ({ event, onCancel }) => {
  if (!event) return null;

  const progress = event.progress ?? 0;
  const status = event.status || '';

  // Support both legacy number progress and new StageProgressInfo object
  let progressPct = 0;
  let currentLabel = '';
  let etaText = '';
  let stages: { name: string; label: string; weight: number; status: string }[] = [];

  if (typeof progress === 'object' && progress !== null) {
    // New format from progress.py
    const pInfo = progress as {
      progress: number;
      current_label: string;
      eta_seconds: number | null;
      stages: { name: string; label: string; weight: number; status: string }[];
    };
    progressPct = pInfo.progress;
    currentLabel = pInfo.current_label;
    etaText = formatETA(pInfo.eta_seconds);
    stages = pInfo.stages || [];
  } else {
    progressPct = typeof progress === 'number' ? progress : 0;
    currentLabel = STAGE_LABELS[status] || status;
  }

  // Determine completed stages for the legacy indicator
  const currentIdx = STAGE_ORDER.indexOf(status);
  const completedStages = STAGE_ORDER.slice(0, currentIdx >= 0 ? currentIdx : 0);

  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';
  const isCached = status === 'cached';

  return (
    <div className="glass-card rounded-2xl p-5 border-white/5">
      {/* Progress header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-300">
          {isCompleted ? '完成' : isCached ? '已缓存' : isFailed ? '失败' : currentLabel}
        </span>
        <div className="flex items-center gap-2">
          {etaText && !isCompleted && !isFailed && (
            <span className="text-[10px] text-slate-500">剩余 {etaText}</span>
          )}
          <span className="text-xs text-slate-500 font-mono">{progressPct}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isFailed ? 'bg-red-500' : isCompleted || isCached ? 'bg-emerald-500' : 'bg-brand-500'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Stage indicators — use new stages array if available */}
      {!isCompleted && !isCached && !isFailed && (
        stages.length > 0 ? (
          <div className="flex items-center gap-1 mb-3">
            {stages.map((stage) => (
              <div
                key={stage.name}
                className={`flex-1 h-1 rounded-full transition-colors ${
                  stage.status === 'completed' ? 'bg-brand-500'
                    : stage.status === 'active' ? 'bg-brand-500/50 animate-pulse'
                      : 'bg-white/10'
                }`}
                title={stage.label}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1 mb-3">
            {STAGE_ORDER.filter((s) => STAGE_LABELS[s]).map((stage) => {
              const isDone = completedStages.includes(stage);
              const isActive = stage === status;
              return (
                <div
                  key={stage}
                  className={`flex-1 h-1 rounded-full transition-colors ${
                    isDone ? 'bg-brand-500' : isActive ? 'bg-brand-500/50' : 'bg-white/10'
                  }`}
                  title={STAGE_LABELS[stage]}
                />
              );
            })}
          </div>
        )
      )}

      {/* Message */}
      {event.message && (
        <p className="text-[11px] text-slate-500 mb-2">{event.message}</p>
      )}

      {/* Error */}
      {isFailed && event.error && (
        <p className="text-[11px] text-red-400 mb-2">{event.error}</p>
      )}

      {/* Cancel button */}
      {onCancel && !isCompleted && !isCached && !isFailed && (
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
        >
          取消
        </button>
      )}
    </div>
  );
};

export default StageProgress;
