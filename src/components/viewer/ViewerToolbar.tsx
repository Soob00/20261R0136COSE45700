'use client';

import { RotateCcw, Grid3x3, Sun, Moon, Camera } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

interface ViewerToolbarProps {
  showGrid: boolean;
  onToggleGrid: () => void;
  onResetCamera: () => void;
}

export function ViewerToolbar({
  showGrid,
  onToggleGrid,
  onResetCamera,
}: ViewerToolbarProps) {
  const { theme, toggle } = useTheme();

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
      <div className="flex items-center gap-1 p-1.5 rounded-2xl glass shadow-soft">
        <ToolbarButton
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          title="카메라 초기화 (R)"
          onClick={onResetCamera}
          shortcut="R"
        />
        <ToolbarButton
          icon={<Grid3x3 className="w-3.5 h-3.5" />}
          title="그리드 토글 (G)"
          onClick={onToggleGrid}
          active={showGrid}
          shortcut="G"
        />
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolbarButton
          icon={theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          title="테마 전환"
          onClick={toggle}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  title,
  onClick,
  active,
  shortcut,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`relative p-2.5 rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        active
          ? 'bg-primary text-primary-foreground shadow-soft'
          : 'text-foreground/60 hover:text-primary hover:bg-accent/60'
      }`}
    >
      {icon}
    </button>
  );
}
