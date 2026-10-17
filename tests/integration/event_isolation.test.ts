import { describe, it, expect, beforeEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';

describe('Event Boundary & Cross-Event Isolation Tests', () => {
  let db: IMemoryDb;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';

  const folderA = 'c0000000-0000-0000-0000-000000000001';
  const folderB = 'd0000000-0000-0000-0000-000000000002';

  const mediaA1 = '10000000-0000-0000-0000-0000000000a1';
  const mediaA2 = '10000000-0000-0000-0000-0000000000a2';
  const mediaB1 = '20000000-0000-0000-0000-0000000000b1';

  const faceA1 = '30000000-0000-0000-0000-0000000000a1';
  const faceB1 = '40000000-0000-0000-0000-0000000000b1';

  beforeEach(() => {
    db = createTestDatabase();
    insertTestPhotographer(db);

    // Create Event A (e.g., Royal Wedding)
    insertTestEvent(db, { id: eventA, slug: 'royal-wedding-event-a', name: 'Event A' });
    // Create Event B (e.g., Corporate Summit)
    insertTestEvent(db, { id: eventB, slug: 'corporate-summit-event-b', name: 'Event B' });

    // Insert Folders
    insertTestFolder(db, { id: folderA, event_id: eventA, name: 'Ceremony' });
    insertTestFolder(db, { id: folderB, event_id: eventB, name: 'Keynote' });

    // Insert Media
    insertTestMedia(db, { id: mediaA1, event_id: eventA, folder_id: folderA, filename: 'photo_a1.jpg' });
    insertTestMedia(db, { id: mediaA2, event_id: eventA, folder_id: null, filename: 'photo_a2.jpg' });
    insertTestMedia(db, { id: mediaB1, event_id: eventB, folder_id: folderB, filename: 'photo_b1.jpg' });

    // Insert Face Embeddings
    insertTestFaceEmbedding(db, { id: faceA1, event_id: eventA, photo_id: mediaA1 });
    insertTestFaceEmbedding(db, { id: faceB1, event_id: eventB, photo_id: mediaB1 });
  });

  it('MEDIA ISOLATION: Event A media queries must strictly return 0 items from Event B', () => {
    const resultsA = db.public.many(
      `SELECT id, event_id, filename FROM media WHERE event_id = '${eventA}' ORDER BY filename ASC;`
    );

    expect(resultsA.length).toBe(2);
    expect(resultsA.map((r: any) => r.id)).toEqual([mediaA1, mediaA2]);
    expect(resultsA.every((r: any) => r.event_id === eventA)).toBe(true);

    const resultsB = db.public.many(
      `SELECT id, event_id, filename FROM media WHERE event_id = '${eventB}';`
    );

    expect(resultsB.length).toBe(1);
    expect(resultsB[0].id).toBe(mediaB1);
    expect(resultsB[0].event_id).toBe(eventB);
  });

  it('FOLDER ISOLATION: Folder queries for Event A must exclude all folders from Event B', () => {
    const foldersForA = db.public.many(
      `SELECT id, event_id, name FROM folders WHERE event_id = '${eventA}';`
    );

    expect(foldersForA.length).toBe(1);
    expect(foldersForA[0].id).toBe(folderA);
    expect(foldersForA[0].event_id).toBe(eventA);

    const foldersForB = db.public.many(
      `SELECT id, event_id, name FROM folders WHERE event_id = '${eventB}';`
    );

    expect(foldersForB.length).toBe(1);
    expect(foldersForB[0].id).toBe(folderB);
    expect(foldersForB[0].event_id).toBe(eventB);
  });

  it('VECTOR ISOLATION: Event-scoped biometric queries must never leak embeddings across events', () => {
    // Biometric face search in Event A
    const facesForA = db.public.many(
      `SELECT fe.id, fe.event_id, fe.photo_id 
       FROM face_embeddings fe 
       WHERE fe.event_id = '${eventA}';`
    );

    expect(facesForA.length).toBe(1);
    expect(facesForA[0].id).toBe(faceA1);
    expect(facesForA[0].photo_id).toBe(mediaA1);
    expect(facesForA[0].event_id).toBe(eventA);

    // Biometric face search in Event B
    const facesForB = db.public.many(
      `SELECT fe.id, fe.event_id, fe.photo_id 
       FROM face_embeddings fe 
       WHERE fe.event_id = '${eventB}';`
    );

    expect(facesForB.length).toBe(1);
    expect(facesForB[0].id).toBe(faceB1);
    expect(facesForB[0].photo_id).toBe(mediaB1);
    expect(facesForB[0].event_id).toBe(eventB);
  });

  it('GUEST SESSION ISOLATION: Guest session authorization tokens are strictly bound to event_id', () => {
    const sessionTokenA = 'hash_for_guest_token_a_1234567890abcdef1234567890abcdef12345678';
    const expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString();

    db.public.none(
      `INSERT INTO guest_sessions (id, event_id, token_hash, expires_at)
       VALUES ('50000000-0000-0000-0000-000000000001', '${eventA}', '${sessionTokenA}', '${expiresAt}');`
    );

    // Verify session validates for Event A
    const validCheck = db.public.many(
      `SELECT id FROM guest_sessions WHERE token_hash = '${sessionTokenA}' AND event_id = '${eventA}';`
    );
    expect(validCheck.length).toBe(1);

    // Verify token CANNOT be used to access Event B
    const invalidCheck = db.public.many(
      `SELECT id FROM guest_sessions WHERE token_hash = '${sessionTokenA}' AND event_id = '${eventB}';`
    );
    expect(invalidCheck.length).toBe(0);
  });

  it('DELETION ISOLATION: Deleting Event A has ZERO side effects on Event B data', () => {
    // Delete Event A
    db.public.none(`DELETE FROM events WHERE id = '${eventA}';`);

    // Verify Event A data is completely gone
    expect(db.public.many(`SELECT id FROM events WHERE id = '${eventA}';`).length).toBe(0);
    expect(db.public.many(`SELECT id FROM media WHERE event_id = '${eventA}';`).length).toBe(0);
    expect(db.public.many(`SELECT id FROM folders WHERE event_id = '${eventA}';`).length).toBe(0);
    expect(db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventA}';`).length).toBe(0);

    // Verify Event B data is 100% intact
    expect(db.public.many(`SELECT id FROM events WHERE id = '${eventB}';`).length).toBe(1);
    expect(db.public.many(`SELECT id FROM media WHERE event_id = '${eventB}';`).length).toBe(1);
    expect(db.public.many(`SELECT id FROM folders WHERE event_id = '${eventB}';`).length).toBe(1);
    expect(db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventB}';`).length).toBe(1);
  });
});
