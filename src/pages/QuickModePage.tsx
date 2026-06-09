import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import * as literatureApi from '../services/literatureApi';
import { createStage1Connection } from '../services/extractApi';
import StageProgress from '../components/StageProgress';
import UnifiedInputBox from '../components/UnifiedInputBox';
import type { SSEEvent, Literature } from '../types';

const QuickModePage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useAppStore();
  const [loading, setLoading] = useState(false);

  // Inline extraction state
  const [extractingDoi, setExtractingDoi] = useState<string | null>(null);
  const [extractionEvent, setExtractionEvent] = useState<SSEEvent | null>(null);
  const [extractedLiterature, setExtractedLiterature] = useState<Literature | null>(null);

  // Recent inbox items
  const [recentItems, setRecentItems] = useState<Literature[]>([]);

  const extractCleanupRef = useRef<(() => void) | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    // Load recent inbox items
    literatureApi.listInbox()
      .then((items) => { if (isMounted.current) setRecentItems(items.slice(0, 5)); })
      .catch(() => {});
    return () => {
      isMounted.current = false;
      extractCleanupRef.current?.();
    };
  }, []);

  // Start inline Stage1 extraction after paper is added
  const startInlineExtraction = (targetDoi: string) => {
    setExtractingDoi(targetDoi);
    setExtractionEvent(null);
    setExtractedLiterature(null);

    extractCleanupRef.current = createStage1Connection(
      targetDoi,
      (event: SSEEvent) => {
        if (!isMounted.current) return;
        setExtractionEvent(event);

        if (event.status === 'completed' || event.status === 'cached') {
          showToast('Stage1 筛选完成，即将跳转', 'success');
          // Load literature summary
          literatureApi.getLiterature(targetDoi)
            .then((lit) => { if (isMounted.current) setExtractedLiterature(lit); })
            .catch(() => {});
          // Navigate after brief delay to let user see the result
          setTimeout(() => {
            if (isMounted.current) navigate(`/insight/${targetDoi}`);
          }, 1800);
        }

        if (event.status === 'failed') {
          showToast(event.error || '筛选失败', 'error');
          setExtractingDoi(null);
        }
      },
      (error) => {
        if (!isMounted.current) return;
        showToast(error.message, 'error');
        setExtractingDoi(null);
      },
    );
  };

  const handleSubmit = async (input: string, type: 'doi' | 'pdf' | 'keyword', projectId?: string | null) => {
    setLoading(true);
    try {
      const result = await literatureApi.addLiterature(input, projectId);

      if (result.type === 'keyword' && result.results) {
        showToast(`找到 ${result.results.length} 篇相关文献`, 'success');
        navigate('/results');
      } else if (result.type === 'doi') {
        if (result.cached) {
          showToast('文献已存在于库中，直接查看', 'info');
          navigate(`/insight/${result.doi}`);
        } else {
          showToast('文献已添加，开始筛选', 'success');
          setLoading(false);
          startInlineExtraction(result.doi);
          return; // stay on page for inline extraction
        }
      } else if (result.type === 'pdf') {
        showToast('PDF 文件已添加，开始筛选', 'success');
        setLoading(false);
        startInlineExtraction(result.doi);
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加失败';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File, projectId?: string | null) => {
    setLoading(true);
    try {
      const result = await literatureApi.uploadLiterature(file, projectId);
      showToast('文件上传成功，开始筛选', 'success');
      setLoading(false);
      startInlineExtraction(result.doi);
    } catch {
      showToast('上传失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-premium-bg flex flex-col items-center pt-16 px-8 overflow-y-auto">
      <div className="text-center mb-10">
        <h1 className="text-2xl font-bold text-white mb-2">快捷模式</h1>
        <p className="text-slate-400 text-sm">单篇文献快速处理 — 粘贴 DOI、上传 PDF 或输入关键词</p>
      </div>

      <UnifiedInputBox
        onSubmit={handleSubmit}
        onFileUpload={handleFileUpload}
        loading={loading}
        placeholder="粘贴 DOI (10.xxx/xxx) 或输入关键词搜索..."
      />

      {/* Inline extraction progress */}
      {extractingDoi && (
        <div className="w-full max-w-3xl mt-6 animate-fade-in">
          <StageProgress
            event={extractionEvent}
            onCancel={() => {
              extractCleanupRef.current?.();
              setExtractingDoi(null);
            }}
          />
        </div>
      )}

      {/* Quick summary card after extraction completes */}
      {extractedLiterature && (
        <div className="w-full max-w-3xl mt-6 glass-card rounded-2xl p-5 border-white/5 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-bold text-emerald-400">筛选完成</span>
            <span className="text-[10px] text-slate-500 ml-auto">即将跳转至见解实验室...</span>
          </div>
          <h4 className="text-sm font-bold text-white truncate">{extractedLiterature.title}</h4>
          <p className="text-[11px] text-slate-500 mt-1">
            {extractedLiterature.journal} {extractedLiterature.year} · {extractedLiterature.authors}
          </p>
          {extractedLiterature.abstract && (
            <p className="text-xs text-slate-400 mt-3 line-clamp-3 leading-relaxed">{extractedLiterature.abstract}</p>
          )}
        </div>
      )}

      {/* Quick hints */}
      {!extractingDoi && !extractedLiterature && (
        <div className="w-full max-w-3xl mt-10 grid grid-cols-3 gap-4">
          {[
            { icon: '🔗', title: 'DOI', desc: '粘贴 10.xxx/xxx 格式，自动下载并提取' },
            { icon: '📄', title: 'PDF', desc: '上传本地 PDF 文件进行参数提取' },
            { icon: '🔍', title: '关键词', desc: '输入研究关键词，搜索相关文献' },
          ].map((hint) => (
            <div key={hint.title} className="glass-card p-4 rounded-2xl border-white/5 text-center">
              <div className="text-2xl mb-2">{hint.icon}</div>
              <h4 className="text-sm font-bold text-slate-200 mb-1">{hint.title}</h4>
              <p className="text-[11px] text-slate-500">{hint.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recent inbox items */}
      {recentItems.length > 0 && !extractingDoi && (
        <div className="w-full max-w-3xl mt-10 mb-16">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <span className="w-1 h-3 bg-indigo-500 rounded-full" />
            最近文献
          </h3>
          <div className="space-y-3">
            {recentItems.map((item) => (
              <button
                key={item.doi}
                type="button"
                onClick={() => navigate(`/insight/${item.doi}`)}
                className="w-full glass-card p-4 rounded-2xl border-white/5 text-left hover:border-brand-500/30 transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-200 truncate group-hover:text-white transition-colors">
                      {item.title}
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {item.journal} {item.year} · {item.authors}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.extraction_stage === 'stage2' && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">已深度提取</span>
                    )}
                    {item.extraction_stage === 'stage1' && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">已筛选</span>
                    )}
                    <svg className="w-4 h-4 text-slate-600 group-hover:text-brand-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickModePage;
