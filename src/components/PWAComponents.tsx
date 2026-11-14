import * as React from 'react';
import { Download, MonitorSmartphone, Share, Smartphone, WifiOff } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../lib/usePWAInstall';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'card';
  className?: string;
}

export function PWAInstallButton({ variant = 'header', className = '' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [guideOpen, setGuideOpen] = React.useState(false);

  if (isInstalled) {
    if (variant === 'card') {
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
          DRONA Invoice is installed on this device and running in standalone app mode.
        </div>
      );
    }
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setGuideOpen(true);
  };

  if (variant === 'header' && !isInstallable && !isIOS) {
    return null;
  }

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={handleAction}
          className={`flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer ${className}`}
        >
          <Download className="h-3.5 w-3.5 text-[#F57C00]" />
          <span>Install App (PC / Mobile)</span>
        </button>
      ) : variant === 'card' ? (
        <Button type="button" onClick={handleAction} className={className}>
          <MonitorSmartphone className="h-4 w-4" />
          {isInstallable ? 'Install DRONA App Now' : 'How to Install App (Mobile & PC)'}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleAction}
          className={`h-9 px-2.5 text-xs ${className}`}
          title="Install DRONA Invoice App"
        >
          <Download className="h-3.5 w-3.5 text-[#F57C00]" />
          <span className="hidden sm:inline">Install App</span>
        </Button>
      )}

      <Dialog
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Install DRONA Invoice App"
        description="Use DRONA Invoice as a standalone desktop & mobile app with faster launch and offline support."
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <img
              src="/drona-logo.png"
              alt="DRONA Invoice"
              className="h-12 w-12 rounded-xl object-contain shrink-0"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                DRONA Invoice Manager
              </div>
              <div className="text-xs text-zinc-500">
                Works on Windows, macOS, Android &amp; iOS
              </div>
            </div>
          </div>

          {isIOS ? (
            <div className="space-y-2 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <div className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
                <Smartphone className="h-4 w-4 text-[#F57C00]" />
                iPhone / iPad (Safari)
              </div>
              <p>
                1. Tap the <Share className="inline h-3.5 w-3.5 mx-0.5 text-[#F57C00]" />{' '}
                <strong>Share</strong> button in Safari&apos;s toolbar.
              </p>
              <p>
                2. Scroll down and tap <strong>Add to Home Screen</strong>, then tap{' '}
                <strong>Add</strong>.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                  Desktop (Chrome / Edge on Windows &amp; macOS)
                </div>
                <p>
                  Click the <strong>Install</strong> icon in the right side of the browser address
                  bar (or open browser menu <strong>⋮ → Cast, save, and share → Install DRONA Invoice</strong>).
                </p>
              </div>
              <div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                  Android (Chrome)
                </div>
                <p>
                  Open the browser menu <strong>⋮</strong> and tap <strong>Install app</strong> or{' '}
                  <strong>Add to Home screen</strong>.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setGuideOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="no-print fixed bottom-20 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 shadow-lg">
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>Offline Mode — Cached app shell active</span>
    </div>
  );
}
