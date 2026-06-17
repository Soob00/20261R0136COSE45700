'use client';

import { Search, X, Filter } from 'lucide-react';

interface SliderSearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showModifiedOnly: boolean;
  onToggleModifiedOnly: () => void;
  modifiedCount: number;
}

export function SliderSearch({
  searchQuery,
  onSearchChange,
  showModifiedOnly,
  onToggleModifiedOnly,
  modifiedCount,
}: SliderSearchProps) {
  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className="relative">
        <label htmlFor="slider-search" className="sr-only">슬라이더 검색</label>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
        <input
          id="slider-search"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="무엇을 꾸며볼까요?"
          className="w-full pl-8 pr-8 py-2 text-xs bg-card border border-border rounded-full text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent/50 transition-colors"
            aria-label="검색어 지우기"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Modified only filter */}
      <button
        onClick={onToggleModifiedOnly}
        className={`flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md border transition-colors ${
          showModifiedOnly
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
        }`}
      >
        <Filter className="w-3 h-3" />
        변경된 항목만
        {modifiedCount > 0 && (
          <span className={`px-1 rounded text-[10px] ${
            showModifiedOnly ? 'bg-primary/20' : 'bg-muted'
          }`}>
            {modifiedCount}
          </span>
        )}
      </button>
    </div>
  );
}
