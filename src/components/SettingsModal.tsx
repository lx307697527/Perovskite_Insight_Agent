import React, { useState, useEffect } from 'react';
import * as api from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState({
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat'
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  useEffect(() => {
    const saved = localStorage.getItem('pia_config');
    if (saved) {
      setConfig(JSON.parse(saved));
    }
  }, []);

  const handleSave = async () => {
    setStatus('saving');
    localStorage.setItem('pia_config', JSON.stringify(config));
    
    try {
      await api.saveSettings(config);
      setStatus('success');
      // Close after a short delay to show success state
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-6 animate-fade-in">
      <div className="glass-card w-full max-w-md rounded-3xl p-8 border-white/10 animate-zoom-in">
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
              <span className="text-brand-400">🚀</span> 模型服务设置
            </h3>
            
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
                onClick={onClose}
                disabled={status === 'saving'}
                className="flex-grow py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-sm font-bold transition-all text-slate-400 disabled:opacity-50"
              >
                取消
              </button>
              <button 
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
