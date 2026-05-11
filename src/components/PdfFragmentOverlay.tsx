import React, { useState, useEffect } from 'react';

interface PdfFragmentOverlayProps {
  doi: string;
  targetPage?: number | null;
  onClose: () => void;
}

const PdfFragmentOverlay: React.FC<PdfFragmentOverlayProps> = ({ doi, targetPage, onClose }) => {
  const [currentPage, setCurrentPage] = useState(targetPage || 1);
  const pdfUrl = `${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/pdf/${encodeURIComponent(doi)}`;

  useEffect(() => {
    if (targetPage) {
      setCurrentPage(targetPage);
    }
  }, [targetPage]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentPage((p) => Math.max(1, p - 1));
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentPage((p) => p + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="text-slate-400 hover:text-white disabled:text-slate-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-xs text-slate-300 min-w-[60px] text-center">
                第 {currentPage} 页
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => p + 1)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
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
            src={`${pdfUrl}#page=${currentPage}`}
            className="w-full h-full border-0"
            title={`PDF: ${doi}`}
          />
        </div>

        {/* Target page indicator */}
        {targetPage && targetPage !== currentPage && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <button
              type="button"
              onClick={() => setCurrentPage(targetPage)}
              className="text-xs px-4 py-2 bg-brand-500 text-white rounded-full shadow-lg hover:bg-brand-400 transition-colors"
            >
              跳转至来源页 (第 {targetPage} 页)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfFragmentOverlay;
