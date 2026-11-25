import { RefreshCw, WifiOff } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
  queuedCount: number;
  isSyncing: boolean;
  onRetrySync: () => void;
}

export function OfflineBanner({ isOnline, queuedCount, isSyncing, onRetrySync }: OfflineBannerProps) {
  if (isOnline && queuedCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <WifiOff className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          <span>
            {!isOnline
              ? `You are offline. ${
                  queuedCount > 0
                    ? `${queuedCount} link${queuedCount === 1 ? '' : 's'} queued and will sync automatically when you reconnect.`
                    : 'New links created offline will be queued for retry.'
                }`
              : `${queuedCount} offline link${queuedCount === 1 ? '' : 's'} ready to sync.`}
          </span>
        </div>
        {isOnline && queuedCount > 0 && (
          <button
            type="button"
            onClick={onRetrySync}
            disabled={isSyncing}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {isSyncing ? 'Syncing...' : 'Sync now'}
          </button>
        )}
      </div>
    </div>
  );
}
