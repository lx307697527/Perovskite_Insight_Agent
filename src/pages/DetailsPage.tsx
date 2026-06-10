import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from '../services/api';
import { getLiterature } from '../services/literatureApi';
import { getQASuggestions, createQAConnection } from '../services/qaApi';
import { getPdfUrl } from '../services/fetchUtils';
import type { PaperDetailsResponse, QASSEEvent, ProcessRecipe, SIFile, PerformanceDataFlat, StabilityDataItem, SourceMappingItem, MetricItem, MetricField, MetricValue } from '../types';
import PdfViewer from '../components/PdfViewer';
import PdfFragmentOverlay from '../components/PdfFragmentOverlay';
import QuickQuestionBox from '../components/QuickQuestionBox';
import { useAppStore } from '../store';

// ============================================================
// Structured data types (aligned with InsightLabPage)
// ============================================================

interface ExtractedMetric {
  label: string;
  value: string | number;
  unit?: string;
  evidence?: string;
  scan_direction?: string;
  has_spo?: boolean;
}

interface StabilityItem {
  metric?: string;
  value: string;
  protocol?: string;
  t80?: string;
  t90?: string;
  retention?: string;
  conditions?: string;
  evidence?: string;
}

interface SIFileInfo {
  id: string;
  type: string;
  status: string;
  local_path?: string;
}

interface DetailsData {
  title: string;
  journal: string;
  year: number;
  authors: string;
  abstract: string;
  is_extracted: boolean;
  extraction_stage: string;
  quality_flag: string;
  data_source: string;
  metrics: ExtractedMetric[];
  process: ProcessRecipe[];
  stability: StabilityItem[];
  si_files: SIFileInfo[];
}

// ============================================================
// Parse V2 literature into structured DetailsData
// ============================================================

interface V2Literature {
  doi: string;
  title: string;
  journal?: string;
  year?: number;
  authors?: string;
  abstract?: string;
  is_extracted: boolean;
  extraction_stage: string;
  data_source: string;
  quality_flag?: string;
  local_pdf_path?: string;
  performance_data?: PerformanceDataFlat | null;
  process_params?: ProcessRecipe[] | { steps: ProcessRecipe[] } | null;
  stability_data?: StabilityDataItem[] | StabilityDataItem | null;
  source_mapping?: SourceMappingItem[] | null;
  si_files?: SIFileInfo[];
}

function parseV2ToDetails(lit: V2Literature): DetailsData {
  const perf = lit.performance_data || null;
  const proc = lit.process_params || null;

  // Performance: support both flat { pce, voc, ... } and nested { metrics: [...] }
  const perfMetrics: ExtractedMetric[] = Array.isArray(perf?.metrics)
    ? perf.metrics.map((m: MetricItem) => ({
        label: m.field || m.label || 'Unknown',
        value: m.value ?? 'N/A',
        unit: m.unit ?? '',
        evidence: m.evidence,
        scan_direction: m.scan_direction,
        has_spo: m.has_spo,
      }))
    : perf
      ? Object.entries(perf)
          .filter(([k]) => ['pce', 'voc', 'jsc', 'ff'].includes(k.toLowerCase()))
          .map(([label, data]: [string, MetricValue]) => ({
            label: label.toUpperCase(),
            value: data?.value ?? data ?? 'N/A',
            unit: data?.unit ?? (label.toLowerCase() === 'pce' || label.toLowerCase() === 'ff' ? '%' : label.toLowerCase() === 'voc' ? 'V' : 'mA/cm²'),
            evidence: data?.evidence,
            scan_direction: data?.scan_direction,
            has_spo: data?.has_spo,
          }))
      : [];

  // Process: support both array and { steps: [...] } object
  const procSteps: ProcessRecipe[] = Array.isArray(proc)
    ? proc
    : proc?.steps || [];

  // Stability: prefer dedicated column, fallback to nested in performance_data
  const rawStability = lit.stability_data || perf?.stability || null;
  const stability: StabilityItem[] = rawStability
    ? (Array.isArray(rawStability) ? rawStability : [rawStability]).map((s: StabilityDataItem) => ({
        metric: s.metric || s.protocol || '',
        value: s.value || s.t80 || s.t90 || s.retention || '',
        protocol: s.protocol,
        t80: s.t80,
        t90: s.t90,
        retention: s.retention,
        conditions: s.conditions,
        evidence: s.evidence,
      }))
    : [];

  return {
    title: lit.title,
    journal: lit.journal || 'Unknown',
    year: lit.year || 2024,
    authors: lit.authors || 'Unknown',
    abstract: lit.abstract || 'No abstract available.',
    is_extracted: lit.is_extracted,
    extraction_stage: lit.extraction_stage,
    quality_flag: lit.quality_flag || 'OK',
    data_source: lit.data_source || 'abstract',
    metrics: perfMetrics,
    process: procSteps,
    stability,
    si_files: lit.si_files || [],
  };
}

// ============================================================
// Component
// ============================================================

const DetailsPage: React.FC = () => {
  const { doi } = useParams<{ doi: string }>();
  const navigate = useNavigate();
  const { comparisonDois, toggleComparisonDoi } = useAppStore();

  const [activeTab, setActiveTab] = useState<'device' | 'process' | 'si' | 'stability'>('device');
  const [highlightedText, setHighlightedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paperData, setPaperData] = useState<DetailsData | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewMode, setViewMode] = useState<'abstract' | 'pdf'>('abstract');
  const [toast, setToast] = useState<{message: string, type: 'info' | 'success' | 'error'} | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedAbstract, setTranslatedAbstract] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);

  // Q&A state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [qaAnswer, setQaAnswer] = useState<string>('');
  const [isQaLoading, setIsQaLoading] = useState(false);
  const [qaSources, setQaSources] = useState<Array<{ page: number; excerpt: string; file: string }>>([]);

  // PDF overlay state
  const [showPdfOverlay, setShowPdfOverlay] = useState(false);
  const [pdfOverlayHighlight, setPdfOverlayHighlight] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const qaCleanupRef = useRef<(() => void) | null>(null);
  const isMounted = useRef(true);

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const currentDoi = doi || '';

  useEffect(() => {
    isMounted.current = true;
    // Close old SSE connections when DOI changes (e.g. user navigates to a different paper)
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (qaCleanupRef.current) {
      qaCleanupRef.current();
      qaCleanupRef.current = null;
    }
    return () => {
      isMounted.current = false;
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (qaCleanupRef.current) qaCleanupRef.current();
    };
  }, [currentDoi]);

  // ============================================================
  // Fetch details — V2 with V1 fallback
  // ============================================================

  const fetchDetails = async () => {
    if (!currentDoi) return;
    setLoading(true);
    try {
      // Try V2 API first (richer data: SI files, quality, stability, scan_direction)
      const lit = await getLiterature(currentDoi);
      if (isMounted.current) {
        setPaperData(parseV2ToDetails(lit as unknown as V2Literature));
      }
    } catch {
      // V2 fallback: paper not in DB yet → use V1 API (crawler-based)
      try {
        const v1Data = await api.fetchPaperDetails(currentDoi);
        if (isMounted.current) {
          // Convert V1 format to DetailsData
          const details: DetailsData = {
            title: v1Data.title,
            journal: v1Data.journal,
            year: v1Data.year,
            authors: v1Data.authors,
            abstract: v1Data.abstract,
            is_extracted: v1Data.is_extracted,
            extraction_stage: v1Data.is_extracted ? 'stage2' : 'none',
            quality_flag: 'OK',
            data_source: 'abstract',
            metrics: (v1Data.metrics || []).map((m: MetricField) => ({
              label: m.label || m.field || 'Unknown',
              value: m.value ?? 'N/A',
              unit: m.unit ?? '',
              evidence: m.evidence,
            })),
            process: v1Data.process || [],
            stability: [],
            si_files: [],
          };
          setPaperData(details);
        }
      } catch {
        if (isMounted.current) showToast('获取论文详情失败', 'error');
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [currentDoi]);

  // Fetch Q&A suggestions when paper is extracted
  useEffect(() => {
    if (!currentDoi || !paperData?.is_extracted) return;

    const fetchSuggestions = async () => {
      setIsLoadingSuggestions(true);
      try {
        const result = await getQASuggestions(currentDoi);
        if (isMounted.current) setSuggestions(result);
      } catch {
        if (isMounted.current) {
          setSuggestions([
            '这篇论文的主要贡献是什么？',
            '使用了哪些钙钛矿材料？',
            '器件的最佳效率是多少？',
          ]);
        }
      } finally {
        if (isMounted.current) setIsLoadingSuggestions(false);
      }
    };

    fetchSuggestions();
  }, [currentDoi, paperData?.is_extracted]);

  // Handle asking a question
  const handleAskQuestion = useCallback((question: string) => {
    if (!currentDoi || isQaLoading) return;

    setQaAnswer('');
    setQaSources([]);
    setIsQaLoading(true);

    if (qaCleanupRef.current) {
      qaCleanupRef.current();
    }

    const handleQaEvent = (event: QASSEEvent) => {
      if (!isMounted.current) return;

      switch (event.type) {
        case 'content':
          if (event.text) {
            setQaAnswer(prev => prev + event.text);
          }
          break;
        case 'source':
          if (event.page !== undefined) {
            setQaSources(prev => [...prev, {
              page: event.page!,
              excerpt: event.excerpt || '',
              file: event.file || 'main',
            }]);
          }
          break;
        case 'done':
          setIsQaLoading(false);
          break;
        case 'error':
          setIsQaLoading(false);
          showToast(event.message || '问答请求失败', 'error');
          break;
      }
    };

    const handleQaError = (error: Error) => {
      if (!isMounted.current) return;
      setIsQaLoading(false);
      showToast(`问答失败: ${error.message}`, 'error');
    };

    qaCleanupRef.current = createQAConnection(currentDoi, question, handleQaEvent, handleQaError);
  }, [currentDoi, isQaLoading]);

  const handleTranslate = async () => {
    if (translatedAbstract) { setShowTranslation(!showTranslation); return; }
    if (!paperData?.abstract) return;
    setIsTranslating(true);
    try {
      const translated = await api.translateText(paperData.abstract);
      if (isMounted.current) { setTranslatedAbstract(translated); setShowTranslation(true); }
    } catch { showToast('翻译失败', 'error'); }
    finally { setIsTranslating(false); }
  };

  const handleStartExtraction = (retryCount = 0) => {
    setIsExtracting(true);
    if (retryCount === 0) setProgress(0);
    if (eventSourceRef.current) eventSourceRef.current.close();

    const eventSource = api.createExtractionConnection(currentDoi);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      if (!isMounted.current) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        console.error('SSE parse error:', e);
        return;
      }
      if (['extracting', 'parsing', 'downloading', 'analyzing_si', 'cached'].includes(data.status)) {
        const rawProgress = data.progress;
        const progressValue = typeof rawProgress === 'object' && rawProgress !== null
          ? (rawProgress as { progress?: number }).progress ?? progress
          : (typeof rawProgress === 'number' ? rawProgress : progress);
        setProgress(progressValue);
      } else if (data.status === 'completed') {
        setIsExtracting(false); setProgress(100);
        eventSource.close(); eventSourceRef.current = null;
        fetchDetails(); showToast('参数提取完成', 'success');
      } else if (data.status === 'failed' || data.status === 'error') {
        handleExtractionError(eventSource, retryCount);
      }
    };
    eventSource.onerror = () => {
      if (!isMounted.current) return;
      if (eventSource.readyState === EventSource.CLOSED) return;
      handleExtractionError(eventSource, retryCount);
    };
  };

  const handleExtractionError = (es: EventSource, retryCount: number) => {
    es.close();
    if (eventSourceRef.current === es) eventSourceRef.current = null;
    if (!isMounted.current) return;
    if (retryCount < 3) {
      setTimeout(() => handleStartExtraction(retryCount + 1), 2000);
    } else {
      setIsExtracting(false);
      showToast('解析失败，请检查网络或 API Key 配置', 'error');
    }
  };

  // ============================================================
  // Quality warning helpers (Task 8)
  // ============================================================

  const getMetricWarnings = (metric: ExtractedMetric): string[] => {
    const warnings: string[] = [];
    if (!metric.scan_direction) {
      warnings.push('缺少扫描方向标注');
    }
    if (metric.label.toUpperCase() === 'PCE' && !metric.has_spo) {
      warnings.push('未报告稳态功率输出 (SPO)');
    }
    return warnings;
  };

  // ============================================================
  // Render helpers
  // ============================================================

  if (loading) {
    return (
      <div className="h-screen bg-premium-bg flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin"></div>
        <p className="text-slate-500 text-sm animate-pulse">正在同步论文元数据...</p>
      </div>
    );
  }

  if (!paperData) {
    return (
      <div className="h-screen bg-premium-bg flex flex-col items-center justify-center p-12 text-center">
        <h2 className="text-2xl font-bold mb-4">未找到该论文</h2>
        <button type="button" onClick={() => navigate('/home')} className="btn-primary">返回首页</button>
      </div>
    );
  }

  const isCompared = comparisonDois.includes(currentDoi);

  // Determine quality warnings banner text
  const qualityWarnings: string[] = [];
  if (paperData.is_extracted) {
    const hasRSOnly = paperData.metrics.some(m => m.scan_direction === 'R-scan');
    const hasNoFS = !paperData.metrics.some(m => m.scan_direction === 'F-scan');
    if (hasRSOnly && hasNoFS) {
      qualityWarnings.push('仅有 R-scan 数据，无 F-scan 对照，效率值可能偏高');
    }
    const pceMetric = paperData.metrics.find(m => m.label.toUpperCase() === 'PCE');
    if (pceMetric && !pceMetric.has_spo) {
      qualityWarnings.push('未报告稳态功率输出 (SPO)，效率可靠性待确认');
    }
  }

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

  return (
    <div className="h-screen flex flex-col bg-slate-950 animate-fade-in">
      <header className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-md flex justify-between items-center px-6 z-50">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/results')} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-sm">
            ← 返回列表
          </button>
          <div className="h-4 w-[1px] bg-white/10"></div>
          <h2 className="text-sm font-bold truncate max-w-xl text-slate-300">
            {paperData.journal} {paperData.year} · {paperData.title}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {/* Data source badge (Task 5 style) */}
          {paperData.is_extracted && (
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${
              paperData.data_source === 'fulltext'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
            }`}>
              {paperData.data_source === 'fulltext' ? '📄 全文' : '📋 摘要'}
            </span>
          )}
          <button
            type="button"
            onClick={() => toggleComparisonDoi(currentDoi)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold shadow-lg transition-all ${
              isCompared ? 'bg-emerald-600 text-white shadow-emerald-500/20' : 'bg-brand-600 text-white shadow-brand-500/20'
            }`}
          >
            {isCompared ? '已加入对比' : '加入对比'}
          </button>
        </div>
      </header>

      <div className="flex-grow flex overflow-hidden">
        <div className="flex-grow overflow-hidden flex flex-col relative bg-slate-900/20">
          <div className="flex-grow overflow-auto p-12 scrollbar-hide">
            <div className="max-w-4xl mx-auto">
              <h1 className="text-3xl font-bold text-white mb-8 leading-tight">{paperData.title}</h1>
              <div className="flex gap-4 mb-10 text-xs text-slate-500 font-sans uppercase tracking-widest border-b border-white/5 pb-6">
                <span>{paperData.authors}</span>
                <span className="text-brand-500/30">|</span>
                <span>{paperData.journal}, {paperData.year}</span>
              </div>

              <div className="mb-12">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-[10px] font-bold text-brand-400 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse"></span>
                    {viewMode === 'abstract' ? 'Scientific Abstract' : 'Source Document'}
                  </h2>
                  {viewMode === 'abstract' && (
                    <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
                      <button type="button" onClick={() => setShowTranslation(false)} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${!showTranslation ? 'bg-brand-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>ENG</button>
                      <button type="button" onClick={handleTranslate} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${showTranslation ? 'bg-brand-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                        {isTranslating ? <span className="w-2 h-2 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> : '中'}
                      </button>
                    </div>
                  )}
                </div>

                {viewMode === 'abstract' ? (
                  <div className="glass-card p-8 rounded-3xl border-white/5 bg-white/[0.02]">
                    <p className={`text-lg leading-relaxed text-slate-300 transition-all duration-500 ${showTranslation ? 'opacity-0 scale-95 h-0 overflow-hidden' : 'opacity-100 scale-100'}`}>
                      {paperData.abstract}
                    </p>
                    {showTranslation && (
                      <p className="text-lg leading-relaxed text-slate-100 animate-in fade-in slide-in-from-bottom-2 duration-500">{translatedAbstract}</p>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-[70vh] rounded-3xl overflow-hidden border border-white/10 bg-black/40 shadow-2xl">
                    <PdfViewer url={getPdfUrl(currentDoi)} highlightText={highlightedText} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/80 backdrop-blur-2xl px-8 py-4 rounded-2xl border border-white/10 shadow-2xl z-30">
            <button type="button" onClick={() => setViewMode('abstract')} className={`transition-all text-xs font-bold px-4 py-1 rounded-lg ${viewMode === 'abstract' ? 'text-brand-400 bg-brand-400/10' : 'text-slate-400 hover:text-white'}`}>摘要模式</button>
            <div className="h-4 w-[1px] bg-white/10"></div>
            <button type="button" onClick={() => setViewMode('pdf')} className={`transition-all text-xs font-bold px-4 py-1 rounded-lg ${viewMode === 'pdf' ? 'text-brand-400 bg-brand-400/10' : 'text-slate-400 hover:text-white'}`}>PDF 预览</button>
          </div>

          {isExtracting && (
            <div className="absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-12 animate-in fade-in duration-500">
              <div className="relative w-40 h-40 mb-10">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="80" cy="80" r="76" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-white/5" />
                  <circle cx="80" cy="80" r="76" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-brand-500" strokeDasharray={477} strokeDashoffset={477 - (477 * progress) / 100} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center font-bold text-3xl text-brand-400">{progress}%</div>
              </div>
              <h3 className="text-2xl font-bold mb-3 text-white animate-pulse">AI 深度提取中...</h3>
              <p className="text-slate-500 text-sm max-w-xs text-center leading-relaxed">正在解析主文与 SI 中的实验数据</p>
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* Right sidebar */}
        {/* ============================================================ */}
        <div className="w-[450px] flex-shrink-0 flex flex-col bg-black/40 border-l border-white/5 backdrop-blur-md">
          {!paperData.is_extracted ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <h3 className="text-xl font-bold mb-4 text-white">数据未提取</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-10 px-4">核心性能参数尚未从本文献中提取。</p>
              <button type="button" onClick={() => handleStartExtraction()} className="w-full py-5 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold shadow-2xl shadow-brand-500/30 transition-all">
                开始 AI 参数解析
              </button>
            </div>
          ) : (
            <>
              {/* Tabs — now 4 tabs */}
              <div className="flex border-b border-white/5 bg-white/5">
                {[
                  { id: 'device', label: '核心性能' },
                  { id: 'process', label: '工艺参数' },
                  { id: 'si', label: 'SI 数据' },
                  { id: 'stability', label: '稳定性' },
                ].map(tab => (
                  <button type="button" key={tab.id} onClick={() => setActiveTab(tab.id as 'device' | 'process' | 'si' | 'stability')} className={`flex-grow py-5 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === tab.id ? 'text-brand-400 border-b-2 border-brand-500 bg-brand-500/10' : 'text-slate-500 hover:text-slate-300'}`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex-grow overflow-y-auto p-8 space-y-6 scrollbar-hide">

                {/* ==================================================== */}
                {/* Tab: Core Performance (device) — Task 8 + 9         */}
                {/* ==================================================== */}
                {activeTab === 'device' && (
                  <>
                    {/* Quality warning banner (Task 8) */}
                    {qualityWarnings.length > 0 && (
                      <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm">⚠️</span>
                          <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">数据质量提示</span>
                        </div>
                        {qualityWarnings.map((w, i) => (
                          <p key={i} className="text-xs text-orange-200/80 mb-1 last:mb-0">• {w}</p>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      {paperData.metrics.map((m, i) => {
                        const metricWarnings = getMetricWarnings(m);
                        const hasAnyCondition = m.scan_direction || m.has_spo;

                        return (
                          <div
                            key={i}
                            onClick={() => { setHighlightedText(m.evidence || null); setViewMode('pdf'); }}
                            className={`p-5 rounded-2xl border transition-all cursor-pointer group relative ${
                              highlightedText === m.evidence
                                ? 'bg-brand-500/10 border-brand-500/40 ring-1 ring-brand-500/30 shadow-lg'
                                : 'bg-white/5 border-white/5 hover:border-white/20'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{m.label}</span>
                              <div className="flex items-center gap-1.5">
                                {/* Quality indicator (Task 8) */}
                                {hasAnyCondition ? (
                                  <span className="text-[8px] text-emerald-500/60" title="测试条件标注完整">✓</span>
                                ) : (
                                  <span className="text-[8px] text-orange-400/60 cursor-help" title="缺少测试条件标注">⚠</span>
                                )}
                                {m.evidence && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPdfOverlayHighlight(m.evidence || null);
                                      setShowPdfOverlay(true);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-brand-400 hover:text-brand-300 p-1 rounded hover:bg-brand-500/10"
                                    title="在 PDF 中查看证据来源"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                  </button>
                                )}
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-brand-400">溯源 →</span>
                              </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-2xl font-bold text-slate-100">{m.value}</span>
                              <span className="text-xs text-slate-500">{m.unit}</span>
                            </div>
                            {/* Condition suffix badges (Task 9) */}
                            <div className="flex items-center gap-1.5 mt-2">
                              {m.scan_direction && (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 font-bold">
                                  {m.scan_direction}
                                </span>
                              )}
                              {m.has_spo && (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                                  SPO ✅
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* ==================================================== */}
                {/* Tab: Process Parameters                              */}
                {/* ==================================================== */}
                {activeTab === 'process' && (
                  <div className="space-y-4">
                    {paperData.process.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 transition-all group">
                        <span className="text-xs text-slate-400 group-hover:text-slate-300">{item.field}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-200">{item.value}</span>
                          {item.source === 'si' && <span className="text-[8px] font-bold text-brand-500/60 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20">SI</span>}
                          {item.evidence && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPdfOverlayHighlight(item.evidence || null);
                                setShowPdfOverlay(true);
                              }}
                              className="text-slate-600 hover:text-brand-400 transition-colors p-1 rounded hover:bg-brand-500/10"
                              title="在 PDF 中查看证据来源"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ==================================================== */}
                {/* Tab: SI Data — Task 6 (file list + params)           */}
                {/* ==================================================== */}
                {activeTab === 'si' && (
                  <>
                    {/* SI File list (Task 6) */}
                    {paperData.si_files.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                          <span className="w-1 h-3 bg-brand-500 rounded-full" />
                          SI 附件文件
                        </h4>
                        {paperData.si_files.map((file) => (
                          <div key={file.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 transition-all">
                            <div className="flex items-center gap-3">
                              <span className="text-lg">
                                {file.type === 'pdf' ? '📄' : file.type === 'docx' ? '📝' : '📦'}
                              </span>
                              <div>
                                <span className="text-xs font-bold text-slate-200">
                                  SI.{file.type || 'pdf'}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
                                    file.status === 'ready'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : file.status === 'downloading'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : file.status === 'failed'
                                          ? 'bg-red-500/20 text-red-400'
                                          : 'bg-slate-500/20 text-slate-400'
                                  }`}>
                                    {file.status === 'ready' ? '已就绪' : file.status === 'downloading' ? '下载中' : file.status === 'failed' ? '下载失败' : '待处理'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {file.status === 'ready' && (
                                <a
                                  href={`${API_BASE}/api/si/${file.id}/download`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 border border-brand-500/20 transition-all"
                                >
                                  下载
                                </a>
                              )}
                              {file.status === 'failed' && (
                                <span className="text-[10px] text-red-400/60">下载失败</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* SI Process Parameters (existing) */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <span className="w-1 h-3 bg-orange-500 rounded-full" />
                        SI 工艺参数
                      </h4>
                      {paperData.process.filter(item => item.source === 'si').length > 0 ? (
                        paperData.process.filter(item => item.source === 'si').map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 transition-all">
                            <span className="text-xs text-slate-400">{item.field}</span>
                            <span className="text-xs font-bold text-slate-200">{item.value}</span>
                          </div>
                        ))
                      ) : (
                        <div className="py-8 text-center">
                          <div className="text-xl mb-2">📄</div>
                          <p className="text-xs text-slate-600">未发现 SI 补充信息数据</p>
                          <p className="text-[10px] text-slate-700 mt-1">深度提取会解析 SI 附件中的参数</p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* ==================================================== */}
                {/* Tab: Stability (Task 7)                              */}
                {/* ==================================================== */}
                {activeTab === 'stability' && (
                  <>
                    {paperData.stability.length > 0 ? (
                      <div className="space-y-4">
                        <div className="glass-card rounded-2xl p-5 border-white/5">
                          <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-1 h-3 bg-amber-500 rounded-full" />
                            稳定性数据
                          </h4>
                          <div className="space-y-2">
                            {paperData.stability.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-slate-200">{item.metric || item.protocol || '稳定性指标'}</span>
                                  {item.protocol && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">
                                      {item.protocol}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-white">{item.value}</span>
                                  {item.evidence && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPdfOverlayHighlight(item.evidence || null);
                                        setShowPdfOverlay(true);
                                      }}
                                      className="text-slate-600 hover:text-brand-400 transition-colors p-1 rounded hover:bg-brand-500/10"
                                      title="在 PDF 中查看证据来源"
                                    >
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Detailed conditions */}
                          {paperData.stability.some(s => s.conditions || s.t80 || s.t90 || s.retention) && (
                            <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
                              <h5 className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">详细条件</h5>
                              {paperData.stability.filter(s => s.conditions || s.t80 || s.t90 || s.retention).map((item, idx) => (
                                <div key={idx} className="flex flex-wrap gap-2 text-[10px]">
                                  {item.t80 && (
                                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300">T80: {item.t80}</span>
                                  )}
                                  {item.t90 && (
                                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300">T90: {item.t90}</span>
                                  )}
                                  {item.retention && (
                                    <span className="px-2 py-0.5 rounded bg-slate-500/10 text-slate-400">保持率: {item.retention}</span>
                                  )}
                                  {item.conditions && (
                                    <span className="px-2 py-0.5 rounded bg-slate-500/10 text-slate-400">{item.conditions}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="py-16 text-center">
                        <div className="text-3xl mb-3">🔬</div>
                        <p className="text-sm text-slate-500 mb-1">未检测到稳定性测试数据</p>
                        <p className="text-xs text-slate-700 mt-1">
                          {paperData.is_extracted
                            ? '该文献未报告 ISOS 标准稳定性测试结果'
                            : '提取文献后可查看稳定性数据'
                          }
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Q&A Section */}
              <div className="border-t border-white/5 p-6 space-y-4">
                <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>
                  精准问答
                </h3>
                <QuickQuestionBox
                  onAsk={handleAskQuestion}
                  suggestions={suggestions}
                  isLoading={isQaLoading}
                />
                {qaAnswer && (
                  <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {qaAnswer}
                    </div>
                    {qaSources.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">来源引用</p>
                        <div className="flex flex-wrap gap-2">
                          {qaSources.map((src, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setHighlightedText(src.excerpt);
                                setViewMode('pdf');
                              }}
                              className="text-[10px] px-2 py-1 rounded bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors"
                            >
                              {src.file === 'si' ? 'SI' : `P.${src.page}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {toast && (
            <div className="fixed bottom-10 right-10 z-[100] animate-in slide-in-from-right duration-300">
              <div className={`px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-brand-500/10 border-brand-500/30 text-brand-400'}`}>
                <span className="text-sm font-bold">{toast.message}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PDF Fragment Overlay */}
      {showPdfOverlay && (
        <PdfFragmentOverlay
          doi={currentDoi}
          highlightText={pdfOverlayHighlight || undefined}
          onClose={() => { setShowPdfOverlay(false); setPdfOverlayHighlight(null); }}
        />
      )}
    </div>
  );
};

export default DetailsPage;
