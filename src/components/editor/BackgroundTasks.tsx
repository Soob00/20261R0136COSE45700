'use client';

import { useEditorStore } from '@/stores/editorStore';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function BackgroundTasks() {
  const backgroundTasks = useEditorStore((state) => state.backgroundTasks);

  if (backgroundTasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {backgroundTasks.map((task) => (
        <div
          key={task.id}
          className="bg-card text-card-foreground border shadow-lg rounded-lg p-4 w-80 flex items-center gap-3 animate-in slide-in-from-bottom-5 fade-in duration-300"
        >
          {task.status === 'processing' || task.status === 'uploading' ? (
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          ) : task.status === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500" />
          )}
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {task.status === 'processing' || task.status === 'uploading'
                ? `[${task.category}] 악세사리 생성 중...`
                : task.status === 'success'
                ? '✨ 생성이 완료되었습니다!'
                : '생성 실패'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {task.status === 'success' 
                ? '악세사리 목록에 추가되었어요.'
                : task.errorMessage || task.filename}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
