import React, { useState, useRef } from 'react';

interface QuickQuestionBoxProps {
  onAsk: (question: string) => void;
  suggestions: string[];
  isLoading: boolean;
  placeholder?: string;
}

const QuickQuestionBox: React.FC<QuickQuestionBoxProps> = ({
  onAsk,
  suggestions,
  isLoading,
  placeholder = '输入关于这篇论文的问题...',
}) => {
  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || isLoading) return;
    onAsk(q);
    setQuestion('');
  };

  const handleSuggestionClick = (s: string) => {
    if (isLoading) return;
    onAsk(s);
  };

  return (
    <div className="space-y-3">
      {/* Input form */}
      <form onSubmit={handleSubmit} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isLoading}
          placeholder={placeholder}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!question.trim() || isLoading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 disabled:text-slate-600 disabled:hover:bg-transparent transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </form>

      {/* Suggestion chips */}
      {suggestions.length > 0 && !isLoading && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSuggestionClick(s)}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-brand-300 hover:border-brand-500/30 hover:bg-brand-500/5 transition-all truncate max-w-[280px]"
              title={s}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuickQuestionBox;
