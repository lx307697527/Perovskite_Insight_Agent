import React, { useState, useEffect, useCallback } from 'react';

interface PdfFragmentOverlayProps {
  doi: string;
  targetPage?: number | null;
  onClose: () => void;
}

const PdfFragmentOverlay: React.FC<PdfFragmentOverlayProps> = ({ doi, targetPage, onClose }) => {
  const [currentPage, setCurrentPage] = useState(targetPage || 1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const pdfUrl = `${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/pdf/${encodeURIComponent(doi)}`;

  // Jump to target page when it changes
  useEffect(() => {
    if (targetPage && targetPage !== currentPage) {
      setCurrentPage(targetPage);
    }
  }, [targetPage]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentPage((p) => Math.max(1, p - 1));
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentPage((p) => p + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const goToPage = useCallback((page: number) => {
    const p = Math.max(1, page);
    setCurrentPage(p);
  }, []);

  // Build iframe src with page hash for PDF.js navigation
  const iframeSrc = `${pdfUrl}#page=${currentPage}&toolbar=1&navpanes=0`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-[90vw] h-[85vh] max-w-5xl bg-slate-900 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-white">PDF 预览</h3>
            <span className="text-[11px] text-slate-400 font-mono">
              {doi.length > 30 ? `${doi.slice(0, 30)}...` : doi}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Page navigation */}
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="text-slate-400 hover:text-white disabled:text-slate-600 transition-colors"
                title="上一页 (←)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={currentPage}
                  onChange={(e) => {
                    const p = parseInt(e.target.value, 10);
                    if (!isNaN(p) && p >= 1) goToPage(p);
                  }}
                  className="w-12 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-center text-slate-200 focus:outline-none focus:border-brand-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  min={1}
                  title="页码"
                  placeholder="页"
                  aria-label="跳转页码"
                />
                <span className="text-xs text-slate-500">页</span>
              </div>
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                className="text-slate-400 hover:text-white transition-colors"
                title="下一页 (→)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Target page quick jump */}
            {targetPage && targetPage !== currentPage && (
              <button
                type="button"
                onClick={() => goToPage(targetPage)}
                className="text-[11px] px-3 py-1.5 bg-brand-500/20 border border-brand-500/30 text-brand-300 rounded-lg hover:bg-brand-500/30 transition-colors"
              >
                跳转至来源 (第{targetPage}页)
              </button>
            )}

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
              title="关闭 (Esc)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* PDF iframe */}
        <div className="flex-1 overflow-hidden">
          <iframe
            key={`page-${currentPage}`}
            src={iframeSrc}
            className="w-full h-full border-0"
            title={`PDF: ${doi}`}
          />
        </div>

        {/* Bottom bar with keyboard hints */}
        <div className="flex items-center justify-between px-5 py-2 border-t border-white/5 bg-slate-900/50">
          <div className="flex items-center gap-4 text-[10px] text-slate-600">
            <span>← → 翻页</span>
            <span>Esc 关闭</span>
          </div>
          {targetPage && (
            <div className="flex items-center gap-2">
              {targetPage === currentPage ? (
                <span className="text-[10px] text-brand-400 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  已定位至来源页
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => goToPage(targetPage)}
                  className="text-[10px] px-3 py-1 bg-brand-500 text-white rounded-full shadow-lg hover:bg-brand-400 transition-colors"
                >
                  定位来源 (第 {targetPage} 页)
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfFragmentOverlay;
