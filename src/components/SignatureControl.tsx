import * as React from 'react';
import { Check, Eraser, PenTool, Trash2, Upload } from 'lucide-react';
import { processLogoFile } from '../lib/utils';
import { Button } from './ui/button';
import { Input, Label } from './ui/input';
import { useToast } from './ui/toast';

interface SignatureControlProps {
  signatureDataUrl: string;
  signatureLabel: string;
  onChangeDataUrl: (url: string) => void;
  onChangeLabel: (label: string) => void;
}

export function SignatureControl({
  signatureDataUrl,
  signatureLabel,
  onChangeDataUrl,
  onChangeLabel,
}: SignatureControlProps) {
  const { notify } = useToast();
  const [mode, setMode] = React.useState<'draw' | 'upload'>('draw');
  const [hasStroke, setHasStroke] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const drawingRef = React.useRef(false);
  const lastPointRef = React.useRef<{ x: number; y: number } | null>(null);

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getCoords(e);
    drawingRef.current = true;
    lastPointRef.current = pt;
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + 0.1, pt.y + 0.1);
    ctx.stroke();
    setHasStroke(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getCoords(e);
    const prev = lastPointRef.current || pt;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPointRef.current = pt;
    setHasStroke(true);
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  };

  const handleApplyDrawnSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) {
      notify('error', 'Please draw your signature on the pad first');
      return;
    }
    const url = canvas.toDataURL('image/png');
    onChangeDataUrl(url);
    notify('success', 'Signature captured — click Save to keep it');
  };

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const processed = await processLogoFile(file, 420);
      onChangeDataUrl(processed);
      notify('success', 'Signature image uploaded — click Save to keep it');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to process signature image');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div className="space-y-1">
          <Label>Signatory Label (Printed under signature line)</Label>
          <Input
            value={signatureLabel}
            onChange={(e) => onChangeLabel(e.target.value)}
            placeholder="For Your Business / Authorized Signatory"
          />
        </div>

        <div className="space-y-1">
          <Label>Active Signature Preview</Label>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 min-h-[56px] dark:border-zinc-800">
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt="Authorized Signature"
                className="max-h-12 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <span className="text-xs text-zinc-400">No signature image set</span>
            )}
            {signatureDataUrl ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-red-600 hover:text-red-700 shrink-0"
                onClick={() => onChangeDataUrl('')}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setMode('draw')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                mode === 'draw'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              Draw Signature
            </button>
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                mode === 'upload'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Image
            </button>
          </div>
          <span className="text-[11px] text-zinc-500">
            Shown on invoices, quotations &amp; downloaded PDFs
          </span>
        </div>

        {mode === 'draw' ? (
          <div className="space-y-2.5">
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white overflow-hidden">
              <canvas
                ref={canvasRef}
                width={640}
                height={180}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className="w-full h-36 sm:h-40 touch-none cursor-crosshair block"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500">
                Sign above with your mouse, trackpad, stylus, or finger.
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleClearCanvas}
                  disabled={!hasStroke}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  Clear Pad
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyDrawnSignature}
                  disabled={!hasStroke}
                >
                  <Check className="h-3.5 w-3.5" />
                  Use Drawn Signature
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-xs text-zinc-600 dark:text-zinc-300">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                Upload a scanned or digital signature
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                PNG (transparent recommended), JPG, WebP or SVG. Automatically resized for A4 PDFs.
              </p>
            </div>
            <label className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-100 cursor-pointer shrink-0 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
              <Upload className="h-3.5 w-3.5 text-[#F57C00]" />
              {uploading ? 'Processing...' : 'Choose Signature Image'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  void handleUploadFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
