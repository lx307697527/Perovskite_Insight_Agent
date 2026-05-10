import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import * as literatureApi from '../services/literatureApi';
import * as projectApi from '../services/projectApi';

const DOI_REGEX = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;

function detectInputType(input: string): 'doi' | 'pdf' | 'keyword' {
  const trimmed = input.trim();
  if (DOI_REGEX.test(trimmed)) return 'doi';
  if (trimmed.endsWith('.pdf') || /^[A-Za-z]:\\/.test(trimmed)) return 'pdf';
  return 'keyword';
}

const QuickModePage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [detectedType, setDetectedType] = useState<'doi' | 'pdf' | 'keyword' | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<projectApi.ProjectWithStats[]>([]);

  // Load projects on mount
  React.useEffect(() => {
    projectApi.listProjects().then(setProjects).catch(() => {});
  }, []);

  const handleInputChange = (value: string) => {
    setInput(value);
    setDetectedType(value.trim() ? detectInputType(value) : null);
  };

  const handleSubmit = async () => {
    if (!input.trim()) return;
    setLoading(true);

    try {
      const result = await literatureApi.addLiterature(input.trim(), selectedProjectId);

      if (result.type === 'keyword' && result.results) {
        // Keyword search — navigate to results
        showToast(`找到 ${result.results.length} 篇相关文献`, 'success');
        navigate('/results');
      } else if (result.type === 'doi') {
        if (result.cached) {
          showToast('文献已存在于库中', 'info');
        } else {
          showToast('文献已添加，开始提取', 'success');
        }
        navigate(`/details/${result.doi}`);
      } else if (result.type === 'pdf') {
        showToast('PDF 文件已添加', 'success');
        navigate(`/details/${result.doi}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加失败';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('仅支持 PDF 文件', 'error');
      return;
    }

    setLoading(true);
    try {
      const result = await literatureApi.uploadLiterature(file, selectedProjectId);
      showToast('文件上传成功', 'success');
      navigate(`/details/${result.doi}`);
    } catch (err) {
      showToast('上传失败', 'error');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="h-screen bg-premium-bg flex flex-col items-center pt-20 px-8">
      <div className="text-center mb-10">
        <h1 className="text-2xl font-bold text-white mb-2">快捷模式</h1>
        <p className="text-slate-400 text-sm">单篇文献快速处理 — 粘贴 DOI、上传 PDF 或输入关键词</p>
      </div>

      {/* Unified Input Box */}
      <div className="w-full max-w-3xl relative group z-20">
        <div className="absolute -inset-1 bg-gradient-to-r from-brand-500 to-indigo-600 rounded-3xl blur opacity-20 group-hover:opacity-30 transition duration-1000 group-hover:duration-200" />
        <div className="relative glass-card rounded-3xl p-2 flex flex-col border-white/10 shadow-2xl">
          <textarea
            className="w-full bg-transparent border-none p-6 text-lg text-slate-100 focus:outline-none min-h-[120px] resize-none placeholder:text-slate-600"
            placeholder="粘贴 DOI (10.xxx/xxx) 或输入关键词搜索..."
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSubmit())}
          />

          {/* Type indicator */}
          {detectedType && (
            <div className="px-6 pb-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                detectedType === 'doi' ? 'bg-emerald-500/10 text-emerald-400' :
                detectedType === 'pdf' ? 'bg-blue-500/10 text-blue-400' :
                'bg-purple-500/10 text-purple-400'
              }`}>
                {detectedType === 'doi' ? 'DOI 识别' : detectedType === 'pdf' ? '本地 PDF' : '关键词搜索'}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center p-4 border-t border-white/5">
            <div className="flex items-center gap-3">
              {/* Project selector */}
              <select
                title="选择归档项目"
                value={selectedProjectId || ''}
                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-brand-500/50"
              >
                <option value="">收集箱</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {/* File upload */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-slate-500 hover:text-brand-400 transition-colors text-xs font-bold flex items-center gap-1"
              >
                📎 上传 PDF
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
                title="上传 PDF 文件"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed py-2 px-8 text-sm"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  处理中...
                </>
              ) : (
                '添加 →'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Quick hints */}
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
    </div>
  );
};

export default QuickModePage;
