import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../store';
import * as projectApi from '../services/projectApi';
import * as literatureApi from '../services/literatureApi';
import * as chatApi from '../services/chatApi';
import type { Project, Literature } from '../types';
import type { ChatSSEEvent } from '../services/chatApi';

interface ProjectWithStats extends Project {
  literature_count: number;
  extracted_count: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: { doi?: string; page?: number; excerpt?: string; file?: string; relevance?: number }[];
}

const ProjectHubPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useAppStore();

  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [inboxItems, setInboxItems] = useState<Literature[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [selectedDois, setSelectedDois] = useState<string[]>([]);

  // Create project form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDomain, setNewDomain] = useState<'perovskite' | 'semiconductor' | 'custom'>('perovskite');

  // Project detail view
  const [activeProject, setActiveProject] = useState<projectApi.ProjectDetail | null>(null);
  const [projectLiterature, setProjectLiterature] = useState<Literature[]>([]);

  // Multi-doc chat state
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatContextDois, setChatContextDois] = useState<string[]>([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const chatCleanupRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    loadData();
    return () => {
      isMounted.current = false;
      chatCleanupRef.current?.();
    };
  }, [projectId]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projData, inboxData] = await Promise.all([
        projectApi.listProjects(),
        literatureApi.listInbox(),
      ]);
      if (isMounted.current) {
        setProjects(projData);
        setInboxItems(inboxData);
      }

      if (projectId) {
        const detail = await projectApi.getProject(projectId);
        if (isMounted.current) {
          setActiveProject(detail);
          setProjectLiterature(detail.literature || []);
          // Auto-select all extracted literature for chat context
          const extracted = (detail.literature || []).filter((l: Literature) => l.is_extracted);
          setChatContextDois(extracted.map((l: Literature) => l.doi));
          // Reset chat state
          setChatMessages([]);
          setChatQuestion('');
        }
      } else {
        setActiveProject(null);
        setProjectLiterature([]);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newName.trim()) {
      showToast('项目名称不能为空', 'error');
      return;
    }
    try {
      await projectApi.createProject(newName.trim(), newDesc.trim() || undefined, newDomain);
      showToast('项目创建成功', 'success');
      setShowCreateModal(false);
      setNewName('');
      setNewDesc('');
      setNewDomain('perovskite');
      loadData();
    } catch (err) {
      showToast('创建失败', 'error');
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('确定删除此项目？项目内文献将移至临时收集箱。')) return;
    try {
      await projectApi.deleteProject(id);
      showToast('项目已删除', 'success');
      if (projectId === id) navigate('/projects');
      loadData();
    } catch (err) {
      showToast('删除失败', 'error');
    }
  };

  const handleMoveToProject = async (targetProjectId: string) => {
    if (selectedDois.length === 0) return;
    try {
      await projectApi.assignLiteratureToProject(targetProjectId, selectedDois);
      showToast(`已将 ${selectedDois.length} 篇文献归档`, 'success');
      setSelectedDois([]);
      setShowMoveModal(false);
      loadData();
    } catch (err) {
      showToast('归档失败', 'error');
    }
  };

  const toggleInboxSelection = (doi: string) => {
    setSelectedDois((prev) =>
      prev.includes(doi) ? prev.filter((d) => d !== doi) : [...prev, doi]
    );
  };

  // Multi-doc chat submit
  const handleChatSubmit = useCallback(() => {
    if (!chatQuestion.trim() || chatStreaming || !projectId) return;
    if (chatContextDois.length === 0) {
      showToast('请至少选择一篇已提取文献', 'error');
      return;
    }

    const question = chatQuestion.trim();
    setChatQuestion('');
    setChatStreaming(true);

    // Add user message
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: question,
    };
    setChatMessages((prev) => [...prev, userMsg]);

    // Streaming assistant message
    const assistantId = `asst_${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      sources: [],
    };
    setChatMessages((prev) => [...prev, assistantMsg]);

    const onEvent = (event: ChatSSEEvent) => {
      if (!isMounted.current) return;

      if (event.type === 'content' && event.text) {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + event.text }
              : m
          )
        );
      } else if (event.type === 'source') {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  sources: [...(m.sources || []), {
                    doi: event.doi,
                    page: event.page,
                    excerpt: event.excerpt,
                    file: event.file,
                    relevance: event.relevance,
                  }],
                }
              : m
          )
        );
      } else if (event.type === 'done') {
        setChatStreaming(false);
      } else if (event.type === 'error') {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `Error: ${event.message || 'Unknown error'}` }
              : m
          )
        );
        setChatStreaming(false);
      }
    };

    const onError = (err: Error) => {
      if (!isMounted.current) return;
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `连接失败: ${err.message}` }
            : m
        )
      );
      setChatStreaming(false);
    };

    chatCleanupRef.current = chatApi.createChatConnection(
      projectId,
      question,
      chatContextDois,
      onEvent,
      onError,
    );
  }, [chatQuestion, chatStreaming, chatContextDois, projectId, showToast]);

  const toggleChatContext = (doi: string) => {
    setChatContextDois((prev) =>
      prev.includes(doi) ? prev.filter((d) => d !== doi) : [...prev, doi]
    );
  };

  // ============================================================
  // Detail view with Multi-Doc Chat
  // ============================================================
  if (projectId && activeProject) {
    return (
      <div className="h-screen bg-premium-bg overflow-hidden">
        <div className="h-full grid grid-cols-[3fr_2fr]">
          {/* Left: Project info + Literature list */}
          <div className="overflow-y-auto p-8">
            <div className="max-w-2xl mx-auto">
              {/* Header */}
              <div className="flex items-center gap-4 mb-8">
                <button
                  type="button"
                  onClick={() => navigate('/projects')}
                  className="text-slate-400 hover:text-white transition-colors text-sm"
                >
                  ← 所有项目
                </button>
              </div>

              <div className="glass-card rounded-3xl p-8 mb-8">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-2xl font-bold text-white mb-2">{activeProject.name}</h1>
                    {activeProject.description && (
                      <p className="text-slate-400 text-sm mb-3">{activeProject.description}</p>
                    )}
                    <div className="flex gap-4 text-xs text-slate-500">
                      <span>{activeProject.literature_count} 篇文献</span>
                      <span>{activeProject.extracted_count} 已提取</span>
                      <span className="px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400">{activeProject.domain}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteProject(activeProject.id)}
                    className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                  >
                    删除项目
                  </button>
                </div>
              </div>

              {/* Literature list */}
              <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">
                项目文献
              </h3>
              {projectLiterature.length > 0 ? (
                <div className="space-y-3">
                  {projectLiterature.map((lit) => (
                    <div
                      key={lit.doi}
                      onClick={() => {
                        if (lit.is_extracted) {
                          navigate(`/details/${lit.doi}`);
                        }
                      }}
                      className={`glass-card p-4 rounded-2xl border-white/5 hover:border-brand-500/30 transition-all ${
                        lit.is_extracted ? 'cursor-pointer' : 'opacity-60'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] font-bold text-brand-400 uppercase">
                          {lit.journal} {lit.year}
                        </span>
                        <div className="flex gap-2 items-center">
                          {lit.quality_flag && lit.quality_flag !== 'OK' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                              {lit.quality_flag}
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            lit.extraction_stage === 'stage2' ? 'bg-emerald-500/10 text-emerald-400' :
                            lit.extraction_stage === 'stage1' ? 'bg-blue-500/10 text-blue-400' :
                            lit.extraction_stage === 'failed' ? 'bg-red-500/10 text-red-400' :
                            'bg-slate-500/10 text-slate-400'
                          }`}>
                            {lit.extraction_stage === 'none' ? '未提取' :
                             lit.extraction_stage === 'stage1' ? 'Stage1' :
                             lit.extraction_stage === 'stage2' ? '已提取' : '失败'}
                          </span>
                        </div>
                      </div>
                      <h4 className="text-sm font-bold text-slate-200 truncate">{lit.title}</h4>
                      {lit.authors && <p className="text-[11px] text-slate-500 truncate mt-1">{lit.authors}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-16 border border-dashed border-white/10 rounded-3xl text-center">
                  <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">
                    暂无文献，从收集箱归档或使用统一输入框添加
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Multi-Doc Chat Panel */}
          <div className="border-l border-white/5 flex flex-col bg-slate-900/30">
            {/* Chat header */}
            <div className="p-4 border-b border-white/5">
              <h3 className="text-sm font-bold text-white mb-2">项目问答</h3>
              <p className="text-[10px] text-slate-500 mb-3">
                已选择 {chatContextDois.length} 篇文献作为问答上下文
              </p>
              {/* Literature selector */}
              <div className="max-h-32 overflow-y-auto space-y-1">
                {projectLiterature.filter((l) => l.is_extracted).map((lit) => (
                  <label
                    key={lit.doi}
                    className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={chatContextDois.includes(lit.doi)}
                      onChange={() => toggleChatContext(lit.doi)}
                      className="accent-brand-500 w-3 h-3"
                    />
                    <span className="text-[11px] text-slate-300 truncate">{lit.title || lit.doi}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="text-3xl mb-3">💬</div>
                    <p className="text-xs text-slate-500">选择文献后输入问题</p>
                    <p className="text-[10px] text-slate-600 mt-1">
                      如：这批文献中哪种钝化策略 PCE 最高？
                    </p>
                  </div>
                </div>
              )}
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block max-w-[90%] rounded-2xl p-3 ${
                    msg.role === 'user'
                      ? 'bg-brand-500/20 text-brand-100'
                      : 'glass-card border-white/5 text-slate-200'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

                    {/* Source citations */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/5">
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">来源引用</p>
                        {msg.sources.map((src, i) => (
                          <div key={i} className="text-[10px] text-slate-400 mt-1 flex items-start gap-1">
                            <span className="text-brand-400 shrink-0">
                              {src.doi ? `[${src.doi.slice(0, 20)}...]` : ''}
                              {src.page ? ` p.${src.page}` : ''}
                              {src.file === 'si' ? ' (SI)' : ''}
                            </span>
                            <span className="truncate">{src.excerpt?.slice(0, 80)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatStreaming && (
                <div className="text-left">
                  <div className="inline-block glass-card rounded-2xl p-3 border-white/5">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <div className="w-3 h-3 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                      思考中...
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="p-4 border-t border-white/5">
              <div className="flex gap-2">
                <textarea
                  value={chatQuestion}
                  onChange={(e) => setChatQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChatSubmit())}
                  placeholder="输入问题，AI 将基于项目文献回答..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 resize-none min-h-[40px] max-h-[80px]"
                  disabled={chatStreaming}
                  rows={1}
                />
                <button
                  type="button"
                  onClick={handleChatSubmit}
                  disabled={chatStreaming || !chatQuestion.trim() || chatContextDois.length === 0}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // List view (unchanged)
  // ============================================================
  return (
    <div className="h-screen bg-premium-bg overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">项目枢纽</h1>
            <p className="text-slate-400 text-sm">管理项目，归档文献</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="btn-primary py-2 px-6 text-sm"
          >
            + 新建项目
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-8">
            <section>
              <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <span className="w-1 h-3 bg-brand-500 rounded-full" />
                我的项目 ({projects.length})
              </h3>
              {projects.length > 0 ? (
                <div className="space-y-3">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="glass-card p-5 rounded-2xl border-white/5 hover:border-brand-500/30 transition-all cursor-pointer group"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-sm font-bold text-slate-200 group-hover:text-brand-400 transition-colors">
                          {p.name}
                        </h4>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400">
                          {p.domain}
                        </span>
                      </div>
                      {p.description && (
                        <p className="text-[11px] text-slate-500 mb-2 line-clamp-2">{p.description}</p>
                      )}
                      <div className="flex gap-3 text-[10px] text-slate-600">
                        <span>{p.literature_count} 篇文献</span>
                        <span>{p.extracted_count} 已提取</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-16 border border-dashed border-white/10 rounded-3xl text-center">
                  <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">暂无项目</p>
                  <p className="text-[11px] text-slate-700 mt-2">点击"新建项目"开始</p>
                </div>
              )}
            </section>

            <section>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <span className="w-1 h-3 bg-indigo-500 rounded-full" />
                  临时收集箱 ({inboxItems.length})
                </h3>
                {selectedDois.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowMoveModal(true)}
                    className="text-[10px] text-brand-400 hover:text-brand-300 font-bold"
                  >
                    归档到项目 ({selectedDois.length})
                  </button>
                )}
              </div>
              {inboxItems.length > 0 ? (
                <div className="space-y-2">
                  {inboxItems.map((lit) => (
                    <div
                      key={lit.doi}
                      className={`glass-card p-4 rounded-xl border transition-all flex items-start gap-3 ${
                        selectedDois.includes(lit.doi) ? 'border-brand-500/40 bg-brand-500/5' : 'border-white/5'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDois.includes(lit.doi)}
                        onChange={() => toggleInboxSelection(lit.doi)}
                        title={`选择 ${lit.title}`}
                        className="mt-1 accent-brand-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-[10px] font-bold text-indigo-400 uppercase">
                            {lit.journal} {lit.year}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            lit.is_extracted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'
                          }`}>
                            {lit.is_extracted ? '已提取' : '未提取'}
                          </span>
                        </div>
                        <h4
                          className="text-sm text-slate-200 truncate cursor-pointer hover:text-indigo-400 transition-colors"
                          onClick={() => lit.is_extracted && navigate(`/details/${lit.doi}`)}
                        >
                          {lit.title}
                        </h4>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-16 border border-dashed border-white/10 rounded-3xl text-center">
                  <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">收集箱为空</p>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Create Project Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
            <div className="relative glass-card w-full max-w-md rounded-3xl p-8 border-white/10 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-6">新建项目</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    项目名称 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50"
                    placeholder="如: 三阳离子钙钛矿研究"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    描述
                  </label>
                  <textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 min-h-[80px] resize-none"
                    placeholder="项目描述..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    研究领域
                  </label>
                  <div className="flex gap-2">
                    {(['perovskite', 'semiconductor', 'custom'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setNewDomain(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          newDomain === d
                            ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                            : 'bg-white/5 text-slate-500 border border-white/10 hover:border-white/20'
                        }`}
                      >
                        {d === 'perovskite' ? '钙钛矿' : d === 'semiconductor' ? '半导体' : '自定义'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-grow py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold hover:bg-white/10 transition-all text-sm"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCreateProject}
                  className="flex-grow py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold shadow-lg shadow-brand-500/20 transition-all text-sm"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Move to Project Modal */}
        {showMoveModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMoveModal(false)} />
            <div className="relative glass-card w-full max-w-md rounded-3xl p-8 border-white/10 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-4">归档到项目</h3>
              <p className="text-sm text-slate-400 mb-6">将 {selectedDois.length} 篇文献归档到：</p>
              {projects.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleMoveToProject(p.id)}
                      className="w-full text-left p-4 rounded-xl bg-white/5 border border-white/10 hover:border-brand-500/30 transition-all"
                    >
                      <div className="font-bold text-sm text-slate-200">{p.name}</div>
                      <div className="text-[10px] text-slate-500 mt-1">{p.literature_count} 篇文献</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">请先创建一个项目</p>
              )}
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="w-full mt-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold text-sm hover:bg-white/10 transition-all"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectHubPage;
