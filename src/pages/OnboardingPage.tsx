import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import * as configApi from '../services/configApi';

type Step = 1 | 2 | 3;

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const { setNeedsOnboarding, settings, setSettings } = useAppStore();

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: AI Engine
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('deepseek-chat');
  const [stage1Model, setStage1Model] = useState('');
  const [stage2Model, setStage2Model] = useState('');

  // Connectivity test
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  // Step 2: Proxy
  const [proxyUrl, setProxyUrl] = useState('');
  const [cookieHeader, setCookieHeader] = useState('');

  // Step 3: Domain
  const [domain, setDomain] = useState<'perovskite' | 'semiconductor' | 'custom'>('perovskite');

  // Embedding status
  const [embeddingStatus, setEmbeddingStatus] = useState<string>('not_installed');

  useEffect(() => {
    configApi.getConfigStatus().then((data) => {
      if (!data.needs_onboarding) {
        setNeedsOnboarding(false);
        navigate('/home', { replace: true });
      }
      setEmbeddingStatus(data.embedding_status || 'not_installed');
    }).catch(() => {});
  }, []);

  const steps = [
    { num: 1, label: 'AI 引擎配置' },
    { num: 2, label: '代理设置' },
    { num: 3, label: '领域选择' },
  ] as const;

  const handleStep1 = async () => {
    if (!apiKey.trim()) {
      setError('API Key 不能为空');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await configApi.saveAIEngine({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        stage1Model: stage1Model.trim() || undefined,
        stage2Model: stage2Model.trim() || undefined,
      });
      setSettings({ ...settings, apiKey, baseUrl, model });
      setStep(2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '配置保存失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleStep2 = async () => {
    setLoading(true);
    setError(null);
    try {
      if (proxyUrl.trim() || cookieHeader.trim()) {
        await configApi.saveProxy({
          proxyUrl: proxyUrl.trim() || undefined,
          cookieHeader: cookieHeader.trim() || undefined,
        });
      }
      setStep(3);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '代理配置失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleStep3 = async () => {
    setLoading(true);
    setError(null);
    try {
      await configApi.updateDomains(domain);
      setNeedsOnboarding(false);
      navigate('/home', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '领域设置失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    setNeedsOnboarding(false);
    navigate('/home', { replace: true });
  };

  // Independent connectivity test (GAP-001 fix)
  const handleTestConnectivity = async () => {
    if (!apiKey.trim()) {
      setTestMessage('请先填写 API Key');
      setTestStatus('error');
      return;
    }
    if (!baseUrl.trim()) {
      setTestMessage('请先填写 Base URL');
      setTestStatus('error');
      return;
    }

    setTestStatus('testing');
    setTestMessage(null);

    try {
      const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
      const resp = await fetch(`${cleanBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 401) {
        setTestMessage('API Key 验证失败，请检查 Key 是否正确');
        setTestStatus('error');
        return;
      }

      if (!resp.ok && resp.status !== 200) {
        setTestMessage(`连接失败: ${resp.statusText}`);
        setTestStatus('error');
        return;
      }

      setTestMessage('连接成功，API 配置有效');
      setTestStatus('success');
      setTimeout(() => {
        setTestStatus('idle');
        setTestMessage(null);
      }, 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '连接失败';
      if (errorMsg.includes('abort') || errorMsg.includes('timeout')) {
        setTestMessage('连接超时，请检查网络或代理设置');
      } else if (errorMsg.includes('fetch') || errorMsg.includes('network')) {
        setTestMessage(`无法连接到 ${baseUrl}，请检查 Base URL`);
      } else {
        setTestMessage(errorMsg);
      }
      setTestStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-premium-bg flex items-center justify-center p-8">
      <div className="glass-card rounded-3xl p-12 max-w-2xl w-full animate-fade-in">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-4">
            初始设置
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">欢迎使用 SIA</h1>
          <p className="text-slate-400 text-sm">3 步完成配置，开始智能文献分析</p>
        </div>

        {/* Step Indicators */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {steps.map((s, i) => (
            <React.Fragment key={s.num}>
              {i > 0 && (
                <div className={`w-12 h-[2px] rounded-full transition-colors ${
                  step > s.num ? 'bg-brand-500' : 'bg-white/10'
                }`} />
              )}
              <div className="flex flex-col items-center gap-2">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                  step === s.num
                    ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/30'
                    : step > s.num
                    ? 'bg-brand-500/20 text-brand-400'
                    : 'bg-white/10 text-slate-500'
                }`}>
                  {step > s.num ? '✓' : s.num}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  step >= s.num ? 'text-brand-400' : 'text-slate-600'
                }`}>
                  {s.label}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Step Content */}
        <div className="bg-white/5 rounded-2xl p-8 mb-8 min-h-[280px]">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  API Key <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                  placeholder="sk-..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Base URL
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                  placeholder="https://api.deepseek.com"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  默认模型
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                  placeholder="deepseek-chat"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Stage1 模型 <span className="text-slate-600 normal-case">(可选)</span>
                  </label>
                  <input
                    type="text"
                    value={stage1Model}
                    onChange={(e) => setStage1Model(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="同默认模型"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Stage2 模型 <span className="text-slate-600 normal-case">(可选)</span>
                  </label>
                  <input
                    type="text"
                    value={stage2Model}
                    onChange={(e) => setStage2Model(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="同默认模型"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-600">
                支持所有 OpenAI 兼容 API（DeepSeek、OpenAI、本地 Ollama 等）
              </p>

              {/* Connectivity Test Button (GAP-001 fix) */}
              <div className="pt-2">
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
                  ) : testStatus === 'error' ? (
                    <>
                      <span className="text-red-400">✕</span>
                      测试失败
                    </>
                  ) : (
                    <>
                      <span>🔌</span>
                      测试连通性
                    </>
                  )}
                </button>
                {testMessage && (
                  <p className={`text-xs mt-2 ${
                    testStatus === 'success' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {testMessage}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  代理 URL <span className="text-slate-600 normal-case">(可选)</span>
                </label>
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors"
                  placeholder="http://127.0.0.1:7890"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Cookie Header <span className="text-slate-600 normal-case">(付费文献 SI 下载)</span>
                </label>
                <textarea
                  value={cookieHeader}
                  onChange={(e) => setCookieHeader(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 transition-colors min-h-[80px] resize-none"
                  placeholder="Cookie: session_id=...; ..."
                />
              </div>
              <p className="text-[11px] text-slate-600">
                如需下载付费墙后的 SI 文件，可配置代理和机构 Cookie
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-400 mb-4">选择你的研究方向，SIA 将优化提取策略</p>
              {([
                { id: 'perovskite' as const, label: '钙钛矿太阳能电池', desc: 'PCE/Voc/Jsc/FF 提取，组分识别，SI 解析' },
                { id: 'semiconductor' as const, label: '半导体器件', desc: '电学性能，I-V 曲线，迁移率提取' },
                { id: 'custom' as const, label: '自定义领域', desc: '手动配置提取 Schema' },
              ]).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDomain(d.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    domain === d.id
                      ? 'bg-brand-500/10 border-brand-500/30 text-white'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div className="font-bold text-sm mb-1">{d.label}</div>
                  <div className="text-[11px] text-slate-500">{d.desc}</div>
                </button>
              ))}

              {/* Embedding status */}
              <div className="mt-6 pt-4 border-t border-white/5">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <div className={`w-2 h-2 rounded-full ${
                    embeddingStatus === 'ready' ? 'bg-emerald-400' :
                    embeddingStatus === 'loading' ? 'bg-yellow-400 animate-pulse' :
                    'bg-slate-600'
                  }`} />
                  Embedding 模型：{
                    embeddingStatus === 'ready' ? '已就绪' :
                    embeddingStatus === 'loading' ? '加载中...' :
                    '未安装（精准问答功能不可用）'
                  }
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center">
          <button type="button" onClick={handleSkip} className="text-slate-500 hover:text-slate-400 text-xs font-bold transition-colors">
            跳过设置
          </button>
          <div className="flex gap-3">
            {step > 1 && (
              <button
                onClick={() => setStep((step - 1) as Step)}
                type="button"
                className="px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold text-sm hover:bg-white/10 transition-all"
              >
                上一步
              </button>
            )}
            <button
              onClick={step === 1 ? handleStep1 : step === 2 ? handleStep2 : handleStep3}
              type="button"
              disabled={loading}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed py-2.5 px-8 text-sm"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  验证中...
                </>
              ) : step === 3 ? '完成设置' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
