import type { CreateLinkPayload, ShortLink } from '../shared/types';

const GUEST_LINKS_KEY = 'linkcraft_guest_links_v1';
const OFFLINE_QUEUE_KEY = 'linkcraft_offline_queue_v1';

export interface QueuedShortenAction {
  id: string;
  payload: CreateLinkPayload;
  queuedAt: string;
}

export function loadGuestLinks(): ShortLink[] {
  try {
    const raw = localStorage.getItem(GUEST_LINKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ShortLink[]) : [];
  } catch {
    return [];
  }
}

export function saveGuestLinks(links: ShortLink[]): void {
  try {
    localStorage.setItem(GUEST_LINKS_KEY, JSON.stringify(links.slice(0, 200)));
  } catch {
    // Ignore storage quota errors
  }
}

export function upsertGuestLink(link: ShortLink): void {
  const existing = loadGuestLinks().filter((l) => l.id !== link.id);
  saveGuestLinks([link, ...existing]);
}

export function removeGuestLinks(ids: string[]): void {
  const idSet = new Set(ids);
  saveGuestLinks(loadGuestLinks().filter((l) => !idSet.has(l.id)));
}

export function loadOfflineQueue(): QueuedShortenAction[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedShortenAction[]) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineShorten(payload: CreateLinkPayload): QueuedShortenAction[] {
  const next: QueuedShortenAction = {
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    payload,
    queuedAt: new Date().toISOString(),
  };
  const queue = [...loadOfflineQueue(), next];
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore
  }
  return queue;
}

export function saveOfflineQueue(queue: QueuedShortenAction[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore
  }
}
