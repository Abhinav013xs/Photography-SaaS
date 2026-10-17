import sharp from 'sharp';

async function testSharpWatermark() {
  // Create a 800x600 test image
  const baseImage = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: { r: 50, g: 50, b: 60, alpha: 1 },
    },
  }).png().toBuffer();

  const watermarkText = 'Studio Lumina';
  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <style>
        .wm {
          fill: #ffffff;
          fill-opacity: 0.5;
          font-family: sans-serif;
          font-size: 32px;
          font-weight: 600;
        }
      </style>
      <text x="760" y="560" text-anchor="end" class="wm">${watermarkText}</text>
    </svg>
  `;

  const output = await sharp(baseImage)
    .composite([{ input: Buffer.from(svg) }])
    .webp()
    .toBuffer();

  console.log('Watermark composite success! Output length:', output.length);
}

testSharpWatermark().catch(console.error);
