import sharp from 'sharp';
import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const iosIconDir = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
const androidResDir = join(root, 'android/app/src/main/res');

const androidSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const androidForegroundSizes = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

async function svgToPng(svgPath, size) {
  const svgContent = readFileSync(svgPath, 'utf8');

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });

  const html = `
    <!DOCTYPE html>
    <html>
    <head><style>body{margin:0;padding:0;overflow:hidden;}</style></head>
    <body>${svgContent}</body>
    </html>
  `;
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Wait for font to load
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 500));

  const screenshot = await page.screenshot({ type: 'png', omitBackground: false });
  await browser.close();
  return screenshot;
}

async function generateIcons() {
  console.log('Rendering icon.svg to PNG via headless browser...\n');

  const svgPath = join(root, 'public/icon.svg');

  // Render at 1024x1024 for maximum quality
  const masterPng = await svgToPng(svgPath, 1024);
  console.log('✓ Rendered master icon (1024x1024)\n');

  // --- iOS ---
  console.log('iOS:');
  await sharp(masterPng)
    .resize(1024, 1024)
    .png()
    .toFile(join(iosIconDir, 'AppIcon-512@2x.png'));
  console.log('  ✓ AppIcon-512@2x.png (1024x1024)');

  // --- Android launcher icons ---
  console.log('\nAndroid:');
  for (const [folder, size] of Object.entries(androidSizes)) {
    const dir = join(androidResDir, folder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Standard launcher icon
    await sharp(masterPng)
      .resize(size, size)
      .png()
      .toFile(join(dir, 'ic_launcher.png'));
    console.log(`  ✓ ${folder}/ic_launcher.png (${size}x${size})`);

    // Round launcher icon
    const roundMask = Buffer.from(
      `<svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
      </svg>`
    );
    const iconBuf = await sharp(masterPng)
      .resize(size, size)
      .png()
      .toBuffer();
    await sharp(iconBuf)
      .composite([{ input: roundMask, blend: 'dest-in' }])
      .png()
      .toFile(join(dir, 'ic_launcher_round.png'));
    console.log(`  ✓ ${folder}/ic_launcher_round.png (${size}x${size})`);
  }

  // --- Android adaptive icon foreground ---
  console.log('\nAndroid foreground:');
  for (const [folder, size] of Object.entries(androidForegroundSizes)) {
    const dir = join(androidResDir, folder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const iconSize = Math.round(size * 0.66);
    const padding = Math.round((size - iconSize) / 2);

    const iconBuf = await sharp(masterPng)
      .resize(iconSize, iconSize)
      .png()
      .toBuffer();

    // Create background canvas with app background color
    const canvas = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: '#111827',
      }
    }).png().toBuffer();

    await sharp(canvas)
      .composite([{ input: iconBuf, left: padding, top: padding }])
      .png()
      .toFile(join(dir, 'ic_launcher_foreground.png'));
    console.log(`  ✓ ${folder}/ic_launcher_foreground.png (${size}x${size})`);
  }

  console.log('\nDone! All icons generated.');
}

generateIcons().catch(console.error);
