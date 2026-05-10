import React, { useState } from 'react';
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { searchPlugin } from '@react-pdf-viewer/search';

// Import styles
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';

interface PdfViewerProps {
  url: string;
  highlightText?: string | null;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ url, highlightText }) => {
  const [showEvidence, setShowEvidence] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const searchPluginInstance = searchPlugin({
    keyword: searchQuery ? [searchQuery] : [],
  });

  // Update search when highlightText changes
  React.useEffect(() => {
    if (highlightText) {
      // Extract meaningful search terms (first 80 chars, remove special chars)
      const cleanText = highlightText.substring(0, 80).replace(/[^\w\s]/g, ' ').trim();
      const searchTerms = cleanText.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
      setSearchQuery(searchTerms.join(' '));
      setShowEvidence(true);
    }
  }, [highlightText]);

  return (
    <div className="w-full h-full bg-slate-900 rounded-2xl overflow-hidden flex flex-col">
      {/* Evidence banner */}
      {showEvidence && highlightText && (
        <div className="bg-brand-500/10 border-b border-brand-500/30 p-3 mx-4 mt-4 rounded-lg flex-shrink-0">
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Evidence</span>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{highlightText}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowEvidence(false);
                setSearchQuery('');
              }}
              className="text-slate-500 hover:text-slate-300 text-sm flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <Worker workerUrl={`https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js`}>
        <div className="flex-grow overflow-auto h-full">
          <Viewer
            fileUrl={url}
            plugins={[searchPluginInstance]}
            theme="dark"
          />
        </div>
      </Worker>
    </div>
  );
};

export default PdfViewer;
