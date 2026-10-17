import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_SCRIPT = path.join(__dirname, 'face_engine.py');

const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Execute python face engine with arguments
 */
function runFaceEngine(args) {
  return new Promise((resolve, reject) => {
    const py = spawn('python', [ENGINE_SCRIPT, ...args]);
    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    py.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Face engine exited with code ${code}: ${stderr}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse face engine response: ${stdout} (${err.message})`));
      }
    });

    py.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Detect faces in a photo and store embeddings in the database
 */
export async function detectAndIndexPhoto(mediaId, filePath) {
  const media = db.prepare('SELECT id, event_id FROM media WHERE id = ?').get(mediaId);
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  const result = await runFaceEngine(['detect', filePath]);

  if (!result.success && result.error) {
    console.error(`[AI Face Indexing Error] ${mediaId}:`, result.error);
    return { count: 0, faces: [] };
  }

  const faces = result.faces || [];

  // Remove existing embeddings for this photo if any (e.g. re-indexing)
  db.prepare('DELETE FROM face_embeddings WHERE photo_id = ?').run(mediaId);

  const insertStmt = db.prepare(`
    INSERT INTO face_embeddings (
      id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((faceList) => {
    for (const f of faceList) {
      insertStmt.run(
        uuidv4(),
        media.event_id,
        media.id,
        f.face_index,
        f.box.x,
        f.box.y,
        f.box.w,
        f.box.h,
        f.confidence,
        JSON.stringify(f.embedding)
      );
    }
  });

  if (faces.length > 0) {
    insertMany(faces);
  }

  // Update media with faces detected
  db.prepare('UPDATE media SET faces_detected = ? WHERE id = ?').run(faces.length, mediaId);

  return {
    count: faces.length,
    faces
  };
}

/**
 * Find matching photos for a guest selfie, strictly isolated to eventId with Zero-Disk In-Memory Vector Search
 */
export async function searchBySelfie(eventId, selfieBuffer) {
  // Ephemeral scratch selfie path (destroyed immediately in finally)
  const tempId = uuidv4();
  const selfiePath = path.join(TEMP_DIR, `selfie_${tempId}.jpg`);

  try {
    // Write selfie to temporary scratch file
    await fs.promises.writeFile(selfiePath, selfieBuffer);

    // 1. Detect faces in guest selfie via single Python YuNet/SFace invocation
    const detectionCheck = await runFaceEngine(['detect', selfiePath]);
    if (!detectionCheck || !detectionCheck.faces || detectionCheck.faces.length === 0) {
      return {
        success: false,
        error: 'No face detected in the provided selfie. Please take a clear, well-lit photo of your face.',
        matches: [],
      };
    }

    // Sort selfie faces to pick the primary/largest face
    const sortedSelfieFaces = [...detectionCheck.faces].sort(
      (a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h)
    );
    const primaryFace = sortedSelfieFaces[0];
    const selfieEmbedding = new Float32Array(primaryFace.embedding);

    // L2-normalize the selfie embedding
    let selfieNormSq = 0;
    for (let i = 0; i < selfieEmbedding.length; i++) {
      selfieNormSq += selfieEmbedding[i] * selfieEmbedding[i];
    }
    const selfieNorm = Math.sqrt(selfieNormSq);
    if (selfieNorm > 0) {
      for (let i = 0; i < selfieEmbedding.length; i++) {
        selfieEmbedding[i] /= selfieNorm;
      }
    }

    // 2. Query all indexed face embeddings strictly for THIS event (Event Isolation)
    const rows = db.prepare(`
      SELECT photo_id, face_index, box_x, box_y, box_w, box_h, embedding
      FROM face_embeddings
      WHERE event_id = ?
    `).all(eventId);

    if (rows.length === 0) {
      return {
        success: true,
        selfieFacesDetected: detectionCheck.faces.length,
        matchedCount: 0,
        matches: [],
        photos: [],
        message: 'No indexed faces currently in this event.',
      };
    }

    // 3. High-Speed In-Memory Vector Distance Calculation (Zero-Disk I/O)
    // SFace typical match threshold is cosine similarity >= 0.60
    const THRESHOLD = 0.60;
    const matchesMap = new Map();

    for (const row of rows) {
      let candEmb;
      try {
        candEmb = JSON.parse(row.embedding);
      } catch (_e) {
        continue;
      }

      let dot = 0;
      let candNormSq = 0;
      for (let i = 0; i < 128; i++) {
        const val = candEmb[i] || 0;
        dot += selfieEmbedding[i] * val;
        candNormSq += val * val;
      }

      const candNorm = Math.sqrt(candNormSq);
      const cosSim = candNorm > 0 ? dot / candNorm : 0;

      if (cosSim >= THRESHOLD) {
        const existing = matchesMap.get(row.photo_id);
        if (!existing || cosSim > existing.similarity) {
          matchesMap.set(row.photo_id, {
            photo_id: row.photo_id,
            similarity: Math.round(cosSim * 10000) / 10000,
            face_index: row.face_index,
            box: { x: row.box_x, y: row.box_y, w: row.box_w, h: row.box_h },
          });
        }
      }
    }

    const matchedPhotoIds = Array.from(matchesMap.keys());
    if (matchedPhotoIds.length === 0) {
      return {
        success: true,
        selfieFacesDetected: detectionCheck.faces.length,
        matchedCount: 0,
        matches: [],
        photos: [],
      };
    }

    // 4. Fetch media records for matched photo IDs (scoped strictly to eventId)
    const placeholders = matchedPhotoIds.map(() => '?').join(',');
    const photos = db.prepare(`
      SELECT m.*, f.name as folder_name
      FROM media m
      LEFT JOIN folders f ON m.folder_id = f.id
      WHERE m.id IN (${placeholders}) AND m.event_id = ?
    `).all(...matchedPhotoIds, eventId);

    const enrichedPhotos = photos
      .map((photo) => {
        const meta = matchesMap.get(photo.id) || {};
        return {
          ...photo,
          similarity: meta.similarity || 0,
          matchBox: meta.box || null,
        };
      })
      .sort((a, b) => b.similarity - a.similarity);

    return {
      success: true,
      selfieFacesDetected: detectionCheck.faces.length,
      matchedCount: enrichedPhotos.length,
      photos: enrichedPhotos,
    };

  } finally {
    // REQUIREMENT 20 & RULE 4.4: Immediate destruction of ephemeral guest selfie
    try {
      if (fs.existsSync(selfiePath)) {
        await fs.promises.unlink(selfiePath);
      }
    } catch (cleanupErr) {
      console.error('[Privacy Cleanup Error] Failed to delete temp selfie:', cleanupErr);
    }
  }
}
