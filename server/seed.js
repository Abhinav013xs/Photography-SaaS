import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import db, { initDatabase } from './db.js';
import storage from './storage/r2.js';
import { processPhoto } from './services/image_processor.js';
import { detectAndIndexPhoto } from './ai/face_service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_SEED_DIR = path.join(__dirname, '..', 'temp', 'seed');
if (!fs.existsSync(TEMP_SEED_DIR)) {
  fs.mkdirSync(TEMP_SEED_DIR, { recursive: true });
}

/**
 * Creates realistic fine-art photography SVGs and renders them as high-res JPEGs
 */
async function generateSamplePhoto(title, subtitle, colorScheme, width = 1600, height = 1200) {
  const { bg1, bg2, accent, textLight } = colorScheme;
  
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="grad" cx="50%" cy="40%" r="75%">
          <stop offset="0%" stop-color="${bg1}" />
          <stop offset="65%" stop-color="${bg2}" />
          <stop offset="100%" stop-color="#0a0a0d" />
        </radialGradient>
        <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.3" />
          <stop offset="100%" stop-color="transparent" />
        </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="${width}" height="${height}" fill="url(#grad)" />
      <rect width="${width}" height="${height}" fill="url(#glow)" />

      <!-- Minimalist fine-art frames and typography -->
      <rect x="80" y="80" width="${width - 160}" height="${height - 160}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2" />
      
      <!-- Central portrait silhouette / artistic circles -->
      <circle cx="${width / 2}" cy="${height / 2 - 40}" r="160" fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="4,8" opacity="0.6" />
      <circle cx="${width / 2}" cy="${height / 2 - 40}" r="90" fill="rgba(255,255,255,0.06)" />

      <!-- Title & Details -->
      <text x="${width / 2}" y="${height / 2 + 190}" font-family="'Cormorant Garamond', Georgia, serif" font-size="44" font-weight="500" fill="${textLight}" text-anchor="middle" letter-spacing="2">
        ${title.toUpperCase()}
      </text>

      <text x="${width / 2}" y="${height / 2 + 240}" font-family="-apple-system, sans-serif" font-size="18" font-weight="400" fill="rgba(255,255,255,0.5)" text-anchor="middle" letter-spacing="4">
        ${subtitle.toUpperCase()}
      </text>

      <text x="${width / 2}" y="${height - 120}" font-family="-apple-system, sans-serif" font-size="14" font-weight="500" fill="rgba(255,255,255,0.3)" text-anchor="middle" letter-spacing="6">
        STUDIO LUMINA • FINE ART DOCUMENTARY
      </text>
    </svg>
  `;

  const buffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 95 })
    .toBuffer();

  return buffer;
}

export async function seedDatabase() {
  initDatabase();

  const existingCount = db.prepare('SELECT COUNT(*) as c FROM events').get();
  if (existingCount.c > 0) {
    console.log('[Seed] Database already contains events. Skipping seed.');
    return;
  }

  console.log('[Seed] Seeding sample wedding, birthday, and editorial events...');

  // 1. EVENT: Rahul & Priya Wedding
  const event1Id = uuidv4();
  const event1Slug = 'rahul-priya-wedding';
  const now = new Date();
  const publicUntil = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO events (
      id, slug, name, client_name, client_email, event_date, location, description,
      status, visibility, public_start, public_until, pin_enabled, pin_hash,
      allow_downloads, watermark_enabled, watermark_text, face_search_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'public', ?, ?, 0, NULL, 1, 1, 'Studio Lumina', 1)
  `).run(
    event1Id,
    event1Slug,
    'Rahul & Priya Wedding',
    'Rahul & Priya Sharma',
    'rahul.priya@gmail.com',
    '2026-10-15',
    'The Leela Palace, Udaipur',
    'A three-day royal wedding celebration in the city of lakes.',
    now.toISOString(),
    publicUntil
  );

  // Folders
  const foldersData = [
    { id: uuidv4(), name: 'Haldi Ceremony', sort: 1 },
    { id: uuidv4(), name: 'Mehndi Evening', sort: 2 },
    { id: uuidv4(), name: 'Wedding Rituals', sort: 3 },
    { id: uuidv4(), name: 'Reception Gala', sort: 4 },
  ];

  for (const f of foldersData) {
    db.prepare('INSERT INTO folders (id, event_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
      f.id, event1Id, f.name, f.sort
    );
  }

  // Create sample photos for each folder
  const samplePalettes = [
    { bg1: '#3d2616', bg2: '#1b120c', accent: '#c5a059', textLight: '#f3e8d2' },
    { bg1: '#2c1e28', bg2: '#150f15', accent: '#e29578', textLight: '#fae1dd' },
    { bg1: '#1b2a32', bg2: '#0e171c', accent: '#83c5be', textLight: '#edf6f9' },
    { bg1: '#28241d', bg2: '#14120e', accent: '#ddb892', textLight: '#fff1e6' },
  ];

  let coverPhotoId = null;

  for (let i = 0; i < foldersData.length; i++) {
    const folder = foldersData[i];
    const palette = samplePalettes[i % samplePalettes.length];

    for (let j = 1; j <= 3; j++) {
      const mediaId = uuidv4();
      const photoTitle = `${folder.name} — Frame ${j.toString().padStart(2, '0')}`;
      const filename = `photo_${folder.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${j}.jpg`;
      const tempPath = path.join(TEMP_SEED_DIR, filename);

      const buffer = await generateSamplePhoto(photoTitle, 'Udaipur Heritage', palette);
      await fs.promises.writeFile(tempPath, buffer);

      // Process photo derivatives
      const derivatives = await processPhoto(tempPath, event1Id, filename, {
        enabled: true,
        text: 'Studio Lumina',
      });

      db.prepare(`
        INSERT INTO media (
          id, event_id, folder_id, type, filename, original_name,
          mime_type, file_size, width, height, storage_key_original,
          storage_key_preview, storage_key_thumbnail, camera_make, camera_model,
          date_taken, status, faces_detected
        ) VALUES (?, ?, ?, 'photo', ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?, 'Sony', 'Alpha 1', '2026-10-15', 'ready', 1)
      `).run(
        mediaId,
        event1Id,
        folder.id,
        filename,
        `${photoTitle}.jpg`,
        buffer.length,
        derivatives.width,
        derivatives.height,
        derivatives.storageKeyOriginal,
        derivatives.storageKeyPreview,
        derivatives.storageKeyThumbnail
      );

      // Simulate an embedding so AI search works right away
      // 128 normalized float embedding
      const fakeEmbedding = Array.from({ length: 128 }, () => Math.random() * 0.1);
      db.prepare(`
        INSERT INTO face_embeddings (
          id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding
        ) VALUES (?, ?, ?, 0, 450, 300, 300, 300, 0.98, ?)
      `).run(
        uuidv4(),
        event1Id,
        mediaId,
        JSON.stringify(fakeEmbedding)
      );

      if (!coverPhotoId) {
        coverPhotoId = mediaId;
      }
    }
  }

  // Update cover
  if (coverPhotoId) {
    db.prepare('UPDATE events SET cover_photo_id = ? WHERE id = ?').run(coverPhotoId, event1Id);
  }

  // 2. EVENT: Arjun 30th Birthday (PIN Protected)
  const bcryptPkg = await import('bcryptjs');
  const salt = bcryptPkg.default.genSaltSync(10);
  const pinHash = bcryptPkg.default.hashSync('2026', salt);

  const event2Id = uuidv4();
  db.prepare(`
    INSERT INTO events (
      id, slug, name, client_name, client_email, event_date, location, description,
      status, visibility, public_start, public_until, pin_enabled, pin_hash,
      allow_downloads, watermark_enabled, watermark_text, face_search_enabled
    ) VALUES (?, 'arjun-30th-birthday', 'Arjun 30th Birthday', 'Arjun Mehta', 'arjun@mehta.co', '2026-09-28', 'Rooftop Lounge, Mumbai', 'Intimate 30th birthday dinner and celebration.', 'active', 'public', ?, ?, 1, ?, 1, 0, 'Studio Lumina', 1)
  `).run(
    event2Id,
    now.toISOString(),
    publicUntil,
    pinHash
  );

  console.log('[Seed] Seeding completed successfully!');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase().then(() => process.exit(0));
}
