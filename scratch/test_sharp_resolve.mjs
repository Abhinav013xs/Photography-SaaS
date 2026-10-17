import sharp from 'sharp';

async function testSharpResolve() {
  const baseImage = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 4,
      background: { r: 70, g: 70, b: 80, alpha: 1 },
    },
  }).png().toBuffer();

  const { data: resizedBuffer, info } = await sharp(baseImage)
    .rotate()
    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  console.log('Resized dimensions:', info.width, 'x', info.height);

  const svg = `
    <svg width="${info.width}" height="${info.height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .wm {
          fill: #ffffff;
          fill-opacity: 0.35;
          font-family: sans-serif;
          font-size: 20px;
          font-weight: 500;
        }
      </style>
      <text x="${info.width - 20}" y="${info.height - 20}" text-anchor="end" class="wm">Studio Lumina</text>
    </svg>
  `;

  const finalOutput = await sharp(resizedBuffer)
    .composite([{ input: Buffer.from(svg) }])
    .webp({ quality: 80 })
    .toBuffer();

  console.log('Final output size bytes:', finalOutput.length);
}

testSharpResolve().catch(console.error);
