// Renders the SourcePin app icon to the PNG sizes Chrome needs for an
// extension. Run it after changing the icon:
//
//   node scripts/make-icons.mjs
//
// The square icon keeps the console's Lite screen: the teal chassis, the pale
// screen face and the smiling expression, so the toolbar button matches the
// console the user actually sees.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

export const ICON_SIZES = [16, 32, 48, 128];

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="SourcePin">
  <rect x="1.5" y="1.5" width="61" height="61" rx="14" fill="#3F8B7E" stroke="#1C1008" stroke-width="3"/>
  <rect x="6.5" y="6.5" width="51" height="51" rx="9" fill="#D4EDE3" stroke="#1C1008" stroke-width="3"/>
  <path d="M24 25.5v3.4M40 25.5v3.4" stroke="#1C1008" stroke-width="5.6" stroke-linecap="round"/>
  <path d="M19.5 35.5c3 5 8.1 7.6 12.5 7.6s9.5-2.6 12.5-7.6" fill="none" stroke="#1C1008" stroke-width="4.4" stroke-linecap="round"/>
</svg>
`;

export async function renderIcons(target) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
    // Screenshot the SVG document itself so each PNG keeps a transparent
    // surround instead of a white page background.
    for (const size of ICON_SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${ICON_SVG}`);
      const png = await page.locator('svg').screenshot({ omitBackground: true });
      await writeFile(`${target}/icon-${size}.png`, png);
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir('public', { recursive: true });
  await renderIcons('public');
  console.log(`Wrote ${ICON_SIZES.map(size => `public/icon-${size}.png`).join(', ')}`);
}
