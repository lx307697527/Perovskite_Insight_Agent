import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import * as compareApi from '../services/compareApi';
import * as api from '../services/api';
import type { ComparisonFilters, ComparisonData, QualityWarning } from '../services/compareApi';

interface CustomMetric {
  id: string;
  name: string;
  description?: string;
  values: Record<string, string>; // doi -> value
  loading: boolean;
}

const ComparisonPage: React.FC = () => {
  const navigate = useNavigate();
  const { comparisonDois, projects, showToast } = useAppStore();

  // Data state
  const [compData, setCompData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [filters, setFilters] = useState<ComparisonFilters>({
    view_mode: 'metrics',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Project selection for server-side data
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Custom metric columns (GAP-004)
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>([]);
  const [showCustomMetricInput, setShowCustomMetricInput] = useState(false);
  const [newMetricName, setNewMetricName] = useState('');
  const [newMetricDesc, setNewMetricDesc] = useState('');

  // Export dropdown
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close export dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load data
  useEffect(() => {
    loadData();
  }, [comparisonDois, selectedProjectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (selectedProjectId) {
        // Server-side comparison with filters
        const data = await compareApi.getComparisonData(selectedProjectId, filters);
        setCompData(data);
      } else if (comparisonDois.length > 0) {
        // Legacy: fetch individual paper details and build local comparison
        const results = await Promise.all(
          comparisonDois.map(async (doi) => {
            try {
              const details = await api.fetchPaperDetails(doi);
              const metricsMap: Record<string, string> = {};
              details.metrics.forEach((m: any) => { metricsMap[m.label.toUpperCase()] = String(m.value); });
              return {
                DOI: doi,
                Title: details.title,
                Composition: details.process?.find((p: any) => p.field === 'composition')?.value || 'N/A',
                Structure: details.is_extracted ? 'n-i-p' : 'N/A',
                ...metricsMap,
              };
            } catch { return null; }
          })
        );
        const rows = results.filter((r): r is Record<string, string> => r !== null);
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        setCompData({
          columns,
          rows,
          quality_warnings: {},
          total: rows.length,
          filtered: rows.length,
          view_mode: 'metrics',
        });
      } else {
        setCompData(null);
      }
    } catch (err) {
      console.error('Failed to load comparison data:', err);
      showToast('加载对比数据失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    if (selectedProjectId) {
      loadData();
    }
  };

  const handleExport = async (format: 'excel' | 'csv' | 'latex' | 'png') => {
    setExportOpen(false);
    try {
      if (selectedProjectId) {
        const blob = await compareApi.exportComparison(selectedProjectId, format);
        const ext = format === 'latex' ? 'tex' : format;
        compareApi.downloadBlob(blob, `comparison.${ext}`);
      } else {
        // Legacy export
        window.open(api.getExportUrl(comparisonDois), '_blank');
      }
      showToast(`导出 ${format.toUpperCase()} 成功`, 'success');
    } catch (err) {
      showToast('导出失败', 'error');
    }
  };

  // Check quality warnings for a cell
  const getCellWarning = (doi: string, field: string): QualityWarning | null => {
    if (!compData?.quality_warnings?.[doi]?.[field]) return null;
    return compData.quality_warnings[doi][field];
  };

  // Find max numeric value in a column for highlighting
  const getColumnMax = (field: string): number | null => {
    if (!compData?.rows?.length) return null;
    const values = compData.rows
      .map((r) => parseFloat(String(r[field])))
      .filter((v) => !isNaN(v));
    return values.length > 0 ? Math.max(...values) : null;
  };

  // Custom metric functions (GAP-004)
  const addCustomMetric = async () => {
    if (!newMetricName.trim()) {
      showToast('指标名称不能为空', 'error');
      return;
    }

    const metricId = `custom_${Date.now()}`;
    const newMetric: CustomMetric = {
      id: metricId,
      name: newMetricName.trim(),
      description: newMetricDesc.trim() || undefined,
      values: {},
      loading: true,
    };

    setCustomMetrics((prev) => [...prev, newMetric]);
    setShowCustomMetricInput(false);
    setNewMetricName('');
    setNewMetricDesc('');

    // Request AI to extract custom metric for each paper
    const dois = compData?.rows?.map((r) => String(r['DOI'])).filter(Boolean) || [];
    const newValues: Record<string, string> = {};

    try {
      // Call backend API to extract custom metric using AI
      for (const doi of dois) {
        try {
          const resp = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/qa/${encodeURIComponent(doi)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: `What is the ${newMetric.name}? ${newMetric.description || ''}`.trim(),
            }),
          });
          const data = await resp.json();
          if (data.success && data.answer) {
            newValues[doi] = data.answer;
          } else {
            newValues[doi] = 'N/A';
          }
        } catch {
          newValues[doi] = 'N/A';
        }
      }

      setCustomMetrics((prev) =>
        prev.map((m) =>
          m.id === metricId
            ? { ...m, values: newValues, loading: false }
            : m
        )
      );
    } catch (err) {
      showToast('自定义指标提取失败', 'error');
      setCustomMetrics((prev) =>
        prev.map((m) =>
          m.id === metricId
            ? { ...m, loading: false }
            : m
        )
      );
    }
  };

  const removeCustomMetric = (metricId: string) => {
    setCustomMetrics((prev) => prev.filter((m) => m.id !== metricId));
  };

  const getCustomMetricValue = (doi: string, metricId: string): string => {
    const metric = customMetrics.find((m) => m.id === metricId);
    return metric?.values[doi] || '—';
  };

  if (loading) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
        <p className="text-slate-500 text-sm animate-pulse">正在聚合横向对比数据...</p>
      </div>
    );
  }

  if (!compData || compData.rows.length === 0) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <p className="text-slate-500 text-sm">未选择对比文献，请先从搜索结果中选择或选择一个项目。</p>
        <button type="button" onClick={() => navigate('/home')} className="btn-primary">返回首页</button>
      </div>
    );
  }

  const { columns, rows } = compData;

  return (
    <div className="max-w-7xl mx-auto px-6 pt-24 pb-20 flex flex-col h-screen">
      <header className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/results')} className="text-slate-400 hover:text-white transition-colors text-sm">← 返回</button>
          <h2 className="text-2xl font-bold text-white">文献横向对比矩阵</h2>
          <span className="px-3 py-1 rounded-full bg-brand-500/10 text-brand-400 text-xs border border-brand-500/20">
            {compData.filtered} / {compData.total} 篇
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Project selector for server-side comparison */}
          <select
            title="选择项目进行对比"
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-brand-500/50"
          >
            <option value="">从已选文献</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Filter toggle */}
          {selectedProjectId && (
            <button
              type="button"
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={`px-4 py-2 rounded-xl border text-xs font-bold transition-all ${
                filtersOpen ? 'border-brand-500/30 text-brand-400 bg-brand-500/10' : 'border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              条件筛选 ▾
            </button>
          )}

          {/* View mode toggle */}
          {selectedProjectId && (
            <div className="flex rounded-xl border border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, view_mode: 'metrics' }))}
                className={`px-3 py-2 text-[10px] font-bold transition-all ${
                  filters.view_mode !== 'literature' ? 'bg-brand-500/20 text-brand-400' : 'text-slate-500 hover:text-white'
                }`}
              >
                指标为列
              </button>
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, view_mode: 'literature' }))}
                className={`px-3 py-2 text-[10px] font-bold transition-all ${
                  filters.view_mode === 'literature' ? 'bg-brand-500/20 text-brand-400' : 'text-slate-500 hover:text-white'
                }`}
              >
                文献为列
              </button>
            </div>
          )}

          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              onClick={() => setExportOpen(!exportOpen)}
              className="px-5 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all text-sm font-bold text-slate-300"
            >
              导出 ▾
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-2 w-40 glass-card rounded-xl border-white/10 shadow-2xl z-50 overflow-hidden">
                {[
                  { format: 'excel' as const, label: 'Excel (.xlsx)', icon: '📊' },
                  { format: 'csv' as const, label: 'CSV', icon: '📋' },
                  { format: 'latex' as const, label: 'LaTeX (.tex)', icon: '📝' },
                  { format: 'png' as const, label: 'PNG 图片', icon: '🖼️' },
                ].map((opt) => (
                  <button
                    key={opt.format}
                    type="button"
                    onClick={() => handleExport(opt.format)}
                    className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2"
                  >
                    <span>{opt.icon}</span> {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Custom metric button (GAP-004) */}
          <button
            type="button"
            onClick={() => setShowCustomMetricInput(true)}
            className="px-4 py-2 rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-all text-xs font-bold"
          >
            + 自定义指标
          </button>
        </div>
      </header>

      {/* Custom metric input modal (GAP-004) */}
      {showCustomMetricInput && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCustomMetricInput(false)} />
          <div className="relative glass-card w-full max-w-md rounded-3xl p-6 border-white/10 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">添加自定义指标列</h3>
            <p className="text-xs text-slate-500 mb-4">
              输入需要 AI 提取的自定义指标，系统将自动从文献中提取该指标值
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  指标名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newMetricName}
                  onChange={(e) => setNewMetricName(e.target.value)}
                  placeholder="如：退化率、T80寿命、带隙..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  描述说明 <span className="text-slate-600">(可选)</span>
                </label>
                <textarea
                  value={newMetricDesc}
                  onChange={(e) => setNewMetricDesc(e.target.value)}
                  placeholder="帮助 AI 更准确地理解要提取的指标..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500/50 min-h-[60px] resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowCustomMetricInput(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold text-sm hover:bg-white/10 transition-all"
              >
                取消
              </button>
              <button
                type="button"
                onClick={addCustomMetric}
                disabled={!newMetricName.trim()}
                className="flex-1 py-2.5 rounded-xl btn-primary font-bold text-sm disabled:opacity-50"
              >
                添加指标
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Condition filter bar */}
      {filtersOpen && selectedProjectId && (
        <div className="glass-card rounded-2xl p-4 mb-4 border-white/5">
          <div className="grid grid-cols-5 gap-4">
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">扫描方向</label>
              <select
                title="扫描方向筛选"
                value={filters.scan_direction || 'all'}
                onChange={(e) => setFilters((f) => ({ ...f, scan_direction: e.target.value === 'all' ? undefined : e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">全部</option>
                <option value="R-scan">仅 R-scan</option>
                <option value="F-scan">仅 F-scan</option>
                <option value="both">双方向</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">活性面积</label>
              <select
                title="活性面积筛选"
                value={filters.min_active_area ?? 0}
                onChange={(e) => setFilters((f) => ({ ...f, min_active_area: e.target.value === '0' ? undefined : parseFloat(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                <option value={0}>全部</option>
                <option value={0.1}>≥ 0.1 cm²</option>
                <option value={1}>≥ 1 cm²</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">SPO</label>
              <select
                title="SPO数据筛选"
                value={filters.has_spo === undefined ? 'all' : String(filters.has_spo)}
                onChange={(e) => setFilters((f) => ({ ...f, has_spo: e.target.value === 'all' ? undefined : e.target.value === 'true' }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">全部</option>
                <option value="true">有 SPO</option>
                <option value="false">无 SPO</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">ISOS 协议</label>
              <select
                title="ISOS协议筛选"
                value={filters.isos_protocol || 'all'}
                onChange={(e) => setFilters((f) => ({ ...f, isos_protocol: e.target.value === 'all' ? undefined : e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">全部</option>
                <option value="ISOS-D-1">ISOS-D-1</option>
                <option value="ISOS-L-1">ISOS-L-1</option>
                <option value="ISOS-L-2">ISOS-L-2</option>
                <option value="non_standard">非标准</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={applyFilters}
                className="btn-primary w-full py-1.5 text-xs"
              >
                应用筛选
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comparison table */}
      <div className="flex-grow overflow-auto glass-card rounded-3xl border-white/5 relative">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900/80 backdrop-blur-md border-b border-white/10">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={`p-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest min-w-[120px] ${
                    idx === 0 ? 'w-40 border-r border-white/5 bg-slate-900/40' : 'border-r border-white/5 last:border-r-0'
                  }`}
                >
                  {col}
                </th>
              ))}
              {/* Custom metric columns (GAP-004) */}
              {customMetrics.map((metric) => (
                <th
                  key={metric.id}
                  className="p-4 text-[10px] font-bold text-brand-400 uppercase tracking-widest min-w-[120px] border-r border-white/5 last:border-r-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{metric.name}</span>
                    {metric.loading && (
                      <div className="w-3 h-3 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeCustomMetric(metric.id)}
                      className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
                      title="删除此列"
                    >
                      ✕
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const doi = String(row['DOI'] || '');
              return (
                <tr key={rowIdx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  {columns.map((col, colIdx) => {
                    const val = String(row[col] || '');
                    const warning = getCellWarning(doi, col);

                    // Determine cell styling
                    const numVal = parseFloat(val);
                    const isNumeric = !isNaN(numVal) && val.trim() !== '';
                    const colMax = isNumeric ? getColumnMax(col) : null;
                    const isMax = colMax !== null && numVal === colMax;
                    const isMissing = val === '' || val === 'N/A' || val === 'undefined';

                    let cellBg = '';
                    if (isMissing) {
                      cellBg = 'bg-slate-500/5';
                    } else if (warning) {
                      cellBg = 'bg-orange-500/5';
                    } else if (isMax) {
                      cellBg = 'bg-emerald-500/5';
                    }

                    return (
                    <td
                      key={colIdx}
                      className={`p-4 text-sm border-r border-white/5 last:border-r-0 ${cellBg} ${
                        colIdx === 0 ? 'font-bold text-slate-400 bg-slate-900/20 text-xs' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`${
                          isMax ? 'text-emerald-400 font-bold' :
                          isMissing ? 'text-slate-600' :
                          'text-slate-300'
                        }`}>
                          {isMissing ? '—' : val}
                        </span>

                        {/* Champion badge for max values */}
                        {isMax && (
                          <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 rounded uppercase font-bold">
                            Champion
                          </span>
                        )}

                        {/* Quality warning icon */}
                        {warning && (
                          <span
                            className="text-orange-400 cursor-help shrink-0"
                            title={warning.reason}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
                {/* Custom metric cells (GAP-004) */}
                {customMetrics.map((metric) => {
                  const metricVal = getCustomMetricValue(doi, metric.id);
                  const isMissing = metricVal === '—' || metricVal === 'N/A';
                  return (
                    <td
                      key={metric.id}
                      className={`p-4 text-sm border-r border-white/5 last:border-r-0 ${
                        isMissing ? 'bg-slate-500/5 text-slate-600' : 'text-brand-300'
                      }`}
                    >
                      {metric.loading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                          <span className="text-slate-500 text-xs">提取中...</span>
                        </div>
                      ) : (
                        <span className="truncate">{isMissing ? '—' : metricVal}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
};

export default ComparisonPage;
