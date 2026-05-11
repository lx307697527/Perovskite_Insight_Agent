import React from 'react';
import type { QASSEEvent } from '../types';

interface AnswerCardProps {
  question: string;
  events: QASSEEvent[];
  onPageClick?: (page: number) => void;
}

const AnswerCard: React.FC<AnswerCardProps> = ({ question, events, onPageClick }) => {
  // Collect streamed text
  const answerText = events
    .filter((e) => e.type === 'content' && e.text)
    .map((e) => e.text)
    .join('');

  // Get source info
  const sourceEvent = events.find((e) => e.type === 'source');
  const doneEvent = events.find((e) => e.type === 'done');
  const errorEvent = events.find((e) => e.type === 'error');

  const isStreaming = events.length > 0 && !doneEvent && !errorEvent;
  const isDone = !!doneEvent;
  const isError = !!errorEvent;

  return (
    <div className="glass-card rounded-2xl border border-white/5 overflow-hidden animate-fade-in">
      {/* Question */}
      <div className="px-5 py-3 bg-brand-500/5 border-b border-white/5">
        <p className="text-sm font-medium text-brand-300">{question}</p>
      </div>

      {/* Answer */}
      <div className="px-5 py-4">
        {isError ? (
          <p className="text-sm text-red-400">{errorEvent?.message || '回答生成失败'}</p>
        ) : answerText ? (
          <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
            {answerText}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-slate-500">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs">正在检索并生成回答...</span>
          </div>
        ) : null}

        {/* Source citation */}
        {sourceEvent && isDone && (
          <div className="mt-4 pt-3 border-t border-white/5">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-brand-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400 mb-1">来源定位</p>
                <button
                  type="button"
                  onClick={() => sourceEvent.page && onPageClick?.(sourceEvent.page)}
                  disabled={!sourceEvent.page || !onPageClick}
                  className="text-xs text-brand-400 hover:text-brand-300 disabled:text-slate-500 disabled:cursor-default transition-colors"
                >
                  {sourceEvent.page ? `第 ${sourceEvent.page} 页` : '未知页码'}
                  {onPageClick && sourceEvent.page && (
                    <span className="ml-1 text-[10px] text-slate-500">点击跳转</span>
                  )}
                </button>
                {sourceEvent.excerpt && (
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    "{sourceEvent.excerpt}"
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Cost info */}
        {doneEvent && (doneEvent.cost || doneEvent.tokens) && (
          <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-600">
            {doneEvent.cost !== undefined && <span>${doneEvent.cost.toFixed(4)}</span>}
            {doneEvent.tokens !== undefined && <span>{doneEvent.tokens} tokens</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnswerCard;
