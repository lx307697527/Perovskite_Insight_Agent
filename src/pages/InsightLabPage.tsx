import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAppStore } from '../store';
import * as qaApi from '../services/qaApi';
import * as literatureApi from '../services/literatureApi';
import { getExtractionStatus, cancelExtraction, createStage1Connection, createDeepExtractionConnection } from '../services/extractApi';
import type { QASSEEvent, SSEEvent, QuickQuestion, Literature } from '../types';
import AnswerCard from '../components/AnswerCard';
import StageProgress from '../components/StageProgress';
import PdfFragmentOverlay from '../components/PdfFragmentOverlay';

interface QASession {
  question: string;
  events: QASSEEvent[];
}

interface ExtractedMetric {
  label: string;
  value: string | number;
  unit?: string;
  scan_direction?: string;
  has_spo?: boolean;
  evidence?: string;
}

interface StructuredData {
  performance: ExtractedMetric[];
  process: { field: string; value: string; source?: string; evidence?: string }[];
  stability?: { metric: string; value: string; protocol?: string }[];
}

const InsightLabPage: React.FC = () => {
  const { doi: urlDoi } = useParams<{ doi: string }>();
  const navigate = useNavigate();
  const { showToast } = useAppStore();

  const [doi, setDoi] = useState(urlDoi || '');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<QuickQuestion[]>([]);
  const [literature, setLiterature] = useState<Literature | null>(null);

  // Structured extraction data (GAP-006)
  const [structuredData, setStructuredData] = useState<StructuredData | null>(null);

  // Q&A sessions (multi-turn)
  const [qaSessions, setQaSessions] = useState<QASession[]>([]);

  // Extraction state
  const [extractionEvent, setExtractionEvent] = useState<SSEEvent | null>(null);
  const [extractionStage, setExtractionStage] = useState<string>('none');
  const [isExtracting, setIsExtracting] = useState(false);

  // PDF overlay
  const [showPdf, setShowPdf] = useState(false);
  const [pdfTargetPage, setPdfTargetPage] = useState<number | null>(null);
  const [pdfHighlightText, setPdfHighlightText] = useState<string | null>(null);

  const closeRef = useRef<(() => void) | null>(null);
  const extractCloseRef = useRef<(() => void) | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    if (urlDoi) {
      setDoi(urlDoi);
      loadPaperData(urlDoi);
    }
    return () => {
      isMounted.current = false;
      closeRef.current?.();
      extractCloseRef.current?.();
    };
  }, [urlDoi]);

  const loadPaperData = async (targetDoi: string) => {
    try {
      const [lit, sug, hist, status] = await Promise.all([
        literatureApi.getLiterature(targetDoi).catch(() => null),
        qaApi.getQASuggestions(targetDoi).catch(() => []),
        qaApi.getQAHistory(targetDoi).catch(() => []),
        getExtractionStatus(targetDoi).catch(() => null),
      ]);
      if (isMounted.current) {
        if (lit) {
          setLiterature(lit);
          // Parse structured data from literature (GAP-006)
          if (lit.is_extracted) {
            const perf = lit.performance_data ? JSON.parse(lit.performance_data) : null;
            const proc = lit.process_params ? JSON.parse(lit.process_params) : null;
            if (perf || proc) {
              // Performance: support both flat { pce, voc, ... } and nested { metrics: [...] }
              const perfMetrics = Array.isArray(perf?.metrics)
                ? perf.metrics
                : perf ? Object.entries(perf)
                    .filter(([k]) => ['pce', 'voc', 'jsc', 'ff'].includes(k.toLowerCase()))
                    .map(([label, data]: [string, any]) => ({
                      label: label.toUpperCase(),
                      value: data?.value ?? data ?? 'N/A',
                      unit: data?.unit ?? '',
                      evidence: data?.evidence,
                      scan_direction: data?.scan_direction,
                      has_spo: data?.has_spo,
                    })) : [];

              // Process: support both array and { steps: [...] } object
              const procSteps = Array.isArray(proc) ? proc : (proc?.steps || []);

              // Stability: nested inside performance_data
              const stability = perf?.stability
                ? (Array.isArray(perf.stability) ? perf.stability : [perf.stability])
                : [];

              setStructuredData({
                performance: perfMetrics,
                process: procSteps,
                stability,
              });
            }
          }
        }
        setSuggestions(sug);
        setHistory(hist);
        if (status) setExtractionStage(status.stage);
      }
    } catch {
      // Paper may not be in DB yet
    }
  };

  // Q&A: ask a question via SSE streaming
  const handleAsk = useCallback((q?: string) => {
    const questionText = q || question;
    if (!questionText.trim() || !doi.trim() || loading) return;

    setLoading(true);
    const session: QASession = { question: questionText, events: [] };
    setQaSessions((prev) => [...prev, session]);
    setQuestion('');

    closeRef.current = qaApi.createQAConnection(
      doi,
      questionText,
      (event: QASSEEvent) => {
        if (!isMounted.current) return;
        setQaSessions((prev) => {
          const idx = prev.findIndex((s) => s.question === questionText && s.events.length === 0) ?? prev.length - 1;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], events: [...updated[idx].events, event] };
          return updated;
        });

        if (event.type === 'done' || event.type === 'error') {
          setLoading(false);
          qaApi.getQAHistory(doi).then(setHistory).catch(() => {});
        }
      },
      (error) => {
        if (isMounted.current) {
          showToast(error.message, 'error');
          setLoading(false);
        }
      },
    );
  }, [doi, question, loading, showToast]);

  // Stage1 screening
  const handleStage1 = useCallback(() => {
    if (!doi || isExtracting) return;
    setIsExtracting(true);
    setExtractionEvent(null);

    extractCloseRef.current = createStage1Connection(
      doi,
      (event: SSEEvent) => {
        if (!isMounted.current) return;
        setExtractionEvent(event);
        if (event.status === 'completed') {
          setExtractionStage('stage1');
          showToast('Stage1 筛选完成', 'success');
          qaApi.getQASuggestions(doi).then(setSuggestions).catch(() => {});
        }
        if (event.status === 'failed') {
          showToast(event.error || 'Stage1 筛选失败', 'error');
        }
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cached') {
          setIsExtracting(false);
        }
      },
      (error) => {
        showToast(error.message, 'error');
        setIsExtracting(false);
      },
    );
  }, [doi, isExtracting, showToast]);

  // Stage2 deep extraction
  const handleStage2 = useCallback(() => {
    if (!doi || isExtracting) return;
    setIsExtracting(true);
    setExtractionEvent(null);

    extractCloseRef.current = createDeepExtractionConnection(
      doi,
      (event: SSEEvent) => {
        if (!isMounted.current) return;
        setExtractionEvent(event);
        if (event.status === 'completed') {
          setExtractionStage('stage2');
          showToast('深度提取完成', 'success');
          loadPaperData(doi);
        }
        if (event.status === 'failed') {
          showToast(event.error || '深度提取失败', 'error');
        }
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cached') {
          setIsExtracting(false);
        }
      },
      (error) => {
        showToast(error.message, 'error');
        setIsExtracting(false);
      },
    );
  }, [doi, isExtracting, showToast]);

  const handleCancelExtraction = useCallback(() => {
    if (!doi) return;
    cancelExtraction(doi).catch(() => {});
    extractCloseRef.current?.();
    setIsExtracting(false);
  }, [doi]);

  const handleDoiSubmit = () => {
    if (!doi.trim()) return;
    if (urlDoi !== doi) {
      navigate(`/insight/${doi}`);
    } else {
      loadPaperData(doi);
    }
  };

  const handlePageClick = useCallback((page: number) => {
    setPdfTargetPage(page);
    setShowPdf(true);
  }, []);

  return (
    <div className="h-screen bg-premium-bg overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link to="/home" className="text-slate-500 hover:text-slate-300 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">见解实验室</h1>
              <p className="text-slate-400 text-sm">精准问答 — 基于论文内容的 RAG 检索与回答</p>
            </div>
          </div>
        </div>

        {/* DOI Input (only when no URL doi) */}
        {!urlDoi && (
          <div className="flex gap-3 mb-8 max-w-2xl mx-auto">
            <input
              type="text"
              value={doi}
              onChange={(e) => setDoi(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDoiSubmit()}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50"
              placeholder="输入 DOI 加载论文..."
            />
            <button
              type="button"
              onClick={handleDoiSubmit}
              className="btn-primary py-3 px-6 text-sm"
            >
              加载
            </button>
          </div>
        )}

        {doi && (
          <div className="grid grid-cols-3 gap-8">
            {/* Left: Q&A Panel */}
            <div className="col-span-2 space-y-6">
              {/* Paper info + extraction controls */}
              {literature && (
                <div className="glass-card p-5 rounded-2xl border-white/5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white mb-1 truncate">{literature.title}</h3>
                      <p className="text-[11px] text-slate-500">
                        {literature.journal} {literature.year} · {literature.authors}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Extraction stage badge */}
                      {extractionStage !== 'none' && (
                        <span className={`text-[10px] px-2 py-1 rounded-full ${
                          extractionStage === 'stage2' ? 'bg-emerald-500/10 text-emerald-400'
                            : extractionStage === 'stage1' ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-red-500/10 text-red-400'
                        }`}>
                          {extractionStage === 'stage2' ? '已深度提取' : extractionStage === 'stage1' ? '已筛选' : '失败'}
                        </span>
                      )}

                      {/* Stage1 button */}
                      {extractionStage === 'none' && (
                        <button
                          type="button"
                          onClick={handleStage1}
                          disabled={isExtracting}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:border-brand-500/30 disabled:opacity-50 transition-all"
                        >
                          快速筛选
                        </button>
                      )}

                      {/* Stage2 button */}
                      {(extractionStage === 'stage1' || extractionStage === 'none') && (
                        <button
                          type="button"
                          onClick={handleStage2}
                          disabled={isExtracting}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 disabled:opacity-50 transition-all"
                        >
                          深度提取
                        </button>
                      )}

                      {/* View PDF */}
                      {literature.local_pdf_path && (
                        <button
                          type="button"
                          onClick={() => { setPdfTargetPage(1); setShowPdf(true); }}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white transition-all"
                        >
                          PDF
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Extraction progress */}
              {(isExtracting || extractionEvent) && (
                <StageProgress
                  event={extractionEvent}
                  onCancel={isExtracting ? handleCancelExtraction : undefined}
                />
              )}

              {/* Structured Extraction Cards (GAP-006) */}
              {literature && extractionStage === 'stage2' && structuredData && (
                <div className="space-y-4">
                  {/* Performance Metrics Card */}
                  {structuredData.performance && structuredData.performance.length > 0 && (
                    <div className="glass-card rounded-2xl p-5 border-white/5">
                      <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <span className="w-1 h-3 bg-emerald-500 rounded-full" />
                        性能指标
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {structuredData.performance.map((metric, idx) => (
                          <div key={idx} className="bg-white/5 rounded-xl p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">{metric.label}</span>
                              {metric.scan_direction && (
                                <span className="text-[8px] px-1 py-0.5 rounded bg-brand-500/20 text-brand-400">
                                  {metric.scan_direction}
                                </span>
                              )}
                              {metric.has_spo && (
                                <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">SPO</span>
                              )}
                            </div>
                            <div className="flex items-baseline gap-1">
                              <span className="text-xl font-bold text-white">{metric.value}</span>
                              {metric.unit && <span className="text-xs text-slate-400">{metric.unit}</span>}
                            </div>
                            {metric.evidence && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPdfHighlightText(metric.evidence || null);
                                  setPdfTargetPage(null);
                                  setShowPdf(true);
                                }}
                                className="mt-1 flex items-center gap-1 text-[9px] text-brand-400/50 hover:text-brand-400 transition-colors max-w-full"
                                title={metric.evidence}
                              >
                                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span className="truncate">{metric.evidence.slice(0, 40)}...</span>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Process Parameters Card */}
                  {structuredData.process && structuredData.process.length > 0 && (
                    <div className="glass-card rounded-2xl p-5 border-white/5">
                      <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <span className="w-1 h-3 bg-blue-500 rounded-full" />
                        工艺参数
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {structuredData.process.map((step, idx) => (
                          <div key={idx} className="bg-white/5 rounded-lg p-3">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">{step.field}</span>
                            <p className="text-sm text-slate-200 mt-1">{step.value}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {step.source && (
                                <span className="text-[9px] text-slate-600">{step.source === 'si' ? '📄 SI' : '📄 正文'}</span>
                              )}
                              {step.evidence && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPdfHighlightText(step.evidence || null);
                                    setPdfTargetPage(null);
                                    setShowPdf(true);
                                  }}
                                  className="flex items-center gap-1 text-[9px] text-brand-400/50 hover:text-brand-400 transition-colors"
                                  title={step.evidence}
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                  <span className="truncate max-w-[80px]">{step.evidence.slice(0, 30)}...</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stability Data Card */}
                  {structuredData.stability && structuredData.stability.length > 0 && (
                    <div className="glass-card rounded-2xl p-5 border-white/5">
                      <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <span className="w-1 h-3 bg-amber-500 rounded-full" />
                        稳定性数据
                      </h4>
                      <div className="space-y-2">
                        {structuredData.stability.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-slate-200">{item.metric}</span>
                              {item.protocol && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                                  {item.protocol}
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-bold text-white">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Stage1 screening result — basic info + prompt for deep extraction */}
              {literature && extractionStage === 'stage1' && !isExtracting && (
                <div className="glass-card rounded-2xl p-6 border-white/5">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Stage1 筛选完成</h4>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed mb-4">
                    基础信息已解析。运行深度提取以获取完整的性能指标、工艺参数和稳定性数据。
                  </p>
                  {literature.abstract && (
                    <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                      <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-4">{literature.abstract}</p>
                    </div>
                  )}
                </div>
              )}

              {/* No extraction yet — empty state hint */}
              {literature && extractionStage === 'none' && !isExtracting && (
                <div className="glass-card rounded-2xl p-8 border-white/5 text-center">
                  <div className="text-2xl mb-3">📋</div>
                  <p className="text-sm text-slate-500 mb-1">尚未提取</p>
                  <p className="text-xs text-slate-600">点击上方「快速筛选」或「深度提取」开始解析论文数据</p>
                </div>
              )}

              {/* Question Input */}
              <div className="glass-card rounded-2xl p-2 border-white/5">
                <textarea
                  className="w-full bg-transparent border-none p-4 text-sm text-slate-100 focus:outline-none min-h-[80px] resize-none placeholder:text-slate-600"
                  placeholder={extractionStage === 'none' ? '请先提取论文后提问...' : '输入你的问题，如：退火温度是多少？最佳 PCE 是多少？'}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAsk())}
                />
                <div className="flex justify-between items-center p-3 border-t border-white/5">
                  <span className="text-[10px] text-slate-600">
                    {doi && `DOI: ${doi}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAsk()}
                    disabled={loading || !question.trim() || !doi.trim()}
                    className="btn-primary py-2 px-6 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        思考中...
                      </>
                    ) : '提问'}
                  </button>
                </div>
              </div>

              {/* Suggestions */}
              {suggestions.length > 0 && qaSessions.length === 0 && !loading && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">推荐问题</h4>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setQuestion(''); handleAsk(s); }}
                        className="px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-medium hover:bg-brand-500/20 transition-colors truncate max-w-[280px]"
                        title={s}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Answer Cards (multi-turn) */}
              {qaSessions.length > 0 && (
                <div className="space-y-4">
                  {qaSessions.map((session, idx) => (
                    <AnswerCard
                      key={idx}
                      question={session.question}
                      events={session.events}
                      onPageClick={handlePageClick}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: History */}
            <div>
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <span className="w-1 h-3 bg-indigo-500 rounded-full" />
                问答历史
              </h3>
              {history.length > 0 ? (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="glass-card p-3 rounded-xl border-white/5 cursor-pointer hover:border-indigo-500/30 transition-all"
                      onClick={() => { setQuestion(''); handleAsk(item.question); }}
                    >
                      <p className="text-xs font-bold text-slate-200 mb-1 line-clamp-2">{item.question}</p>
                      <p className="text-[11px] text-slate-500 line-clamp-2">{item.answer}</p>
                      {item.cost !== undefined && (
                        <p className="text-[9px] text-slate-600 mt-1">${item.cost.toFixed(4)}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 border border-dashed border-white/10 rounded-3xl text-center">
                  <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">暂无历史</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!doi && (
          <div className="py-20 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-brand-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-slate-400 text-sm mb-2">见解实验室</p>
            <p className="text-slate-500 text-sm">输入 DOI 加载论文，开始精准问答</p>
          </div>
        )}
      </div>

      {/* PDF Overlay */}
      {showPdf && doi && (
        <PdfFragmentOverlay
          doi={doi}
          targetPage={pdfTargetPage}
          highlightText={pdfHighlightText || undefined}
          onClose={() => { setShowPdf(false); setPdfHighlightText(null); }}
        />
      )}
    </div>
  );
};

export default InsightLabPage;
