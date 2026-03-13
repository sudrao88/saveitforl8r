/**
 * whatsappService.ts
 *
 * Client-side API for WhatsApp integration endpoints.
 * Handles linking/unlinking, status checks, and note fetching.
 */

import { getProxyUrl } from './proxyService';
import { getValidToken } from './googleAuth';

interface WhatsAppNote {
  id: string;
  timestamp: number;
  content: string;
  attachments: Array<{
    id: string;
    type: 'image' | 'file';
    mimeType: string;
    data: string;
    name: string;
  }>;
  tags: string[];
  enrichment: Record<string, unknown> | null;
  source: 'whatsapp';
  status: 'pending' | 'enriching' | 'ready' | 'failed';
}

interface WhatsAppStatus {
  linked: boolean;
  whatsappNumber?: string;
  linkedAt?: number;
}

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await getValidToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // Not authenticated
  }
  return headers;
};

/**
 * Fetch unfetched WhatsApp notes for the current user.
 */
export const fetchWhatsAppNotes = async (): Promise<WhatsAppNote[]> => {
  const url = `${getProxyUrl()}/api/whatsapp/notes`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    if (res.status === 503) return []; // WhatsApp not configured on server
    throw new Error(`Failed to fetch WhatsApp notes: ${res.status}`);
  }

  const data = await res.json();
  return data.notes || [];
};

/**
 * Acknowledge that notes have been fetched and stored locally.
 */
export const acknowledgeNotes = async (noteIds: string[]): Promise<void> => {
  if (noteIds.length === 0) return;

  const url = `${getProxyUrl()}/api/whatsapp/notes/ack`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ noteIds }),
  });

  if (!res.ok) {
    throw new Error(`Failed to acknowledge notes: ${res.status}`);
  }
};

/**
 * Initiate WhatsApp linking by sending a verification code.
 */
export const linkWhatsApp = async (whatsappNumber: string): Promise<void> => {
  const url = `${getProxyUrl()}/api/whatsapp/link`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ whatsappNumber }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to send verification code: ${res.status}`);
  }
};

/**
 * Verify the WhatsApp linking code.
 */
export const verifyWhatsApp = async (code: string): Promise<{ whatsappNumber: string }> => {
  const url = `${getProxyUrl()}/api/whatsapp/verify`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Verification failed: ${res.status}`);
  }

  return res.json();
};

/**
 * Check if the current user has a linked WhatsApp number.
 */
export const getWhatsAppStatus = async (): Promise<WhatsAppStatus> => {
  const url = `${getProxyUrl()}/api/whatsapp/status`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    if (res.status === 503) return { linked: false }; // WhatsApp not configured
    throw new Error(`Failed to check WhatsApp status: ${res.status}`);
  }

  return res.json();
};

/**
 * Unlink WhatsApp from the current user's account.
 */
export const unlinkWhatsApp = async (): Promise<void> => {
  const url = `${getProxyUrl()}/api/whatsapp/link`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok) {
    throw new Error(`Failed to unlink WhatsApp: ${res.status}`);
  }
};

export type { WhatsAppNote, WhatsAppStatus };
