import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingsModal from '../components/SettingsModal';
import * as api from '../services/api';
import type { Paper } from '../types';
import { useAppStore } from '../store';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { setSearchResults, setSelectedDoi } = useAppStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [extractionHistory, setExtractionHistory] = useState<Paper[]>([]);
  const [filters, setFilters] = useState({
    yearStart: '2020',
    yearEnd: '2026',
    minPce: '20'
  });
  const [tags, setTags] = useState([
    { label: '组分: Triple Cation', type: 'composition' },
    { label: 'PCE ≥ 24%', type: 'performance' },
    { label: 'n-i-p 结构', type: 'structure' }
  ]);
  const [toast, setToast] = useState<{message: string, type: 'info' | 'error' | 'success'} | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const showToast = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const saved = localStorage.getItem('pia_search_history');
    if (saved) setHistory(JSON.parse(saved));
    fetchExtractionHistory();
    return () => { isMounted.current = false; };
  }, []);

  const fetchExtractionHistory = async () => {
    try {
      const data = await api.fetchExtractionHistory();
      if (isMounted.current) setExtractionHistory(data);
    } catch (err) {
      console.error('Failed to fetch extraction history:', err);
    }
  };

  const saveToHistory = (q: string, results: Paper[], warning?: string | null) => {
    const trimmedQ = q.trim();
    if (!trimmedQ) return;
    const newHistory = [trimmedQ, ...history.filter(h => h !== trimmedQ)].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('pia_search_history', JSON.stringify(newHistory));
    const cache = JSON.parse(localStorage.getItem('pia_search_cache') || '{}');
    cache[trimmedQ] = { results, warning, timestamp: Date.now() };
    localStorage.setItem('pia_search_cache', JSON.stringify(cache));
  };

  const clearSearchHistory = () => {
    setConfirmDialog({
      isOpen: true,
      title: '清空历史',
      message: '确定要清空所有搜索记录和缓存的结果吗？',
      onConfirm: () => {
        setHistory([]);
        localStorage.removeItem('pia_search_history');
        localStorage.removeItem('pia_search_cache');
        showToast('搜索历史已清空', 'success');
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const clearExtractedHistory = async () => {
    setConfirmDialog({
      isOpen: true,
      title: '清空文献库',
      message: '确定要清空所有已解析文献和本地 PDF 文件吗？此操作不可撤销。',
      onConfirm: async () => {
        try {
          await api.clearAllHistory();
          setExtractionHistory([]);
          showToast('文献库已清空', 'success');
        } catch (err) {
          showToast('清空失败', 'error');
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleSearch = async (q?: string) => {
    const searchQ = q || query;
    if (!searchQ.trim()) return;

    const cache = JSON.parse(localStorage.getItem('pia_search_cache') || '{}');
    if (cache[searchQ]) {
      setSearchResults(cache[searchQ].results, cache[searchQ].warning);
      navigate('/results');
      return;
    }

    setLoading(true);
    try {
      const data = await api.searchPapers(searchQ, isAdvancedOpen ? filters : null);
      if (isMounted.current) {
        saveToHistory(searchQ, data.results, data.warning);
        setSearchResults(data.results, data.warning);
        navigate('/results');
      }
    } catch (err) {
      if (isMounted.current) showToast('搜索失败', 'error');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  return (
    <div className="h-screen bg-premium-bg flex flex-col items-center pt-24 px-8 overflow-hidden relative">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDialog(prev => ({...prev, isOpen: false}))}></div>
          <div className="relative glass-card w-full max-w-md rounded-3xl p-8 border-white/10 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-4">{confirmDialog.title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-8">{confirmDialog.message}</p>
            <div className="flex gap-4">
              <button
                onClick={() => setConfirmDialog(prev => ({...prev, isOpen: false}))}
                className="flex-grow py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold hover:bg-white/10 transition-all"
              >
                取消
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="flex-grow py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold shadow-lg shadow-red-500/20 transition-all"
              >
                确认清除
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="text-center mb-16 relative z-10">
        <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-6 animate-fade-in">
          v2.1.0 · Scientific Research Intelligence
        </div>
        <h1 className="text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-slate-500 mb-6 tracking-tighter">
          Sci-Insight Agent
        </h1>
        <p className="text-xl text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed">
          基于语义理解的科研参数精准提取平台，深度解析主文与补充材料 (SI)
        </p>
      </div>

      {/* Search Container */}
      <div className="w-full max-w-4xl relative group z-20">
        <div className="absolute -inset-1 bg-gradient-to-r from-brand-500 to-indigo-600 rounded-3xl blur opacity-20 group-hover:opacity-30 transition duration-1000 group-hover:duration-200"></div>
        <div className="relative glass-card rounded-3xl p-2 flex flex-col border-white/10 shadow-2xl">
          <textarea
            className="w-full bg-transparent border-none p-6 text-xl text-slate-100 focus:outline-none min-h-[140px] resize-none placeholder:text-slate-600"
            placeholder="输入组分、性能指标或粘贴 DOI... (例如: Cs/FA/MA 三阳离子 PCE > 24% n-i-p 结构)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSearch())}
          />

          <div className="px-6 pb-4 flex flex-wrap gap-2">
            {tags.map((tag, idx) => (
              <span key={idx} className={`px-3 py-1 rounded-full text-[11px] font-semibold flex items-center gap-2 border ${
                tag.type === 'composition' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                tag.type === 'performance' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                'bg-purple-500/10 border-purple-500/20 text-purple-400'
              }`}>
                {tag.label}
                <button onClick={() => setTags(tags.filter((_, i) => i !== idx))} className="hover:text-white ml-1">×</button>
              </span>
            ))}
          </div>

          <div className="flex justify-between items-center p-4 border-t border-white/5">
            <button onClick={() => setIsAdvancedOpen(!isAdvancedOpen)} className={`text-xs transition-colors px-4 flex items-center gap-1 ${isAdvancedOpen ? 'text-brand-400 font-bold' : 'text-slate-500 hover:text-brand-400'}`}>
              高级筛选 <span className={`text-[10px] transition-transform duration-300 ${isAdvancedOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            <button onClick={() => handleSearch()} disabled={loading} className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed py-2 px-8">
              {loading ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>分析意图中...</>) : 'AI 检索 →'}
            </button>
          </div>

          {isAdvancedOpen && (
            <div className="px-6 pb-4 pt-2 border-t border-white/5 animate-in slide-in-from-top-2 duration-200">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">起始年份</label>
                  <input
                    type="number"
                    value={filters.yearStart}
                    onChange={(e) => setFilters({...filters, yearStart: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="2020"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">结束年份</label>
                  <input
                    type="number"
                    value={filters.yearEnd}
                    onChange={(e) => setFilters({...filters, yearEnd: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="2026"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">最低 PCE (%)</label>
                  <input
                    type="number"
                    value={filters.minPce}
                    onChange={(e) => setFilters({...filters, minPce: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="20"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History and Quick Access Panels */}
      <div className="w-full max-w-5xl mt-16 grid grid-cols-2 gap-12 pb-24 z-10">
        <section>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <span className="w-1 h-3 bg-brand-500 rounded-full"></span> 搜索历史
            </h3>
            {history.length > 0 && (
              <button type="button" onClick={clearSearchHistory} className="text-[10px] text-slate-600 hover:text-red-400 transition-colors font-bold">
                全部清除
              </button>
            )}
          </div>
          <div className="space-y-3">
            {history.length > 0 ? history.map((h, i) => (
              <div key={i} onClick={() => handleSearch(h)} className="glass-card p-4 rounded-2xl border-white/5 hover:border-brand-500/30 transition-all cursor-pointer flex justify-between items-center group">
                <span className="text-sm text-slate-300 group-hover:text-brand-400 transition-colors">{h}</span>
                <span className="text-[10px] text-slate-600 group-hover:text-slate-400 font-mono">缓存</span>
              </div>
            )) : (
              <div className="py-12 border border-dashed border-white/10 rounded-3xl text-center">
                <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">暂无历史记录</p>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <span className="w-1 h-3 bg-indigo-500 rounded-full"></span> 已提取文献库
            </h3>
            {extractionHistory.length > 0 && (
              <button type="button" onClick={clearExtractedHistory} className="text-[10px] text-slate-600 hover:text-red-400 transition-colors font-bold">
                清空库
              </button>
            )}
          </div>
          <div className="space-y-3">
            {extractionHistory.length > 0 ? extractionHistory.map((p, i) => (
              <div key={i} onClick={() => { setSelectedDoi(p.doi); navigate(`/details/${p.doi}`); }} className="glass-card p-4 rounded-2xl border-white/5 hover:border-indigo-500/30 transition-all cursor-pointer group">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase">{p.journal} {p.year}</span>
                  <span className="text-[10px] text-slate-600 group-hover:text-slate-400 font-mono">DOI: {p.doi}</span>
                </div>
                <h4 className="text-sm font-bold text-slate-200 group-hover:text-indigo-400 transition-colors truncate">{p.title}</h4>
              </div>
            )) : (
              <div className="py-12 border border-dashed border-white/10 rounded-3xl text-center">
                <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">文献库为空</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Floating Action Menu */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900/80 backdrop-blur-2xl px-6 py-3 rounded-2xl border border-white/10 shadow-2xl flex items-center gap-6 z-50">
        <button type="button" onClick={() => setIsSettingsOpen(true)} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-xs font-bold">
          设置
        </button>
        <div className="h-4 w-[1px] bg-white/10"></div>
        <button type="button"
          onClick={() => { window.location.href = api.getExportUrl(['all']); }}
          className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-xs font-bold"
        >
          全库导出
        </button>
        <div className="h-4 w-[1px] bg-white/10"></div>
        <label className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-xs font-bold cursor-pointer">
          导入本地 PDF
          <input type="file" className="hidden" accept=".pdf" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              showToast('正在上传文件...', 'info');
              try {
                const result = await api.uploadPdfForExtraction(file);
                setSearchResults([{
                  doi: result.doi,
                  title: '上传的 PDF 文件',
                  isUploaded: true,
                  extracting: true,
                  progress: 0,
                  relevance: 100
                }]);
                navigate('/results');
                showToast('文件上传成功，开始解析', 'success');
              } catch (err) {
                showToast('文件上传失败', 'error');
              }
            }
          }} />
        </label>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top-4 duration-300">
          <div className={`px-6 py-3 rounded-2xl border shadow-2xl flex items-center gap-3 ${
            toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            'bg-brand-500/10 border-brand-500/30 text-brand-400'
          }`}>
            <span className="text-xs font-bold">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
