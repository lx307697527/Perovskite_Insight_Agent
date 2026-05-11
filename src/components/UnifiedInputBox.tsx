import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as projectApi from '../services/projectApi';

// ============================================================
// Shared detection logic
// ============================================================

const DOI_REGEX = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;

export function detectInputType(input: string): 'doi' | 'pdf' | 'keyword' {
  const trimmed = input.trim();
  if (DOI_REGEX.test(trimmed)) return 'doi';
  if (trimmed.endsWith('.pdf') || /^[A-Za-z]:\\/.test(trimmed)) return 'pdf';
  return 'keyword';
}

// ============================================================
// Component
// ============================================================

export interface UnifiedInputBoxProps {
  onSubmit: (input: string, type: 'doi' | 'pdf' | 'keyword', projectId?: string | null) => void;
  onFileUpload: (file: File, projectId?: string | null) => void;
  loading?: boolean;
  placeholder?: string;
  showProjectSelector?: boolean;
  compact?: boolean;
}

const UnifiedInputBox: React.FC<UnifiedInputBoxProps> = ({
  onSubmit,
  onFileUpload,
  loading = false,
  placeholder = '粘贴 DOI (10.xxx/xxx) 或输入关键词搜索...',
  showProjectSelector = true,
  compact = false,
}) => {
  const [input, setInput] = useState('');
  const [detectedType, setDetectedType] = useState<'doi' | 'pdf' | 'keyword' | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<projectApi.ProjectWithStats[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load projects
  useEffect(() => {
    if (showProjectSelector) {
      projectApi.listProjects().then(setProjects).catch(() => {});
    }
  }, [showProjectSelector]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setDetectedType(value.trim() ? detectInputType(value) : null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || loading) return;
    onSubmit(input.trim(), detectedType || 'keyword', selectedProjectId);
  }, [input, detectedType, selectedProjectId, loading, onSubmit]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) return;
    onFileUpload(file, selectedProjectId);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedProjectId, onFileUpload]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.pdf')) {
      onFileUpload(file, selectedProjectId);
    }
  }, [selectedProjectId, onFileUpload]);

  const typeBadge = detectedType ? (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
      detectedType === 'doi' ? 'bg-emerald-500/10 text-emerald-400' :
      detectedType === 'pdf' ? 'bg-blue-500/10 text-blue-400' :
      'bg-purple-500/10 text-purple-400'
    }`}>
      {detectedType === 'doi' ? 'DOI 识别' : detectedType === 'pdf' ? '本地 PDF' : '关键词搜索'}
    </span>
  ) : null;

  return (
    <div
      className={`relative group z-20 ${compact ? 'w-full' : 'w-full max-w-3xl'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Glow border */}
      {!compact && (
        <div className="absolute -inset-1 bg-gradient-to-r from-brand-500 to-indigo-600 rounded-3xl blur opacity-20 group-hover:opacity-30 transition duration-1000 group-hover:duration-200" />
      )}

      <div className={`relative glass-card rounded-2xl p-2 flex flex-col border-white/10 shadow-2xl transition-colors ${
        isDragOver ? 'border-brand-500/50 bg-brand-500/5' : ''
      }`}>
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-brand-500/10 backdrop-blur-sm">
            <div className="text-center">
              <div className="text-3xl mb-2">📄</div>
              <p className="text-brand-300 text-sm font-bold">释放以添加 PDF</p>
            </div>
          </div>
        )}

        <textarea
          className={`w-full bg-transparent border-none text-slate-100 focus:outline-none resize-none placeholder:text-slate-600 ${
            compact ? 'p-3 text-sm min-h-[60px]' : 'p-6 text-lg min-h-[120px]'
          }`}
          placeholder={placeholder}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSubmit())}
        />

        {/* Type indicator */}
        {detectedType && (
          <div className={compact ? 'px-3 pb-1' : 'px-6 pb-2'}>
            {typeBadge}
          </div>
        )}

        {/* Action bar */}
        <div className={`flex justify-between items-center border-t border-white/5 ${
          compact ? 'p-2' : 'p-4'
        }`}>
          <div className="flex items-center gap-3">
            {/* Project selector */}
            {showProjectSelector && (
              <select
                title="选择归档项目"
                value={selectedProjectId || ''}
                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-brand-500/50"
              >
                <option value="">收集箱</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            {/* File upload button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-slate-500 hover:text-brand-400 transition-colors text-xs font-bold flex items-center gap-1"
              title="上传 PDF 文件"
            >
              📎 上传 PDF
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="hidden"
              title="选择 PDF 文件"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed py-2 px-6 text-sm"
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
  );
};

export default UnifiedInputBox;
