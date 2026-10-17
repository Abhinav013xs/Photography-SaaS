/**
 * Studio Lumina - Centralized API Service
 */

const API_BASE = '/api';

function getAuthHeader() {
  const token = localStorage.getItem('photographer_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...options.headers,
  };

  const config = {
    credentials: 'include',
    ...options,
    headers,
  };

  const response = await fetch(url, config);

  if (response.status === 401 && !endpoint.includes('/guest/')) {
    // If photographer session expired, clear token
    if (localStorage.getItem('photographer_token')) {
      localStorage.removeItem('photographer_token');
      window.dispatchEvent(new Event('auth-expired'));
    }
  }

  const contentType = response.headers.get('content-type');
  let data;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    let errorMsg = 'Request failed';
    if (data && data.error) {
      if (typeof data.error === 'string') {
        errorMsg = data.error;
      } else if (typeof data.error === 'object') {
        if (Array.isArray(data.error.details) && data.error.details.length > 0) {
          errorMsg = data.error.details.map((d) => d.message || `${d.field}: invalid`).join(', ');
        } else if (data.error.message) {
          errorMsg = data.error.message;
        } else {
          errorMsg = JSON.stringify(data.error);
        }
      }
    } else if (data && data.message) {
      errorMsg = data.message;
    } else if (typeof data === 'string') {
      errorMsg = data;
    }
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  // Auto-merge data.data for seamless compatibility with both unwrapped and envelope structures
  if (data && typeof data === 'object' && data.success && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    return {
      ...data,
      ...data.data,
    };
  }

  return data;
}

export const api = {
  // Auth
  async login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const token = data.token || data.data?.token;
    if (token) {
      localStorage.setItem('photographer_token', token);
    }
    return data;
  },

  async getMe() {
    return request('/auth/me');
  },

  async updateProfile(profileData) {
    return request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  },

  logout() {
    localStorage.removeItem('photographer_token');
  },

  // Events
  async getEvents({ status = 'active', search = '', sort = 'date_desc' } = {}) {
    const params = new URLSearchParams({ status, search, sort });
    return request(`/events?${params.toString()}`);
  },

  async createEvent(eventData) {
    return request('/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    });
  },

  async getEvent(id) {
    return request(`/events/${id}`);
  },

  async updateEvent(id, eventData) {
    return request(`/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(eventData),
    });
  },

  async updateEventVisibility(id, visibility, public_duration_days) {
    return request(`/events/${id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility, public_duration_days }),
    });
  },

  async publishEvent(id, public_duration_days) {
    return request(`/events/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ public_duration_days }),
    });
  },


  async archiveEvent(id) {
    return request(`/events/${id}/archive`, { method: 'POST' });
  },

  async unarchiveEvent(id) {
    return request(`/events/${id}/unarchive`, { method: 'POST' });
  },

  async restoreEvent(id) {
    return request(`/events/${id}/restore`, { method: 'POST' });
  },

  async moveToTrash(id) {
    return request(`/events/${id}/trash`, { method: 'POST' });
  },

  async deleteEvent(id, confirmEventName) {
    return request(`/events/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmEventName, confirmName: confirmEventName }),
    });
  },

  async deleteEventPermanently(id, confirmEventName) {
    return request(`/events/${id}/permanent`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmEventName, confirmName: confirmEventName }),
    });
  },

  async getBinEvents() {
    return request('/events/bin');
  },

  async emptyBin() {
    return request('/events/bin/empty', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
  },

  async getEventDeletionStatus(id) {
    return request(`/events/${id}/deletion-status`);
  },

  async getEventQr(id) {
    return request(`/events/${id}/qr`);
  },

  async reprocessWatermark(id) {
    return request(`/events/${id}/watermark/reprocess`, { method: 'POST' });
  },

  async getWatermarkStatus(id) {
    return request(`/events/${id}/watermark/status`);
  },

  // Folders
  async getFolders(eventId) {
    return request(`/events/${eventId}/folders`);
  },

  async createFolder(eventId, name) {
    return request(`/events/${eventId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async renameFolder(eventId, folderId, name) {
    return request(`/events/${eventId}/folders/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  async deleteFolder(eventId, folderId, targetFolderId) {
    const query = targetFolderId ? `?targetFolderId=${targetFolderId}` : '';
    return request(`/events/${eventId}/folders/${folderId}${query}`, {
      method: 'DELETE',
    });
  },

  // Media
  async getMedia(eventId, { folderId, type } = {}) {
    const params = new URLSearchParams();
    if (folderId) params.append('folderId', folderId);
    if (type) params.append('type', type);
    return request(`/media/event/${eventId}?${params.toString()}`);
  },

  async uploadMedia(eventId, files, folderId, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();

      if (folderId) {
        formData.append('folderId', folderId);
      }

      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent, e.loaded, e.total);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || 'Upload failed'));
          } catch (e) {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

      xhr.open('POST', `${API_BASE}/media/upload/${eventId}`);
      const token = localStorage.getItem('photographer_token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.send(formData);
    });
  },

  async moveMedia(mediaIds, targetFolderId) {
    return request('/media/move', {
      method: 'PUT',
      body: JSON.stringify({ mediaIds, targetFolderId }),
    });
  },

  async deleteMediaBatch(mediaIds) {
    return request('/media/batch', {
      method: 'DELETE',
      body: JSON.stringify({ mediaIds }),
    });
  },

  // Phase 21: Download System
  async downloadIndividualMedia(slug, mediaId, representation = 'original', guestToken = null) {
    const headers = {};
    if (guestToken) {
      headers['x-guest-token'] = guestToken;
    }
    const res = await request(`/guest/gallery/${slug}/download/${mediaId}?type=${representation}`, {
      headers,
    });
    if (res.data?.downloadUrl) {
      const a = document.createElement('a');
      a.href = res.data.downloadUrl;
      a.download = res.data.filename || 'photo';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    return res.data;
  },

  async requestBulkDownloadZip(slug, mediaIds = null, guestToken = null) {
    const headers = {};
    if (guestToken) {
      headers['x-guest-token'] = guestToken;
    }
    const res = await request(`/guest/gallery/${slug}/download-zip`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mediaIds: mediaIds && mediaIds.length > 0 ? mediaIds : undefined }),
    });
    return res.data;
  },

  async getDownloadJobStatus(slug, jobId, guestToken = null) {
    const headers = {};
    if (guestToken) {
      headers['x-guest-token'] = guestToken;
    }
    const res = await request(`/guest/gallery/${slug}/download-jobs/${jobId}`, {
      headers,
    });
    return res.data;
  },

  async downloadZip(slugOrEventId, mediaIds = null) {
    // Direct or fallback bulk ZIP initiation
    const res = await fetch(`${API_BASE}/media/download-zip/${slugOrEventId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(err.error || 'Failed to initiate bulk download');
    }
    const data = await res.json();
    return data.data;
  },

  // Storage & Cloudflare
  async getStorageOverview() {
    return request('/storage/overview');
  },

  // Guest Endpoints
  async getGuestEvent(slug) {
    return request(`/guest/event/${slug}`);
  },

  async verifyGuestPin(slug, pin) {
    return request(`/guest/verify-pin/${slug}`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  async getGuestGallery(slug, folderIdOrOptions = null, maybeToken = null) {
    const headers = {};
    let folderId = null;
    let page = null;
    let limit = null;
    let cursor = null;
    let guestToken = null;

    if (folderIdOrOptions && typeof folderIdOrOptions === 'object') {
      folderId = folderIdOrOptions.folderId ?? null;
      page = folderIdOrOptions.page ?? null;
      limit = folderIdOrOptions.limit ?? null;
      cursor = folderIdOrOptions.cursor ?? null;
      guestToken = folderIdOrOptions.guestToken ?? maybeToken ?? null;
    } else {
      folderId = folderIdOrOptions;
      guestToken = maybeToken;
    }

    if (guestToken) {
      headers['x-guest-token'] = guestToken;
    }

    const params = new URLSearchParams();
    if (folderId) params.append('folderId', folderId);
    if (page) params.append('page', String(page));
    if (limit !== null && limit !== undefined) params.append('limit', String(limit));
    if (cursor) params.append('cursor', cursor);

    const queryStr = params.toString() ? `?${params.toString()}` : '';
    return request(`/guest/gallery/${slug}${queryStr}`, { headers });
  },

  async searchGuestFace(slug, selfieBlob, guestToken = null) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(selfieBlob);
    });

    const headers = {
      'Content-Type': 'application/json',
    };
    if (guestToken) {
      headers['x-guest-token'] = guestToken;
    }

    const res = await fetch(`${API_BASE}/guest/face-search/${slug}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: base64 }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        body?.error?.message ||
        body?.error ||
        body?.message ||
        (body?.detail ? (typeof body.detail === 'object' ? body.detail.message : body.detail) : null) ||
        'Face search failed';
      throw new Error(msg);
    }
    return body;
  },

  // Phase 46: Client Photo Selection, Proofing & Favorites
  getOrCreateGuestSessionId(slug) {
    const key = `guest_selection_session_${slug}`;
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'sess_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem(key, id);
    }
    return id;
  },

  async getGuestSelection(slug, guestToken = null) {
    const sessionId = this.getOrCreateGuestSessionId(slug);
    const headers = { 'x-guest-session-id': sessionId };
    if (guestToken) headers['x-guest-token'] = guestToken;
    return request(`/guest/selection/${slug}`, { headers });
  },

  async updateGuestSelectionItem(slug, { photoId, isFavorite, isSelected, notes, expectedVersion }, guestToken = null) {
    const sessionId = this.getOrCreateGuestSessionId(slug);
    const headers = { 'x-guest-session-id': sessionId };
    if (guestToken) headers['x-guest-token'] = guestToken;
    return request(`/guest/selection/${slug}/item`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ photoId, isFavorite, isSelected, notes, expectedVersion }),
    });
  },

  async submitGuestSelection(slug, { clientName, clientEmail, notes, expectedVersion }, guestToken = null) {
    const sessionId = this.getOrCreateGuestSessionId(slug);
    const headers = { 'x-guest-session-id': sessionId };
    if (guestToken) headers['x-guest-token'] = guestToken;
    return request(`/guest/selection/${slug}/submit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientName, clientEmail, notes, expectedVersion }),
    });
  },

  async getGuestSelectionPhotos(slug, filter = 'selected', guestToken = null) {
    const sessionId = this.getOrCreateGuestSessionId(slug);
    const headers = { 'x-guest-session-id': sessionId };
    if (guestToken) headers['x-guest-token'] = guestToken;
    return request(`/guest/selection/${slug}/photos?filter=${filter}`, { headers });
  },

  async getGuestSelectionDelivery(slug, guestToken = null) {
    const sessionId = this.getOrCreateGuestSessionId(slug);
    const headers = { 'x-guest-session-id': sessionId };
    if (guestToken) headers['x-guest-token'] = guestToken;
    return request(`/guest/selection/${slug}/delivery`, { headers });
  },

  // Phase 46: Photographer Selection Management
  async getEventSelections(eventId) {
    return request(`/events/${eventId}/selections`);
  },

  async getEventSelection(eventId, selectionId) {
    return request(`/events/${eventId}/selections/${selectionId}`);
  },

  async getEventSelectionPhotos(eventId, selectionId, filter = 'selected') {
    return request(`/events/${eventId}/selections/${selectionId}/photos?filter=${filter}`);
  },

  async approveEventSelection(eventId, selectionId) {
    return request(`/events/${eventId}/selections/${selectionId}/approve`, { method: 'POST' });
  },

  async requestEventSelectionChanges(eventId, selectionId, feedback) {
    return request(`/events/${eventId}/selections/${selectionId}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    });
  },

  async updateEventSelectionDelivery(eventId, selectionId, { deliveryStatus, deliveryLink }) {
    return request(`/events/${eventId}/selections/${selectionId}/delivery`, {
      method: 'POST',
      body: JSON.stringify({ deliveryStatus, deliveryLink }),
    });
  },

  async reconcileEventSelection(eventId, selectionId) {
    return request(`/events/${eventId}/selections/${selectionId}/reconcile`, { method: 'POST' });
  },

  // SaaS Commercial, Billing & Quota Engine
  async getBillingOverview() {
    return request('/billing/overview');
  },

  async getPlans() {
    return request('/billing/plans');
  },

  async getStorageAddons() {
    return request('/billing/addons');
  },

  async createCheckoutSession(payload) {
    return request('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async cancelSubscription(immediately = false) {
    return request('/billing/cancel', {
      method: 'POST',
      body: JSON.stringify({ immediately }),
    });
  },

  async getInvoices() {
    return request('/billing/invoices');
  },

  async reconcileStorage() {
    return request('/billing/reconcile-storage', {
      method: 'POST',
    });
  },

  // ==========================================
  // Phase 45: Admin Operations & Control Center
  // ==========================================
  async adminRequest(endpoint, options = {}) {
    const token = localStorage.getItem('lumina_admin_token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };
    const res = await fetch(`${API_BASE}/admin${endpoint}`, {
      ...options,
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Administrative request failed');
    }
    return data;
  },

  async adminLogin(credentials) {
    const data = await this.adminRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    if (data.token) {
      localStorage.setItem('lumina_admin_token', data.token);
    }
    return data;
  },

  async adminGetMe() {
    return this.adminRequest('/auth/me');
  },

  async adminLogout() {
    try {
      await this.adminRequest('/auth/logout', { method: 'POST' });
    } finally {
      localStorage.removeItem('lumina_admin_token');
    }
  },

  async adminGetTelemetry() {
    return this.adminRequest('/telemetry');
  },

  async adminGetHealth() {
    return this.adminRequest('/health');
  },

  async adminGetUsers(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.adminRequest(`/users${q ? `?${q}` : ''}`);
  },

  async adminGetUser(id) {
    return this.adminRequest(`/users/${id}`);
  },

  async adminSuspendUser(id, reason) {
    return this.adminRequest(`/users/${id}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async adminRestoreUser(id, reason) {
    return this.adminRequest(`/users/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async adminGetEvents(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.adminRequest(`/events${q ? `?${q}` : ''}`);
  },

  async adminGetEventProcessing(id) {
    return this.adminRequest(`/events/${id}/processing-status`);
  },

  async adminBreakGlass(id, reason) {
    return this.adminRequest(`/events/${id}/break-glass`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async adminGetJobs(status = 'all') {
    return this.adminRequest(`/jobs?status=${encodeURIComponent(status)}`);
  },

  async adminRetryJob(id) {
    return this.adminRequest(`/jobs/${id}/retry`, {
      method: 'POST',
    });
  },

  async adminCancelJob(id) {
    return this.adminRequest(`/jobs/${id}/cancel`, {
      method: 'POST',
    });
  },

  async adminGetStorageOverview() {
    return this.adminRequest('/storage/overview');
  },

  async adminRunStorageReconciliation() {
    return this.adminRequest('/storage/reconcile', {
      method: 'POST',
    });
  },

  async adminGetBillingOverview() {
    return this.adminRequest('/billing/overview');
  },

  async adminAdjustBilling(id, payload) {
    return this.adminRequest(`/billing/users/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminGetSupportTickets(status = 'all') {
    return this.adminRequest(`/support/tickets?status=${encodeURIComponent(status)}`);
  },

  async adminCreateSupportTicket(payload) {
    return this.adminRequest('/support/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminUpdateSupportTicket(id, payload) {
    return this.adminRequest(`/support/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async adminGetIncidents() {
    return this.adminRequest('/incidents');
  },

  async adminCreateIncident(payload) {
    return this.adminRequest('/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminUpdateIncident(id, payload) {
    return this.adminRequest(`/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async adminGetFeatures() {
    return this.adminRequest('/features');
  },

  async adminToggleFeature(payload) {
    return this.adminRequest('/features/toggle', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminGetAuditLogs(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.adminRequest(`/audit-logs${q ? `?${q}` : ''}`);
  },
};

export default api;
