'use client';

import { useEditorStore } from '@/stores/editorStore';
import { Play, PersonStanding } from 'lucide-react';

const CLIP_LABELS: Record<string, string> = {
  Walk: '걷기',
  walk: '걷기',
  Pickup: '줍기',
  PickUp: '줍기',
  pickup: '줍기',
  Laugh: '웃기',
  laugh: '웃기',
  Mad: '화남',
  mad: '화남',
  Idle: '대기',
  idle: '대기',
  Run: '달리기',
  run: '달리기',
};

function clipLabel(name: string) {
  return CLIP_LABELS[name] ?? name;
}

export function MotionPanel() {
  const clipNames = useEditorStore((s) => s.animationClipNames);
  const selectedIndex = useEditorStore((s) => s.selectedAnimationIndex);
  const setSelectedAnimationIndex = useEditorStore((s) => s.setSelectedAnimationIndex);

  if (!clipNames.length) {
    return (
      <div className="rounded-xl border border-border/30 bg-accent/20 p-4 text-center">
        <p className="text-sm text-muted-foreground">애니메이션 파일 로딩 중...</p>
      </div>
    );
  }

  const isDefault = selectedIndex < 0;

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-muted-foreground px-1">애니메이션 선택</p>

      {/* Default pose button */}
      <button
        onClick={() => setSelectedAnimationIndex(-1)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
          isDefault
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-border/30 bg-accent/10 text-muted-foreground hover:bg-accent/30 hover:text-foreground hover:border-border/60'
        }`}
      >
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
            isDefault ? 'bg-primary/20' : 'bg-accent/40'
          }`}
        >
          <PersonStanding
            className={`w-3.5 h-3.5 ${isDefault ? 'text-primary' : 'text-muted-foreground'}`}
          />
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-bold ${isDefault ? 'text-foreground' : ''}`}>기본 포즈</p>
          <p className="text-[11px] text-muted-foreground/70">default</p>
        </div>
        {isDefault && (
          <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
            선택 중
          </span>
        )}
      </button>

      {clipNames.map((name, index) => {
        const isActive = index === selectedIndex;
        return (
          <button
            key={index}
            onClick={() => setSelectedAnimationIndex(index)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
              isActive
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border/30 bg-accent/10 text-muted-foreground hover:bg-accent/30 hover:text-foreground hover:border-border/60'
            }`}
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                isActive ? 'bg-primary/20' : 'bg-accent/40'
              }`}
            >
              <Play
                className={`w-3.5 h-3.5 ${isActive ? 'text-primary fill-primary' : 'text-muted-foreground'}`}
              />
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-bold ${isActive ? 'text-foreground' : ''}`}>
                {clipLabel(name)}
              </p>
              <p className="text-[11px] text-muted-foreground/70 truncate">{name}</p>
            </div>
            {isActive && (
              <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                재생 중
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
