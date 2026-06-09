import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from '../services/api';
import type { PaperDetailsResponse } from '../types';
import PdfViewer from '../components/PdfViewer';
import { useAppStore } from '../store';

const DetailsPage: React.FC = () => {
  const { doi } = useParams<{ doi: string }>();
  const navigate = useNavigate();
  const { comparisonDois, toggleComparisonDoi } = useAppStore();

  const [activeTab, setActiveTab] = useState<'device' | 'process' | 'si'>('device');
  const [highlightedText, setHighlightedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paperData, setPaperData] = useState<PaperDetailsResponse | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewMode, setViewMode] = useState<'abstract' | 'pdf'>('abstract');
  const [toast, setToast] = useState<{message: string, type: 'info' | 'success' | 'error'} | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedAbstract, setTranslatedAbstract] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const isMounted = useRef(true);

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const currentDoi = doi || '';

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const fetchDetails = async () => {
    if (!currentDoi) return;
    setLoading(true);
    try {
      const data = await api.fetchPaperDetails(currentDoi);
      if (isMounted.current) setPaperData(data);
    } catch (err) {
      if (isMounted.current) showToast('获取论文详情失败', 'error');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [currentDoi]);

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
      const data = JSON.parse(event.data);
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
      // EventSource fires onerror when the stream closes normally after 'completed'.
      // Only treat it as a real error if the connection is still supposed to be open.
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
                    <PdfViewer url={api.getPdfUrl(currentDoi)} highlightText={highlightedText} />
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

        <div className="w-[450px] flex-shrink-0 flex flex-col bg-black/40 border-l border-white/5 backdrop-blur-md">
          {!paperData.is_extracted ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <h3 className="text-xl font-bold mb-4 text-white">数据未提取</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-10 px-4">核心性能参数尚未从本文献中提取。</p>
              <button type="button" onClick={handleStartExtraction} className="w-full py-5 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold shadow-2xl shadow-brand-500/30 transition-all">
                开始 AI 参数解析
              </button>
            </div>
          ) : (
            <>
              <div className="flex border-b border-white/5 bg-white/5">
                {[
                  { id: 'device', label: '核心性能' },
                  { id: 'process', label: '工艺参数' }
                ].map(tab => (
                  <button type="button" key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-grow py-5 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === tab.id ? 'text-brand-400 border-b-2 border-brand-500 bg-brand-500/10' : 'text-slate-500 hover:text-slate-300'}`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex-grow overflow-y-auto p-8 space-y-8 scrollbar-hide">
                {activeTab === 'device' ? (
                  <div className="grid grid-cols-2 gap-4">
                    {paperData.metrics.map((m: any, i: number) => (
                      <div key={i} onClick={() => { setHighlightedText(m.evidence); setViewMode('pdf'); }} className={`p-5 rounded-2xl border transition-all cursor-pointer group ${highlightedText === m.evidence ? 'bg-brand-500/10 border-brand-500/40 ring-1 ring-brand-500/30 shadow-lg' : 'bg-white/5 border-white/5 hover:border-white/20'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{m.label}</span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-brand-400">溯源 →</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-bold text-slate-100">{m.value}</span>
                          <span className="text-xs text-slate-500">{m.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {paperData.process.map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 transition-all group">
                        <span className="text-xs text-slate-400 group-hover:text-slate-300">{item.field}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-200">{item.value}</span>
                          {item.source === 'si' && <span className="text-[8px] font-bold text-brand-500/60 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20">SI</span>}
                        </div>
                      </div>
                    ))}
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
    </div>
  );
};

export default DetailsPage;
