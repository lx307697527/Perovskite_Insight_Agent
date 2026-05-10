import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { List } from 'react-window';
import * as api from '../services/api';
import type { Paper } from '../types';
import { useAppStore } from '../store';

const Row = ({ index, style, ...props }: any) => {
  const { filteredResults, selectedDocs, toggleSelect, onOpenDetails, handleExtract } = props;
  const doc = filteredResults[index];
  const [isExpanded, setIsExpanded] = useState(false);

  if (!doc) return null;

  const isSelected = selectedDocs.includes(doc.doi);

  return (
    <div style={style} className="pr-4 pb-4">
      <div className={`glass-card rounded-2xl p-6 transition-all duration-300 border-white/5 hover:border-brand-500/30 group ${isSelected ? 'ring-2 ring-brand-500/50 bg-brand-500/5' : ''}`}>
        <div className="flex gap-6">
          <div className="pt-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSelect(doc.doi)}
              className="w-5 h-5 rounded border-white/10 bg-white/5 text-brand-500"
            />
          </div>

          <div className="flex-grow">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-3">
                <div className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{doc.journal || 'Unknown'}</div>
                <span className="text-slate-500 text-sm">{doc.year} · {doc.authors}</span>
                <a
                  href={`https://doi.org/${doc.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-brand-400 hover:text-brand-300 underline flex items-center gap-1"
                >
                  查看原文
                </a>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">相关性</span>
                <span className="text-xs font-bold text-brand-400">{doc.relevance}%</span>
              </div>
            </div>

            <h3
              onClick={() => onOpenDetails(doc.doi)}
              className="text-lg font-bold mb-2 group-hover:text-brand-400 transition-colors cursor-pointer truncate"
            >
              {doc.title}
            </h3>

            <div className="relative mb-4">
              <div className={`text-xs text-slate-400 leading-relaxed transition-all duration-300 overflow-hidden ${isExpanded ? 'max-h-48 overflow-y-auto pr-2' : 'line-clamp-2'}`}>
                {doc.abstract || '摘要内容获取中...'}
              </div>
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-[10px] font-bold text-brand-500/70 hover:text-brand-500 mt-1 transition-colors"
              >
                {isExpanded ? '收起' : '展开全文'}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                {doc.extracting ? (
                  <div className="flex items-center gap-3 bg-brand-500/5 px-4 py-2 rounded-lg border border-brand-500/20">
                    <div className="w-32 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 animate-pulse" style={{ width: `${doc.progress}%` }}></div>
                    </div>
                    <span className="text-[10px] font-bold text-brand-400">AI 正在解析 {doc.progress}%</span>
                  </div>
                ) : doc.metrics && Array.isArray(doc.metrics) && doc.metrics.length > 0 ? (
                  <>
                    {doc.metrics.slice(0, 4).map((metric: any, idx: number) => (
                      <div key={idx} className="flex flex-col">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">{metric.field}</span>
                        <span className="text-sm font-bold text-emerald-400" title={metric.evidence}>
                          {metric.value}
                        </span>
                      </div>
                    ))}
                  </>
                ) : doc.metrics && !Array.isArray(doc.metrics) ? (
                  <>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">PCE</span>
                      <span className="text-sm font-bold text-emerald-400">
                        {typeof doc.metrics.pce === 'object' ? doc.metrics.pce.value : doc.metrics.pce}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Voc</span>
                      <span className="text-sm font-bold text-slate-200">
                        {typeof doc.metrics.voc === 'object' ? doc.metrics.voc.value : doc.metrics.voc}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Jsc</span>
                      <span className="text-sm font-bold text-slate-200">
                        {typeof doc.metrics.jsc === 'object' ? doc.metrics.jsc.value : doc.metrics.jsc}
                      </span>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleExtract(doc.doi)}
                    className="px-4 py-1.5 rounded-lg bg-brand-600/20 hover:bg-brand-600/40 text-brand-400 text-xs font-bold border border-brand-500/30 transition-all"
                  >
                    提取参数
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => onOpenDetails(doc.doi)}
                className="text-xs font-bold text-brand-400 hover:text-brand-300 transition-colors bg-brand-400/5 px-3 py-1 rounded-lg border border-brand-400/10"
              >
                详情 →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ResultsPage: React.FC = () => {
  const navigate = useNavigate();
  const { searchResults, searchWarning, setSelectedDoi } = useAppStore();
  const [results, setResults] = useState<Paper[]>(searchResults);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const extractingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    results.forEach(doc => {
      if (doc.extracting &&
          doc.progress === 0 &&
          !extractingRef.current.has(doc.doi) &&
          !eventSourcesRef.current.has(doc.doi)) {
        extractingRef.current.add(doc.doi);
        setTimeout(() => {
          if (!eventSourcesRef.current.has(doc.doi)) {
            handleExtract(doc.doi);
          }
        }, 10);
      }
    });
  }, [results]);

  useEffect(() => {
    return () => {
      eventSourcesRef.current.forEach(es => es.close());
    };
  }, []);

  const filteredResults = results.filter(doc =>
    doc.title.toLowerCase().includes(filter.toLowerCase()) ||
    doc.doi.toLowerCase().includes(filter.toLowerCase())
  );

  const toggleSelect = (doi: string) => {
    setSelectedDocs(prev => prev.includes(doi) ? prev.filter(d => d !== doi) : [...prev, doi]);
  };

  const handleExtract = (doi: string, retryCount = 0) => {
    if (eventSourcesRef.current.has(doi)) return;

    setResults(prev => prev.map(doc =>
      doc.doi === doi ? { ...doc, extracting: true, progress: doc.progress || 0 } : doc
    ));

    const doc = results.find(d => d.doi === doi);
    let eventSource: EventSource;
    if (doc?.isUploaded) {
      eventSource = api.createUploadExtractionConnection(doi);
    } else if (doc?.localPath) {
      eventSource = api.createLocalExtractionConnection(doc.localPath);
    } else {
      eventSource = api.createExtractionConnection(doi);
    }

    eventSourcesRef.current.set(doi, eventSource);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (['extracting', 'parsing', 'downloading', 'analyzing_si'].includes(data.status)) {
        setResults(prev => prev.map(doc =>
          doc.doi === doi ? { ...doc, progress: data.progress || doc.progress } : doc
        ));
      } else if (data.status === 'completed') {
        setResults(prev => prev.map(doc =>
          doc.doi === doi ? {
            ...doc,
            extracting: false,
            progress: 100,
            metrics: data.result?.metrics,
            quality: 'good',
            qualityText: data.result?.qualityText || '解析完成'
          } : doc
        ));
        eventSource.close();
        eventSourcesRef.current.delete(doi);
      } else if (data.status === 'failed' || data.status === 'error') {
        handleSSEError(doi, eventSource, retryCount);
      }
    };

    eventSource.onerror = () => {
      handleSSEError(doi, eventSource, retryCount);
    };
  };

  const handleSSEError = (doi: string, es: EventSource, retryCount: number) => {
    es.close();
    eventSourcesRef.current.delete(doi);
    if (retryCount < 3) {
      setTimeout(() => handleExtract(doi, retryCount + 1), 2000);
    } else {
      setResults(prev => prev.map(doc =>
        doc.doi === doi ? { ...doc, extracting: false } : doc
      ));
    }
  };

  return (
    <div className="h-screen bg-premium-bg flex flex-col">
      <nav className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-xl flex items-center px-8 justify-between z-50">
        <div className="flex items-center gap-6">
          <button type="button" onClick={() => navigate('/home')} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-sm">
            ← 返回搜索
          </button>
          <div className="h-4 w-[1px] bg-white/10"></div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse"></span>
            <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">Analysis Engine Active</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="在结果中过滤..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-1.5 text-xs focus:outline-none focus:border-brand-500/50 w-64 transition-all"
          />
        </div>
      </nav>

      <main className="flex-grow flex flex-col overflow-hidden px-8 pt-6 pb-20">
        {searchWarning && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <p className="text-sm text-amber-200/80">{searchWarning}</p>
          </div>
        )}

        <div className="flex justify-between items-end mb-8">
          <h2 className="text-2xl font-bold mb-2">找到 {filteredResults.length} 篇相关文献</h2>
          <button
            type="button"
            onClick={() => {
              useAppStore.getState().toggleComparisonDoi(selectedDocs[0] || '');
              navigate('/compare');
            }}
            disabled={selectedDocs.length === 0}
            className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold transition-all disabled:opacity-30 shadow-lg shadow-brand-500/20"
          >
            开始对比分析 ({selectedDocs.length})
          </button>
        </div>

        <div className="flex-grow overflow-hidden">
          <List
            height={window.innerHeight - 300}
            rowCount={filteredResults.length}
            rowHeight={240}
            width="100%"
            rowComponent={Row}
            rowProps={{
              filteredResults,
              selectedDocs,
              toggleSelect,
              onOpenDetails: (doi: string) => { setSelectedDoi(doi); navigate(`/details/${doi}`); },
              handleExtract
            }}
          />
        </div>
      </main>
    </div>
  );
};

export default ResultsPage;
