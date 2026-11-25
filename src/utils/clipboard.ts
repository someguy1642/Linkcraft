/**
 * Copies text to the system clipboard using navigator.clipboard with an execCommand fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below if Clipboard API is blocked in an iframe or insecure context
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function buildShortUrl(code: string): string {
  const configuredBase = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_PUBLIC_BASE_URL;
  if (configuredBase && configuredBase.trim()) {
    return `${configuredBase.trim().replace(/\/+$/, '')}/${code}`;
  }
  if (typeof window === 'undefined') return `/${code}`;
  return `${window.location.origin}/${code}`;
}
