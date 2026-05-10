import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../services/api';
import { useAppStore } from '../store';

const ComparisonPage: React.FC = () => {
  const navigate = useNavigate();
  const { comparisonDois } = useAppStore();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const results = await Promise.all(
          comparisonDois.map(async (doi) => {
            try {
              const details = await api.fetchPaperDetails(doi);
              const metricsMap: Record<string, any> = {};
              details.metrics.forEach(m => { metricsMap[m.label.toLowerCase()] = m.value; });
              return {
                doi,
                title: details.title,
                composition: details.process?.find((p: any) => p.field === 'composition')?.value || 'Unknown',
                structure: details.is_extracted ? 'n-i-p' : 'N/A',
                ...metricsMap,
                solvent: details.process?.find((p: any) => p.field === 'solvents')?.value || 'N/A',
                additive: details.process?.find((p: any) => p.field === 'additive')?.value || 'N/A'
              };
            } catch { return null; }
          })
        );
        setData(results.filter(r => r !== null));
      } finally { setLoading(false); }
    };
    fetchData();
  }, [comparisonDois]);

  const fields = [
    { key: 'composition', label: '化学组分' },
    { key: 'structure', label: '器件结构' },
    { key: 'pce', label: 'PCE (%)', highlight: true },
    { key: 'voc', label: 'Voc (V)' },
    { key: 'jsc', label: 'Jsc (mA/cm²)' },
    { key: 'ff', label: 'FF (%)' },
    { key: 'solvent', label: '溶剂体系' },
    { key: 'additive', label: '添加剂' }
  ];

  const handleExport = () => { window.open(api.getExportUrl(comparisonDois), '_blank'); };

  if (loading) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin"></div>
        <p className="text-slate-500 text-sm animate-pulse">正在聚合横向对比数据...</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <p className="text-slate-500 text-sm">未选择对比文献，请先从搜索结果中选择。</p>
        <button type="button" onClick={() => navigate('/home')} className="btn-primary">返回首页</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 pt-24 pb-20 flex flex-col h-screen">
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-6">
          <button type="button" onClick={() => navigate('/results')} className="text-slate-400 hover:text-white transition-colors">← 返回列表</button>
          <h2 className="text-2xl font-bold">文献横向对比矩阵</h2>
          <span className="px-3 py-1 rounded-full bg-brand-500/10 text-brand-400 text-xs border border-brand-500/20">
            已选中 {data.length} 篇
          </span>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={handleExport} className="px-6 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all text-sm font-bold">
            导出 Excel
          </button>
        </div>
      </header>

      <div className="flex-grow overflow-auto glass-card rounded-3xl border-white/5 relative">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900/80 backdrop-blur-md border-b border-white/10">
              <th className="p-6 text-[10px] font-bold text-slate-500 uppercase tracking-widest w-48 border-r border-white/5 bg-slate-900/40">对比项</th>
              {data.map((paper, idx) => (
                <th key={idx} className="p-6 min-w-[280px] group border-r border-white/5 last:border-r-0">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] text-brand-400 font-mono">#{idx + 1}</span>
                    <button type="button" onClick={() => navigate(`/details/${paper.doi}`)} className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-slate-400 hover:text-white underline">详情</button>
                  </div>
                  <div className="text-sm font-bold text-slate-200 line-clamp-2 leading-snug cursor-pointer hover:text-brand-400 transition-colors">
                    {paper.title}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field, fIdx) => (
              <tr key={fIdx} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                <td className="p-5 pl-8 text-xs font-bold text-slate-400 bg-slate-900/20 border-r border-white/5">{field.label}</td>
                {data.map((paper, pIdx) => {
                  const val = (paper as any)[field.key];
                  const isMaxPce = field.key === 'pce' && val === Math.max(...data.map(d => d.pce));
                  return (
                    <td key={pIdx} className={`p-5 text-sm border-r border-white/5 last:border-r-0 ${isMaxPce ? 'bg-emerald-500/5' : ''}`}>
                      <span className={`font-medium ${isMaxPce ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>{val}</span>
                      {isMaxPce && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 rounded uppercase font-bold ml-2">Champion</span>}
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
