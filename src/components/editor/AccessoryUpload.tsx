import { useState, useRef, useEffect } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle, X, Image as ImageIcon } from 'lucide-react';
import { useEditorStore, runAccessoryGenerationTask } from '@/stores/editorStore';
import type { PresetItem } from '@/types/preset';
import type { AccessoryCategory } from '@/types/accessory';

type UploadStatus = 'idle' | 'pending' | 'uploading' | 'processing' | 'success' | 'error';

export function AccessoryUpload() {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [accessoryName, setAccessoryName] = useState<string>('');
  const [accessoryCategory, setAccessoryCategory] = useState<string>('glasses');
  const [braceletSide, setBraceletSide] = useState<'left' | 'right'>('left');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceSingleAccessory = useEditorStore((s) => s.replaceSingleAccessory);
  const addCustomPreset = useEditorStore((s) => s.addCustomPreset);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isGlb = file.name.toLowerCase().endsWith('.glb');
    const isImage = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/i);

    if (!isGlb && !isImage) {
      setStatus('error');
      setErrorMessage('GLB 파일 또는 이미지 파일(.png, .jpg, .jpeg, .webp)만 업로드할 수 있습니다.');
      return;
    }

    setSelectedFile(file);
    // Remove extension for default name
    const defaultName = file.name.replace(/\.[^/.]+$/, "");
    setAccessoryName(defaultName);
    setStatus('pending');
    setErrorMessage('');
  };

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFile && selectedFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [selectedFile]);

  const cancelUpload = () => {
    setSelectedFile(null);
    setAccessoryName('');
    setStatus('idle');
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const backgroundTasks = useEditorStore((s) => s.backgroundTasks);

  useEffect(() => {
    if (currentTaskId && status === 'processing') {
      const task = backgroundTasks.find((t) => t.id === currentTaskId);
      if (!task) {
        // Task removed (likely completed or timed out)
        cancelUpload();
      } else if (task.status === 'success') {
        setStatus('success');
        setTimeout(() => cancelUpload(), 3000);
      } else if (task.status === 'error') {
        setStatus('error');
        setErrorMessage(task.errorMessage || '오류가 발생했습니다.');
      }
    }
  }, [backgroundTasks, currentTaskId, status]);

  const handleUploadSubmit = () => {
    if (!selectedFile) return;

    const finalCategory = (accessoryCategory === 'bracelet' 
      ? `bracelet_${braceletSide}` 
      : accessoryCategory) as AccessoryCategory;

    const taskId = `task-${Date.now()}`;
    setCurrentTaskId(taskId);
    
    useEditorStore.getState().addBackgroundTask({
      id: taskId,
      filename: selectedFile.name,
      category: finalCategory,
      status: 'uploading'
    });

    // Run in background without awaiting
    runAccessoryGenerationTask(taskId, selectedFile, finalCategory, accessoryName);

    // Enter processing UI state
    setStatus('processing');
  };

  const handleContinueInBackground = () => {
    setCurrentTaskId(null);
    cancelUpload();
  };

  return (
    <div className="mb-6 rounded-xl border border-border/40 bg-card/40 p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground/90">악세사리 추가</h3>
      
      {status === 'pending' && selectedFile ? (
        <div className="flex flex-col gap-3 p-3 border rounded-lg bg-background/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{selectedFile.name}</span>
            <button onClick={cancelUpload} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">악세사리 이름</label>
            <input 
              type="text" 
              value={accessoryName}
              onChange={(e) => setAccessoryName(e.target.value)}
              className="w-full text-xs bg-background border border-border/50 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="이름을 입력하세요"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">악세사리 종류</label>
            <div className="flex gap-2">
              <select
                value={accessoryCategory}
                onChange={(e) => setAccessoryCategory(e.target.value)}
                className="w-full text-xs bg-background border border-border/50 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="glasses">안경</option>
                <option value="bracelet">팔찌</option>
                <option value="other">기타</option>
              </select>
              
              {accessoryCategory === 'bracelet' && (
                <select
                  value={braceletSide}
                  onChange={(e) => setBraceletSide(e.target.value as 'left' | 'right')}
                  className="w-full text-xs bg-background border border-border/50 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="left">왼손</option>
                  <option value="right">오른손</option>
                </select>
              )}
            </div>
          </div>
          <button 
            onClick={handleUploadSubmit}
            className="w-full mt-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-xs py-1.5 font-medium transition-colors"
          >
            {selectedFile.name.toLowerCase().endsWith('.glb') ? 'GLB 업로드' : '3D 악세사리 만들기'}
          </button>
        </div>
      ) : (
        <div 
          className="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/50 bg-background/50 p-6 transition-colors hover:bg-accent/20"
          onClick={() => status === 'idle' || status === 'error' ? fileInputRef.current?.click() : null}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            className="hidden" 
            accept=".glb,.png,.jpg,.jpeg,.webp"
            onChange={handleFileChange}
            disabled={status === 'uploading' || status === 'processing'}
          />

          {status === 'idle' && (
            <>
              <Upload className="mb-2 h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground font-medium">클릭하거나 파일을 드래그하여 업로드</p>
              <p className="mt-1.5 text-[10px] text-muted-foreground/60 text-center max-w-[220px]">
                추가하고 싶은 악세사리의 이미지나 glb 파일을 자유롭게 업로드 하세요.
                <br/>
                <span className="font-medium text-primary/70">악세사리만 단독으로 있는 이미지가 좋아요.</span>
              </p>
            </>
          )}

          {status === 'processing' && (
            <div className="flex flex-col items-center w-full gap-4 relative">
              {/* Scanning Preview */}
              <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-primary/20 bg-black/20 flex items-center justify-center">
                {previewUrl ? (
                  <img src={previewUrl} className="w-full h-full object-cover opacity-60" alt="preview" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground" />
                )}
                {/* CSS Scanning Line Effect */}
                <div className="absolute inset-0 z-10 pointer-events-none">
                  <div className="w-full h-full relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[2px] bg-primary shadow-[0_0_8px_2px_rgba(59,130,246,0.8)] animate-[scan_3.5s_ease-in-out_infinite]" />
                    <div className="absolute top-0 left-0 w-full h-1/3 bg-gradient-to-b from-primary/30 to-transparent animate-[scan-fade_3.5s_ease-in-out_infinite]" />
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-1 text-center">
                <span className="text-xs font-medium text-primary">3D 변환 작업 중...</span>
                <span className="text-[10px] text-muted-foreground">이 작업은 약 2~3분 정도 소요될 수 있습니다.</span>
              </div>
              
              <button 
                onClick={(e) => { e.stopPropagation(); handleContinueInBackground(); }}
                className="mt-2 w-full px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-md text-xs font-medium transition-colors"
              >
                창 닫고 아바타 계속 꾸미기
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-2 text-destructive text-center">
              <AlertCircle className="h-6 w-6" />
              <span className="text-xs font-medium">업로드/생성 실패</span>
              <p className="text-[10px] opacity-80 max-w-[200px] break-words">{errorMessage}</p>
              <button 
                onClick={(e) => { e.stopPropagation(); setStatus('idle'); }} 
                className="mt-2 px-3 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded text-[10px]"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
