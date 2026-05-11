import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import UnifiedInputBox from '../components/UnifiedInputBox';
import * as literatureApi from '../services/literatureApi';

const QuickModePage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useAppStore();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (input: string, type: 'doi' | 'pdf' | 'keyword', projectId?: string | null) => {
    setLoading(true);
    try {
      const result = await literatureApi.addLiterature(input, projectId);

      if (result.type === 'keyword' && result.results) {
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

  const handleFileUpload = async (file: File, projectId?: string | null) => {
    setLoading(true);
    try {
      const result = await literatureApi.uploadLiterature(file, projectId);
      showToast('文件上传成功', 'success');
      navigate(`/details/${result.doi}`);
    } catch (err) {
      showToast('上传失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-premium-bg flex flex-col items-center pt-20 px-8">
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
