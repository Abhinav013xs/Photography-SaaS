import crypto from 'crypto';
import db from '../db.js';

/**
 * Service: Selection & Proofing Workflow Engine
 * Enforces server-side package quotas, favorites separation, event isolation,
 * optimistic concurrency control, and revision tracking.
 */
export const SelectionService = {
  /**
   * Retrieves or initializes an active selection collection for a guest session within an event.
   */
  getOrInitSelection(eventId, sessionId) {
    const event = db.prepare(`
      SELECT 
        id, client_selection_mode, selection_package_name, selection_package_quota,
        selection_min_quota, selection_allow_extra, selection_deadline,
        selection_instructions, selection_allow_changes_after_submission,
        selection_requires_approval, selection_multiple_rounds, status
      FROM events 
      WHERE id = ?
    `).get(eventId);

    if (!event) {
      throw new Error('Event not found');
    }

    let collection = db.prepare(`
      SELECT * FROM selection_collections 
      WHERE event_id = ? AND session_id = ?
    `).get(eventId, sessionId);

    if (!collection) {
      const id = crypto.randomUUID();
      const packageName = event.selection_package_name || 'Full Collection';
      const quota = event.selection_package_quota || 0;
      const minQuota = event.selection_min_quota || 0;
      const allowExtra = event.selection_allow_extra ? 1 : 0;
      const deadline = event.selection_deadline || null;

      db.prepare(`
        INSERT INTO selection_collections (
          id, event_id, session_id, status, package_name, quota, min_quota,
          allow_extra, deadline, selected_count, favorites_count, version
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, 0, 1)
      `).run(id, eventId, sessionId, packageName, quota, minQuota, allowExtra, deadline);

      collection = db.prepare(`SELECT * FROM selection_collections WHERE id = ?`).get(id);
    }

    // Retrieve active selection items dictionary
    const items = db.prepare(`
      SELECT photo_id, is_favorite, is_selected, notes, updated_at
      FROM selection_items
      WHERE selection_id = ?
    `).all(collection.id);

    const itemsMap = {};
    for (const item of items) {
      itemsMap[item.photo_id] = {
        isFavorite: Boolean(item.is_favorite),
        isSelected: Boolean(item.is_selected),
        notes: item.notes || '',
        updatedAt: item.updated_at,
      };
    }

    // Retrieve past revisions
    const revisions = db.prepare(`
      SELECT id, version, selected_count, notes, submitted_at
      FROM selection_revisions
      WHERE selection_id = ?
      ORDER BY version DESC
    `).all(collection.id);

    return {
      collection,
      eventConfig: {
        mode: event.client_selection_mode || 'disabled',
        packageName: event.selection_package_name || 'Full Collection',
        quota: event.selection_package_quota || 0,
        minQuota: event.selection_min_quota || 0,
        allowExtra: Boolean(event.selection_allow_extra),
        deadline: event.selection_deadline,
        instructions: event.selection_instructions || '',
        allowChangesAfterSubmission: Boolean(event.selection_allow_changes_after_submission),
        requiresApproval: Boolean(event.selection_requires_approval),
      },
      items: itemsMap,
      revisions,
    };
  },

  /**
   * Toggles favorite or package selection flag on a photo item.
   * Atomically enforces quota, deadline, locking, and concurrency checks.
   */
  updateItem(eventId, sessionId, { photoId, isFavorite, isSelected, notes, expectedVersion }) {
    if (!photoId) {
      const err = new Error('photoId is required');
      err.status = 400;
      throw err;
    }

    // Validate photo belongs to current event
    const photo = db.prepare('SELECT id, event_id FROM media WHERE id = ? AND event_id = ?').get(photoId, eventId);
    if (!photo) {
      const err = new Error('Photo does not exist in this event');
      err.status = 404;
      throw err;
    }

    // Load or initialize selection
    const { collection, eventConfig } = this.getOrInitSelection(eventId, sessionId);

    // Optimistic concurrency check if expectedVersion provided
    if (expectedVersion !== undefined && expectedVersion !== null && collection.version !== expectedVersion) {
      const err = new Error('Selection has been updated in another session. Please refresh.');
      err.status = 409;
      err.code = 'VERSION_CONFLICT';
      throw err;
    }

    // Check status locks
    if (collection.status === 'locked' || collection.status === 'completed') {
      const err = new Error('This selection is locked and cannot be modified.');
      err.status = 403;
      err.code = 'SELECTION_LOCKED';
      throw err;
    }

    if (collection.status === 'approved' && !eventConfig.allowChangesAfterSubmission) {
      const err = new Error('This selection has already been approved and finalized.');
      err.status = 403;
      err.code = 'SELECTION_APPROVED';
      throw err;
    }

    if (collection.status === 'submitted' && !eventConfig.allowChangesAfterSubmission) {
      const err = new Error('This selection has already been submitted for review.');
      err.status = 403;
      err.code = 'SELECTION_SUBMITTED';
      throw err;
    }

    // Check deadline
    if (collection.deadline && new Date(collection.deadline) < new Date() && !eventConfig.allowChangesAfterSubmission) {
      const err = new Error('The selection deadline for this event has passed.');
      err.status = 403;
      err.code = 'DEADLINE_EXPIRED';
      throw err;
    }

    // Inspect current state of this item
    const currentItem = db.prepare(`
      SELECT is_favorite, is_selected, notes FROM selection_items
      WHERE selection_id = ? AND photo_id = ?
    `).get(collection.id, photoId);

    const currentlySelected = Boolean(currentItem?.is_selected);
    const targetSelected = isSelected !== undefined ? Boolean(isSelected) : currentlySelected;

    // Server-Side Quota Enforcement:
    // If transitioning from unselected -> selected
    if (!currentlySelected && targetSelected) {
      if (collection.quota > 0 && !collection.allow_extra) {
        if (collection.selected_count >= collection.quota) {
          const err = new Error(`Your package allows ${collection.quota} selected photos. Limit reached.`);
          err.status = 400;
          err.code = 'PACKAGE_QUOTA_REACHED';
          err.quota = collection.quota;
          err.selectedCount = collection.selected_count;
          throw err;
        }
      }
    }

    const targetFavorite = isFavorite !== undefined ? Boolean(isFavorite) : Boolean(currentItem?.is_favorite);
    const targetNotes = notes !== undefined ? notes : (currentItem?.notes || '');

    // Transactional Update
    const runTransaction = db.transaction(() => {
      // If both flags are false and notes empty, remove item to keep table clean
      if (!targetFavorite && !targetSelected && !targetNotes) {
        db.prepare(`
          DELETE FROM selection_items WHERE selection_id = ? AND photo_id = ?
        `).run(collection.id, photoId);
      } else {
        const itemId = currentItem?.id || crypto.randomUUID();
        db.prepare(`
          INSERT INTO selection_items (
            id, selection_id, photo_id, is_favorite, is_selected, notes, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(selection_id, photo_id) DO UPDATE SET
            is_favorite = excluded.is_favorite,
            is_selected = excluded.is_selected,
            notes = excluded.notes,
            updated_at = CURRENT_TIMESTAMP
        `).run(itemId, collection.id, photoId, targetFavorite ? 1 : 0, targetSelected ? 1 : 0, targetNotes);
      }

      // Recount items
      const counts = db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN is_selected = 1 THEN 1 ELSE 0 END), 0) as sel_count,
          COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) as fav_count
        FROM selection_items
        WHERE selection_id = ?
      `).get(collection.id);

      db.prepare(`
        UPDATE selection_collections
        SET selected_count = ?, favorites_count = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(counts.sel_count, counts.fav_count, collection.id);

      return counts;
    });

    const newCounts = runTransaction();

    return {
      success: true,
      photoId,
      isFavorite: targetFavorite,
      isSelected: targetSelected,
      notes: targetNotes,
      selectedCount: newCounts.sel_count,
      favoritesCount: newCounts.fav_count,
      quota: collection.quota,
      quotaReached: collection.quota > 0 && newCounts.sel_count >= collection.quota,
    };
  },

  /**
   * Submits selection for photographer review.
   * Records a snapshot in selection_revisions and increments version.
   */
  submitSelection(eventId, sessionId, { clientName, clientEmail, notes, expectedVersion }) {
    const { collection, eventConfig } = this.getOrInitSelection(eventId, sessionId);

    // Optimistic concurrency check
    if (expectedVersion !== undefined && expectedVersion !== null && collection.version !== expectedVersion) {
      const err = new Error('Selection was modified elsewhere. Please refresh before submitting.');
      err.status = 409;
      err.code = 'VERSION_CONFLICT';
      throw err;
    }

    // Must have at least 1 selected photo
    if (collection.selected_count === 0) {
      const err = new Error('Please select at least 1 photo for your package before submitting.');
      err.status = 400;
      err.code = 'EMPTY_SELECTION';
      throw err;
    }

    // Check minimum quota
    if (collection.min_quota > 0 && collection.selected_count < collection.min_quota) {
      const err = new Error(
        `Your package requires a minimum of ${collection.min_quota} photos before submission. You currently have ${collection.selected_count}.`
      );
      err.status = 400;
      err.code = 'MINIMUM_QUOTA_NOT_MET';
      err.minQuota = collection.min_quota;
      err.selectedCount = collection.selected_count;
      throw err;
    }

    // Check deadline
    if (collection.deadline && new Date(collection.deadline) < new Date() && !eventConfig.allowChangesAfterSubmission) {
      const err = new Error('The selection deadline for this event has passed.');
      err.status = 403;
      err.code = 'DEADLINE_EXPIRED';
      throw err;
    }

    const selectedRows = db.prepare(`
      SELECT photo_id FROM selection_items WHERE selection_id = ? AND is_selected = 1
    `).all(collection.id);
    const photoIds = selectedRows.map((r) => r.photo_id);

    const submitTx = db.transaction(() => {
      const currentVersion = collection.version || 1;
      const revisionId = crypto.randomUUID();

      // Record snapshot revision
      db.prepare(`
        INSERT INTO selection_revisions (
          id, selection_id, version, selected_count, photo_ids, notes, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(revisionId, collection.id, currentVersion, collection.selected_count, JSON.stringify(photoIds), notes || '');

      const nextVersion = currentVersion + 1;

      db.prepare(`
        UPDATE selection_collections
        SET status = 'submitted',
            client_name = COALESCE(?, client_name),
            client_email = COALESCE(?, client_email),
            client_notes = COALESCE(?, client_notes),
            submitted_at = CURRENT_TIMESTAMP,
            version = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        clientName ? clientName.trim() : null,
        clientEmail ? clientEmail.trim() : null,
        notes ? notes.trim() : null,
        nextVersion,
        collection.id
      );

      return { nextVersion, revisionId, count: photoIds.length };
    });

    const result = submitTx();

    const updated = db.prepare(`SELECT * FROM selection_collections WHERE id = ?`).get(collection.id);

    return {
      success: true,
      selection: updated,
      version: result.nextVersion,
      revisionId: result.revisionId,
      submittedCount: result.count,
    };
  },

  /**
   * Retrieves full photo metadata for items in the selection.
   * Handles deleted photo placeholders safely (Requirement 34).
   */
  getSelectionPhotos(selectionId, filter = 'selected') {
    const isFavorites = filter === 'favorites';
    const condition = isFavorites ? 'si.is_favorite = 1' : 'si.is_selected = 1';

    const rows = db.prepare(`
      SELECT 
        si.photo_id,
        si.is_favorite,
        si.is_selected,
        si.notes as item_notes,
        si.updated_at as selected_at,
        m.id,
        m.event_id,
        m.folder_id,
        m.type,
        m.original_name,
        m.width,
        m.height,
        m.storage_key_preview,
        m.storage_key_thumbnail,
        m.camera_make,
        m.camera_model,
        m.date_taken,
        m.created_at,
        f.name as folder_name,
        CASE WHEN m.id IS NOT NULL AND m.status != 'trashed' THEN 1 ELSE 0 END as is_available
      FROM selection_items si
      LEFT JOIN media m ON m.id = si.photo_id
      LEFT JOIN folders f ON m.folder_id = f.id
      WHERE si.selection_id = ? AND ${condition}
      ORDER BY si.updated_at DESC
    `).all(selectionId);

    return rows.map((r) => ({
      id: r.id || r.photo_id,
      photoId: r.photo_id,
      isAvailable: Boolean(r.is_available),
      eventId: r.event_id,
      folderId: r.folder_id,
      folderName: r.folder_name || 'All Media',
      type: r.type || 'photo',
      originalName: r.original_name || 'Unknown Asset',
      width: r.width,
      height: r.height,
      storageKeyPreview: r.storage_key_preview,
      storageKeyThumbnail: r.storage_key_thumbnail,
      cameraMake: r.camera_make,
      cameraModel: r.camera_model,
      dateTaken: r.date_taken,
      isFavorite: Boolean(r.is_favorite),
      isSelected: Boolean(r.is_selected),
      itemNotes: r.item_notes || '',
      selectedAt: r.selected_at,
    }));
  },

  /**
   * Approves a client selection (Photographer Action).
   */
  approveSelection(eventId, selectionId) {
    const selection = db.prepare(`
      SELECT * FROM selection_collections WHERE id = ? AND event_id = ?
    `).get(selectionId, eventId);

    if (!selection) {
      const err = new Error('Selection collection not found');
      err.status = 404;
      throw err;
    }

    db.prepare(`
      UPDATE selection_collections
      SET status = 'approved',
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(selectionId);

    return db.prepare(`SELECT * FROM selection_collections WHERE id = ?`).get(selectionId);
  },

  /**
   * Requests changes on a client selection (Photographer Action).
   */
  requestChanges(eventId, selectionId, feedback) {
    const selection = db.prepare(`
      SELECT * FROM selection_collections WHERE id = ? AND event_id = ?
    `).get(selectionId, eventId);

    if (!selection) {
      const err = new Error('Selection collection not found');
      err.status = 404;
      throw err;
    }

    if (!feedback || !feedback.trim()) {
      const err = new Error('Feedback instructions are required when requesting changes.');
      err.status = 400;
      throw err;
    }

    db.prepare(`
      UPDATE selection_collections
      SET status = 'changes_requested',
          photographer_feedback = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(feedback.trim(), selectionId);

    return db.prepare(`SELECT * FROM selection_collections WHERE id = ?`).get(selectionId);
  },

  /**
   * Updates delivery status & package link (Photographer Action).
   */
  updateDelivery(eventId, selectionId, { deliveryStatus, deliveryLink }) {
    const selection = db.prepare(`
      SELECT * FROM selection_collections WHERE id = ? AND event_id = ?
    `).get(selectionId, eventId);

    if (!selection) {
      const err = new Error('Selection collection not found');
      err.status = 404;
      throw err;
    }

    const validStatuses = ['not_started', 'preparing', 'ready', 'delivered'];
    if (deliveryStatus && !validStatuses.includes(deliveryStatus)) {
      const err = new Error(`Invalid delivery status: ${deliveryStatus}`);
      err.status = 400;
      throw err;
    }

    const updates = ['updated_at = CURRENT_TIMESTAMP'];
    const params = [];

    if (deliveryStatus) {
      updates.push('delivery_status = ?');
      params.push(deliveryStatus);
      if (deliveryStatus === 'ready' || deliveryStatus === 'delivered') {
        updates.push('delivery_prepared_at = CURRENT_TIMESTAMP');
      }
    }

    if (deliveryLink !== undefined) {
      updates.push('delivery_link = ?');
      params.push(deliveryLink ? deliveryLink.trim() : null);
    }

    params.push(selectionId);

    db.prepare(`
      UPDATE selection_collections
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    return db.prepare(`SELECT * FROM selection_collections WHERE id = ?`).get(selectionId);
  },

  /**
   * Reconciles selected_count and favorites_count against physical selection_items records.
   */
  reconcileSelectionCounts(selectionId) {
    const counts = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN is_selected = 1 THEN 1 ELSE 0 END), 0) as sel_count,
        COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) as fav_count
      FROM selection_items
      WHERE selection_id = ?
    `).get(selectionId);

    const old = db.prepare(`
      SELECT selected_count, favorites_count FROM selection_collections WHERE id = ?
    `).get(selectionId);

    if (!old) return null;

    const deltaSel = counts.sel_count - (old.selected_count || 0);
    const deltaFav = counts.fav_count - (old.favorites_count || 0);

    if (deltaSel !== 0 || deltaFav !== 0) {
      db.prepare(`
        UPDATE selection_collections
        SET selected_count = ?, favorites_count = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(counts.sel_count, counts.fav_count, selectionId);
      console.warn(`[Selection Reconciliation] Reconciled selection ${selectionId}: sel ${old.selected_count} -> ${counts.sel_count}, fav ${old.favorites_count} -> ${counts.fav_count}`);
    }

    return {
      selectionId,
      selectedCount: counts.sel_count,
      favoritesCount: counts.fav_count,
      deltaSelected: deltaSel,
      deltaFavorites: deltaFav,
    };
  },
};

export default SelectionService;
