import { useCallback, useRef, useState } from 'react';

interface Props {
  onImageSelected: (img: HTMLImageElement) => void;
  isProcessing: boolean;
}

export default function ImageUploader({ onImageSelected, isProcessing }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => onImageSelected(img);
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    },
    [onImageSelected],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
        dragOver
          ? 'border-indigo-400 bg-indigo-950/50'
          : 'border-slate-600 hover:border-slate-400'
      } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {isProcessing ? (
        <div className="text-slate-400">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full mx-auto mb-3" />
          分析中...
        </div>
      ) : (
        <div className="text-slate-400">
          <div className="text-4xl mb-3">📸</div>
          <p className="text-lg">顔写真をドロップ または クリックして選択</p>
          <p className="text-sm mt-2 text-slate-500">
            画像はブラウザ内のみで処理されます（サーバーには送信されません）
          </p>
        </div>
      )}
    </div>
  );
}
