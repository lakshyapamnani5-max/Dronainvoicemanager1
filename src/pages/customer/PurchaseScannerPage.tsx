import * as React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Crop,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanLine,
  Upload,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { purchaseOcrApi } from '../../lib/api';
import { validatePurchaseOcrResponse } from '../../lib/purchaseOcrValidator';
import { setStagedPurchaseScan } from '../../lib/purchaseScanBridge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { useToast } from '../../components/ui/toast';

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
]);

interface CropRect {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

const DEFAULT_CROP: CropRect = { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };

export function PurchaseScannerPage({ navigate }: { navigate: (path: string) => void }) {
  const { session } = useAuth();
  const { notify } = useToast();
  const recipientState = session?.businessProfile?.state || 'Maharashtra';

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const cameraInputRef = React.useRef<HTMLInputElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [fileName, setFileName] = React.useState('');
  const [mimeType, setMimeType] = React.useState('');
  const [sizeBytes, setSizeBytes] = React.useState(0);
  const [originalDataUrl, setOriginalDataUrl] = React.useState('');
  const [workingImageDataUrl, setWorkingImageDataUrl] = React.useState('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = React.useState('');
  const [rotationDeg, setRotationDeg] = React.useState(0);
  const [cropMode, setCropMode] = React.useState(false);
  const [cropRect, setCropRect] = React.useState<CropRect>(DEFAULT_CROP);
  const [extracting, setExtracting] = React.useState(false);
  const [ocrError, setOcrError] = React.useState<string | null>(null);

  const stopCamera = React.useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  React.useEffect(() => () => stopCamera(), [stopCamera]);

  React.useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  const loadFile = (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const inferredMime =
      file.type ||
      (ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg');

    if (!ACCEPTED_TYPES.has(inferredMime.toLowerCase())) {
      notify('error', 'Unsupported format. Please upload JPG, JPEG, PNG, or PDF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      notify('error', 'File exceeds the maximum 15 MB limit.');
      return;
    }

    setOcrError(null);
    setFileName(file.name);
    setMimeType(inferredMime);
    setSizeBytes(file.size);
    setRotationDeg(0);
    setCropMode(false);
    setCropRect(DEFAULT_CROP);

    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    if (inferredMime === 'application/pdf') {
      setPdfPreviewUrl(URL.createObjectURL(file));
    } else {
      setPdfPreviewUrl('');
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setOriginalDataUrl(dataUrl);
      setWorkingImageDataUrl(dataUrl);
    };
    reader.onerror = () => notify('error', 'Failed to read selected file');
    reader.readAsDataURL(file);
  };

  const openWebRtcCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      // Fall back to native mobile capture input if WebRTC camera blocked/unavailable
      cameraInputRef.current?.click();
    }
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    setOcrError(null);
    setFileName(`bill-${Date.now()}.jpg`);
    setMimeType('image/jpeg');
    setSizeBytes(Math.round((dataUrl.length * 3) / 4));
    setOriginalDataUrl(dataUrl);
    setWorkingImageDataUrl(dataUrl);
    setPdfPreviewUrl('');
    setRotationDeg(0);
    setCropMode(false);
    setCropRect(DEFAULT_CROP);
  };

  // Apply rotation via offscreen canvas so uploaded pixels match preview
  const rotateImage = (deltaDeg: number) => {
    if (!workingImageDataUrl || mimeType === 'application/pdf') return;
    const img = new Image();
    img.onload = () => {
      const nextRot = (rotationDeg + deltaDeg + 360) % 360;
      const canvas = document.createElement('canvas');
      const swap = Math.abs(deltaDeg) === 90;
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deltaDeg * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const outUrl = canvas.toDataURL('image/jpeg', 0.92);
      setWorkingImageDataUrl(outUrl);
      setRotationDeg(nextRot);
      setCropRect(DEFAULT_CROP);
    };
    img.src = workingImageDataUrl;
  };

  const applyCrop = () => {
    if (!workingImageDataUrl || mimeType === 'application/pdf') return;
    const img = new Image();
    img.onload = () => {
      const sx = Math.round((cropRect.xPct / 100) * img.naturalWidth);
      const sy = Math.round((cropRect.yPct / 100) * img.naturalHeight);
      const sw = Math.max(20, Math.round((cropRect.wPct / 100) * img.naturalWidth));
      const sh = Math.max(20, Math.round((cropRect.hPct / 100) * img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const croppedUrl = canvas.toDataURL('image/jpeg', 0.92);
      setWorkingImageDataUrl(croppedUrl);
      setMimeType('image/jpeg');
      setSizeBytes(Math.round((croppedUrl.length * 3) / 4));
      setCropMode(false);
      setCropRect(DEFAULT_CROP);
      notify('success', 'Crop applied to image');
    };
    img.src = workingImageDataUrl;
  };

  const handleResetEdits = () => {
    setWorkingImageDataUrl(originalDataUrl);
    setRotationDeg(0);
    setCropMode(false);
    setCropRect(DEFAULT_CROP);
  };

  const handleContinueManuallyWithAttachment = () => {
    if (!workingImageDataUrl) return;
    setStagedPurchaseScan({
      validatedOcr: null,
      attachmentFile: {
        fileName,
        mimeType,
        sizeBytes,
        base64Data: workingImageDataUrl,
      },
      createdAt: Date.now(),
    });
    navigate('/purchases/new?fromScan=1');
  };

  const handleExtractOcr = async () => {
    if (!workingImageDataUrl) return;
    setExtracting(true);
    setOcrError(null);
    try {
      const raw = await purchaseOcrApi.extract({
        fileName,
        mimeType,
        base64Data: workingImageDataUrl,
      });
      const validated = validatePurchaseOcrResponse(raw, recipientState);
      setStagedPurchaseScan({
        validatedOcr: validated,
        rawText: raw.rawText,
        ocrEngine: raw.engine,
        pageCount: raw.pageCount,
        attachmentFile: {
          fileName,
          mimeType,
          sizeBytes,
          base64Data: workingImageDataUrl,
          pageCount: raw.pageCount,
        },
        createdAt: Date.now(),
      });
      notify(
        'success',
        `Extracted ${validated.items.length} row(s) via ${raw.engine}. Review fields before saving.`
      );
      navigate('/purchases/new?fromScan=1');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to extract purchase bill via PaddleOCR';
      setOcrError(message);
      notify('error', message);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/purchases')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Purchases
        </Button>
        <div className="text-xs text-zinc-500">
          Powered by PaddleOCR PP-StructureV3 · Supports JPG, PNG &amp; Multi-page PDF (max 15 MB)
        </div>
      </div>

      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />

      {cameraOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Camera Capture</CardTitle>
            <CardDescription>Align the entire purchase invoice inside the frame</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800">
              <video ref={videoRef} playsInline muted className="w-full max-h-[60vh] object-contain" />
            </div>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={stopCamera}>
                Cancel
              </Button>
              <Button onClick={captureFromCamera}>
                <Camera className="h-4 w-4" />
                Capture Photograph
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : !workingImageDataUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>Scan or Upload Supplier Purchase Bill</CardTitle>
            <CardDescription>
              Capture a clear photo or upload an image/PDF invoice. You will review all extracted values before saving.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
              <button
                type="button"
                onClick={openWebRtcCamera}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 p-8 text-center hover:border-[#F57C00] hover:bg-orange-50/40 transition-colors dark:border-zinc-700 dark:hover:bg-orange-950/10 cursor-pointer"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-[#F57C00] dark:bg-orange-950/40">
                  <Camera className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Capture with Camera
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Use mobile rear camera or webcam to photograph paper bill
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 p-8 text-center hover:border-[#F57C00] hover:bg-orange-50/40 transition-colors dark:border-zinc-700 dark:hover:bg-orange-950/10 cursor-pointer"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                  <Upload className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Upload Image or PDF
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    JPG, JPEG, PNG or multi-page PDF up to 15 MB
                  </div>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="truncate">{fileName}</CardTitle>
              <CardDescription>
                {mimeType === 'application/pdf' ? 'PDF Document' : 'Image Preview'} ·{' '}
                {Math.max(1, Math.round(sizeBytes / 1024))} KB
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mimeType !== 'application/pdf' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => rotateImage(-90)}
                    title="Rotate Left 90°"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => rotateImage(90)}
                    title="Rotate Right 90°"
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={cropMode ? 'default' : 'outline'}
                    onClick={() => setCropMode((v) => !v)}
                  >
                    <Crop className="h-4 w-4" />
                    {cropMode ? 'Cropping' : 'Crop'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={handleResetEdits}>
                    Reset
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setOriginalDataUrl('');
                  setWorkingImageDataUrl('');
                  setOcrError(null);
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Retake / Change
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {mimeType === 'application/pdf' ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 overflow-hidden dark:border-zinc-800 dark:bg-zinc-900">
                {pdfPreviewUrl ? (
                  <iframe
                    src={pdfPreviewUrl}
                    title="Uploaded Purchase PDF Preview"
                    className="w-full h-[55vh]"
                  />
                ) : (
                  <div className="p-10 text-center text-sm text-zinc-500">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-[#F57C00]" />
                    PDF ready for PaddleOCR extraction
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative rounded-xl border border-zinc-200 bg-zinc-950/90 overflow-hidden flex items-center justify-center max-h-[60vh] dark:border-zinc-800">
                  <div className="relative inline-block max-w-full">
                    <img
                      src={workingImageDataUrl}
                      alt="Purchase bill preview"
                      className="max-h-[58vh] w-auto object-contain block"
                    />
                    {cropMode ? (
                      <div
                        className="absolute border-2 border-[#F57C00] bg-orange-500/15 pointer-events-none"
                        style={{
                          left: `${cropRect.xPct}%`,
                          top: `${cropRect.yPct}%`,
                          width: `${cropRect.wPct}%`,
                          height: `${cropRect.hPct}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </div>

                {cropMode ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <label className="space-y-1">
                        <span>Left ({cropRect.xPct}%)</span>
                        <input
                          type="range"
                          min={0}
                          max={80}
                          value={cropRect.xPct}
                          onChange={(e) => {
                            const x = Number(e.target.value);
                            setCropRect((r) => ({ ...r, xPct: x, wPct: Math.min(r.wPct, 100 - x) }));
                          }}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1">
                        <span>Top ({cropRect.yPct}%)</span>
                        <input
                          type="range"
                          min={0}
                          max={80}
                          value={cropRect.yPct}
                          onChange={(e) => {
                            const y = Number(e.target.value);
                            setCropRect((r) => ({ ...r, yPct: y, hPct: Math.min(r.hPct, 100 - y) }));
                          }}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1">
                        <span>Width ({cropRect.wPct}%)</span>
                        <input
                          type="range"
                          min={15}
                          max={100 - cropRect.xPct}
                          value={cropRect.wPct}
                          onChange={(e) => setCropRect((r) => ({ ...r, wPct: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1">
                        <span>Height ({cropRect.hPct}%)</span>
                        <input
                          type="range"
                          min={15}
                          max={100 - cropRect.yPct}
                          value={cropRect.hPct}
                          onChange={(e) => setCropRect((r) => ({ ...r, hPct: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setCropMode(false)}>
                        Cancel Crop
                      </Button>
                      <Button size="sm" onClick={applyCrop}>
                        <Check className="h-4 w-4" />
                        Apply Crop
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {ocrError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 space-y-2 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">OCR Extraction Unavailable / Failed</div>
                    <div className="mt-0.5">{ocrError}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => void handleExtractOcr()}>
                    Retry OCR Extraction
                  </Button>
                  <Button size="sm" onClick={handleContinueManuallyWithAttachment}>
                    Continue Manually with Attachment
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                disabled={extracting}
                onClick={handleContinueManuallyWithAttachment}
              >
                Skip OCR &amp; Enter Manually
              </Button>
              <Button disabled={extracting} onClick={() => void handleExtractOcr()}>
                {extracting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running PaddleOCR PP-StructureV3...
                  </>
                ) : (
                  <>
                    <ScanLine className="h-4 w-4" />
                    Extract Bill with PaddleOCR
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
