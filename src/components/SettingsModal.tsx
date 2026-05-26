import React, { useState, useEffect } from 'react';
import * as api from '../services/api';
import * as configApi from '../services/configApi';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SystemStatus {
  embeddingStatus: 'not_installed' | 'loading' | 'ready';
  cacheSizeMb: number;
  totalPapers: number;
  extractedCount: number;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState({
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat'
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  // System status for cache and embedding
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    embeddingStatus: 'not_installed',
    cacheSizeMb: 0,
    totalPapers: 0,
    extractedCount: 0,
  });
  const [clearingCache, setClearingCache] = useState(false);

  // Load config and system status
  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem('pia_config');
      if (saved) {
        setConfig(JSON.parse(saved));
      }
      loadSystemStatus();
    }
  }, [isOpen]);

  const loadSystemStatus = async () => {
    try {
      const [statusData, cacheData] = await Promise.all([
        configApi.getConfigStatus(),
        configApi.getCacheStats(),
      ]);
      setSystemStatus({
        embeddingStatus: statusData.embedding_status as SystemStatus['embeddingStatus'],
        cacheSizeMb: cacheData.cache_size_mb,
        totalPapers: cacheData.total_papers,
        extractedCount: cacheData.extracted_count,
      });
    } catch (err) {
      console.error('Failed to load system status:', err);
    }
  };

  const handleTestConnectivity = async () => {
    if (!config.apiKey.trim() || !config.baseUrl.trim()) {
      setTestError('请先填写 API Key 和 Base URL');
      setTestStatus('error');
      return;
    }

    setTestStatus('testing');
    setTestError(null);

    try {
      // Test API connectivity via backend proxy to avoid CORS
      await configApi.testConnectivity({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      });

      setTestStatus('success');
      setTimeout(() => setTestStatus('idle'), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '连接失败';
      setTestError(errorMsg);
      setTestStatus('error');
    }
  };

  const handleClearCache = async () => {
    if (!confirm('确定清理缓存？这会删除已下载的 PDF 文件，但不会删除数据库中的提取记录。')) {
      return;
    }

    setClearingCache(true);
    try {
      await configApi.clearCache();
      await loadSystemStatus();
    } catch (err) {
      console.error('Failed to clear cache:', err);
    } finally {
      setClearingCache(false);
    }
  };

  const handleSave = async () => {
    setStatus('saving');
    localStorage.setItem('pia_config', JSON.stringify(config));

    try {
      await api.saveSettings(config);
      setStatus('success');
      setTimeout(() => {
        onClose();
        setStatus('idle');
      }, 1500);
    } catch (err) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  if (!isOpen) return null;

  const embeddingStatusConfig = {
    not_installed: { color: 'text-slate-500', bg: 'bg-slate-500/10', label: '未安装', icon: '○' },
    loading: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: '加载中...', icon: '◐' },
    ready: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: '已就绪', icon: '●' },
  };

  const embConfig = embeddingStatusConfig[systemStatus.embeddingStatus];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-6 animate-fade-in">
      <div className="glass-card w-full max-w-lg rounded-3xl p-8 border-white/10 animate-zoom-in max-h-[90vh] overflow-y-auto">
        {status === 'success' ? (
          <div className="py-10 text-center space-y-4">
            <div className="w-20 h-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto animate-zoom-in">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white">服务配置已生效</h3>
            <p className="text-slate-400 text-sm">深度分析引擎已就绪，正在同步后端状态...</p>
          </div>
        ) : (
          <>
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="text-brand-400">⚙️</span> 设置中心
            </h3>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 p-1 bg-white/5 rounded-xl">
              <button
                type="button"
                className="flex-1 py-2 px-4 rounded-lg text-sm font-bold bg-white/10 text-white"
              >
                AI 引擎
              </button>
              <button
                type="button"
                className="flex-1 py-2 px-4 rounded-lg text-sm font-bold text-slate-400 hover:text-white transition-colors"
              >
                系统状态
              </button>
            </div>

            <div className="space-y-6">
              {/* AI Engine Config */}
              <div className="space-y-5">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block tracking-widest">API Key</label>
                  <input
                    type="password"
                    className="premium-input w-full"
                    placeholder="DeepSeek API Key"
                    value={config.apiKey}
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block tracking-widest">Base URL</label>
                  <input
                    type="text"
                    className="premium-input w-full"
                    placeholder="https://api.deepseek.com"
                    value={config.baseUrl}
                    onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block tracking-widest">Model Name</label>
                  <input
                    type="text"
                    className="premium-input w-full"
                    placeholder="e.g. deepseek-chat, qwen-max, gpt-4o"
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  />
                  <p className="text-[9px] text-slate-600 mt-2 px-1">支持所有兼容 OpenAI 接口协议的模型 (如 DeepSeek, Qwen, Moonshot 等)</p>
                </div>
              </div>

              {/* Test Connectivity Button */}
              <button
                type="button"
                onClick={handleTestConnectivity}
                disabled={testStatus === 'testing'}
                className="w-full py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-bold text-slate-300 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {testStatus === 'testing' ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    测试中...
                  </>
                ) : testStatus === 'success' ? (
                  <>
                    <span className="text-emerald-400">✓</span>
                    连接成功
                  </>
                ) : (
                  <>
                    <span>🔌</span>
                    测试连通性
                  </>
                )}
              </button>

              {testStatus === 'error' && testError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                  {testError}
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-white/5 pt-6">
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="w-1 h-3 bg-indigo-500 rounded-full" />
                  系统状态
                </h4>

                {/* Embedding Status */}
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${embConfig.bg} flex items-center justify-center`}>
                      <span className={embConfig.color}>{embConfig.icon}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Embedding 模型</p>
                      <p className="text-[10px] text-slate-500">BAAI/bge-base-en-v1.5 本地模型</p>
                    </div>
                  </div>
                  <span className={`text-xs font-bold ${embConfig.color} ${embConfig.bg} px-2 py-1 rounded`}>
                    {embConfig.label}
                  </span>
                </div>

                {/* Cache Management */}
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-500/10 flex items-center justify-center">
                      <span className="text-brand-400">📦</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">PDF 缓存</p>
                      <p className="text-[10px] text-slate-500">
                        {systemStatus.totalPapers} 篇文献 · {systemStatus.extractedCount} 已提取
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-300">
                      {systemStatus.cacheSizeMb.toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      onClick={handleClearCache}
                      disabled={clearingCache || systemStatus.cacheSizeMb === 0}
                      className="text-[10px] text-red-400 hover:text-red-300 font-bold px-2 py-1 rounded border border-red-500/20 hover:border-red-500/40 transition-all disabled:opacity-50"
                    >
                      {clearingCache ? '清理中...' : '清理'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {status === 'error' && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2 animate-slide-down">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                同步失败，请确保后端 Sidecar 已启动
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button
                type="button"
                onClick={onClose}
                disabled={status === 'saving'}
                className="flex-grow py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-sm font-bold transition-all text-slate-400 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={status === 'saving'}
                className="flex-grow btn-primary flex items-center justify-center gap-2 min-w-[140px]"
              >
                {status === 'saving' ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    正在同步...
                  </>
                ) : '保存并激活'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SettingsModal;
