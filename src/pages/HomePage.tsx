import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import { showToast as globalToast } from '../store';
import UnifiedInputBox, { detectInputType } from '../components/UnifiedInputBox';
import SettingsModal from '../components/SettingsModal';
import * as literatureApi from '../services/literatureApi';
import * as projectApi from '../services/projectApi';
import * as api from '../services/api';
import type { Literature, Project } from '../types';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { setSearchResults, setSelectedDoi, showToast, backendConnected } = useAppStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inboxItems, setInboxItems] = useState<Literature[]>([]);
  const [projects, setProjects] = useState<projectApi.ProjectWithStats[]>([]);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDomain, setNewProjectDomain] = useState('perovskite');
  const [moveModalDoi, setMoveModalDoi] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    if (backendConnected) loadData();
    return () => { isMounted.current = false; };
  }, [backendConnected]);

  const loadData = async () => {
    try {
      const [inbox, projList] = await Promise.all([
        literatureApi.listInbox(),
        projectApi.listProjects(),
      ]);
      if (isMounted.current) {
        setInboxItems(inbox);
        setProjects(projList);
      }
    } catch (err) {
      console.error('Failed to load home data:', err);
    }
  };

  // UnifiedInputBox submit handler
  const handleInputSubmit = async (input: string, type: 'doi' | 'pdf' | 'keyword', projectId?: string | null) => {
    setLoading(true);
    try {
      if (type === 'keyword') {
        // Keyword search — use existing search API
        const data = await api.searchPapers(input);
        setSearchResults(data.results, data.warning);
        navigate('/results');
      } else {
        // DOI or PDF path — add to library
        const result = await literatureApi.addLiterature(input, projectId);
        if (result.type === 'doi') {
          showToast(result.cached ? '文献已存在于库中' : '文献已添加，开始提取', 'success');
          navigate(`/details/${result.doi}`);
        } else if (result.type === 'pdf') {
          showToast('PDF 已添加到库中', 'success');
          navigate(`/details/${result.doi}`);
        } else {
          // Keyword returned from addLiterature
          navigate('/results');
        }
        loadData(); // Refresh inbox/projects
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
      loadData();
    } catch (err) {
      showToast('上传失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      await projectApi.createProject(newProjectName.trim(), undefined, newProjectDomain);
      showToast('项目创建成功', 'success');
      setIsCreateProjectOpen(false);
      setNewProjectName('');
      loadData();
    } catch (err) {
      showToast('创建失败', 'error');
    }
  };

  const handleMoveToProject = async (doi: string, projectId: string) => {
    try {
      await literatureApi.moveFromInbox(doi, projectId);
      showToast('已移入项目', 'success');
      setMoveModalDoi(null);
      loadData();
    } catch (err) {
      showToast('移动失败', 'error');
    }
  };

  const stageBadge = (stage: string) => {
    const styles: Record<string, string> = {
      stage2: 'bg-emerald-500/10 text-emerald-400',
      stage1: 'bg-yellow-500/10 text-yellow-400',
      failed: 'bg-red-500/10 text-red-400',
      none: 'bg-slate-500/10 text-slate-500',
    };
    const labels: Record<string, string> = {
      stage2: '已提取',
      stage1: '已筛选',
      failed: '提取失败',
      none: '未提取',
    };
    return (
      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${styles[stage] || styles.none}`}>
        {labels[stage] || stage}
      </span>
    );
  };

  return (
    <div className="h-screen bg-premium-bg flex flex-col items-center overflow-y-auto">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Section 1: Hero + UnifiedInputBox */}
      <div className="w-full flex flex-col items-center pt-20 pb-8 px-8">
        <div className="text-center mb-8">
          <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-4">
            v2.1.0 · Scientific Research Intelligence
          </div>
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-slate-500 mb-3 tracking-tighter">
            Sci-Insight Agent
          </h1>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            添加文献 — 粘贴 DOI、上传 PDF 或输入关键词
          </p>
        </div>

        {!backendConnected ? (
          <div className="w-full max-w-5xl py-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
              <span className="text-3xl">⚠️</span>
            </div>
            <h2 className="text-lg font-bold text-amber-400 mb-2">后端服务未连接</h2>
            <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
              请先启动 Python Sidecar 服务（默认端口 8000），然后刷新页面。
            </p>
            <code className="text-xs text-slate-600 bg-white/5 px-3 py-1.5 rounded-lg block mb-4 max-w-xs mx-auto">
              cd src-python && python main.py
            </code>
          </div>
        ) : (
          <UnifiedInputBox
            onSubmit={handleInputSubmit}
            onFileUpload={handleFileUpload}
            loading={loading}
            placeholder="粘贴 DOI (10.xxx/xxx)、上传 PDF 或输入研究方向..."
          />
        )}
      </div>

      {/* Section 2: Temp Inbox */}
      {backendConnected && (
      <div className="w-full max-w-5xl px-8 mb-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="w-1 h-3 bg-brand-500 rounded-full" />
            临时收集箱
            {inboxItems.length > 0 && (
              <span className="text-[10px] text-slate-600 normal-case tracking-normal">{inboxItems.length} 篇</span>
            )}
          </h3>
        </div>

        {inboxItems.length > 0 ? (
          <div className="space-y-2">
            {inboxItems.map((item) => (
              <div
                key={item.doi}
                className="glass-card p-3 rounded-xl border-white/5 hover:border-brand-500/30 transition-all flex items-center justify-between group"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => {
                    setSelectedDoi(item.doi);
                    navigate(item.is_extracted ? `/insight/${item.doi}` : `/details/${item.doi}`);
                  }}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-slate-200 group-hover:text-brand-400 transition-colors truncate">
                      {item.title || item.doi}
                    </span>
                    {stageBadge(item.extraction_stage || 'none')}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-600">
                    {item.journal && <span>{item.journal}</span>}
                    {item.year && <span>{item.year}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-3 shrink-0">
                  {/* Quick action buttons (GAP-005) */}
                  {item.is_extracted && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDoi(item.doi);
                        navigate(`/insight/${item.doi}`);
                      }}
                      className="text-[10px] text-brand-400 hover:text-brand-300 transition-colors font-bold px-2 py-1 rounded border border-brand-500/20 hover:border-brand-500/40 bg-brand-500/5"
                      title="精准问答"
                    >
                      问答
                    </button>
                  )}
                  {!item.is_extracted && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await literatureApi.startExtraction(item.doi);
                          showToast('已启动提取任务', 'success');
                          loadData();
                        } catch {
                          showToast('启动提取失败', 'error');
                        }
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors font-bold px-2 py-1 rounded border border-emerald-500/20 hover:border-emerald-500/40 bg-emerald-500/5"
                      title="开始提取"
                    >
                      提取
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoveModalDoi(item.doi);
                    }}
                    className="text-[10px] text-slate-500 hover:text-brand-400 transition-colors font-bold px-2 py-1 rounded border border-white/5 hover:border-brand-500/30"
                    title="收纳到项目"
                  >
                    收纳
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 border border-dashed border-white/10 rounded-2xl text-center">
            <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">收集箱为空</p>
            <p className="text-[10px] text-slate-700 mt-1">通过上方输入框添加文献</p>
          </div>
        )}
      </div>
      )}

      {/* Section 3: Project Cards */}
      {backendConnected && (
      <div className="w-full max-w-5xl px-8 pb-24">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="w-1 h-3 bg-indigo-500 rounded-full" />
            我的项目
          </h3>
          <button
            onClick={() => setIsCreateProjectOpen(true)}
            className="text-[10px] text-brand-400 hover:text-brand-300 transition-colors font-bold flex items-center gap-1"
          >
            + 新建项目
          </button>
        </div>

        {projects.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {projects.map((proj) => (
              <div
                key={proj.id}
                onClick={() => navigate(`/projects/${proj.id}`)}
                className="glass-card p-5 rounded-2xl border-white/5 hover:border-indigo-500/30 transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">📁</span>
                  <h4 className="text-sm font-bold text-slate-200 group-hover:text-indigo-400 transition-colors truncate">
                    {proj.name}
                  </h4>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-600">
                  {proj.literature_count !== undefined && (
                    <span>📄 {proj.literature_count} 篇文献</span>
                  )}
                  {proj.extracted_count !== undefined && proj.extracted_count > 0 && (
                    <span>✅ {proj.extracted_count} 已提取</span>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    proj.domain === 'perovskite' ? 'bg-orange-500/10 text-orange-400' :
                    proj.domain === 'semiconductor' ? 'bg-cyan-500/10 text-cyan-400' :
                    'bg-slate-500/10 text-slate-400'
                  }`}>
                    {proj.domain || 'custom'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 border border-dashed border-white/10 rounded-2xl text-center">
            <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">暂无项目</p>
            <p className="text-[10px] text-slate-700 mt-1">点击"新建项目"开始组织文献</p>
          </div>
        )}
      </div>
      )}

      {/* Floating Action Bar */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900/80 backdrop-blur-2xl px-6 py-3 rounded-2xl border border-white/10 shadow-2xl flex items-center gap-6 z-50">
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="text-slate-400 hover:text-white transition-colors text-xs font-bold"
        >
          设置
        </button>
        <div className="h-4 w-[1px] bg-white/10" />
        <button
          type="button"
          onClick={() => { window.location.href = api.getExportUrl(['all']); }}
          className="text-slate-400 hover:text-white transition-colors text-xs font-bold"
        >
          全库导出
        </button>
      </div>

      {/* Create Project Modal */}
      {isCreateProjectOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsCreateProjectOpen(false)} />
          <div className="relative glass-card w-full max-w-md rounded-3xl p-8 border-white/10 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">新建项目</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">项目名称</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50"
                  placeholder="如：钙钛矿稳定性研究"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">研究领域</label>
                <select
                  title="研究领域"
                  value={newProjectDomain}
                  onChange={(e) => setNewProjectDomain(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50"
                >
                  <option value="perovskite">钙钛矿</option>
                  <option value="semiconductor">半导体</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setIsCreateProjectOpen(false)}
                className="flex-grow py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold hover:bg-white/10 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="flex-grow py-3 rounded-xl btn-primary disabled:opacity-50 font-bold"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move to Project Modal */}
      {moveModalDoi && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMoveModalDoi(null)} />
          <div className="relative glass-card w-full max-w-sm rounded-3xl p-8 border-white/10 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">收纳到项目</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => handleMoveToProject(moveModalDoi, proj.id)}
                  className="w-full text-left glass-card p-3 rounded-xl border-white/5 hover:border-brand-500/30 transition-all"
                >
                  <span className="text-sm text-slate-200">{proj.name}</span>
                  {proj.literature_count !== undefined && (
                    <span className="text-[10px] text-slate-600 ml-2">{proj.literature_count} 篇</span>
                  )}
                </button>
              ))}
              {projects.length === 0 && (
                <p className="text-xs text-slate-600 text-center py-4">暂无项目，请先创建</p>
              )}
            </div>
            <button
              onClick={() => setMoveModalDoi(null)}
              className="w-full mt-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 transition-all"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
