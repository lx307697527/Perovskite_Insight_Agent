import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import * as compareApi from '../services/compareApi';
import * as api from '../services/api';
import type { ComparisonFilters, ComparisonData, QualityWarning } from '../services/compareApi';

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
        </div>
      </header>

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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                {columns.map((col, colIdx) => {
                  const val = String(row[col] || '');
                  const doi = String(row['DOI'] || '');
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ComparisonPage;
