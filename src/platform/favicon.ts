// The bookmarklet has no icon of its own: Chrome keeps whatever the page had
// when the bookmark was installed, which is why the entry shows a generic
// globe. Drawing the square icon and setting it as the page favicon gives the
// bookmark entry the same mark as the extension toolbar button.
//
// The icon is painted on a canvas rather than injected as an SVG data URL, so
// it renders even when the page restricts image or style sources.
const CHASSIS = '#3F8B7E';
const SCREEN = '#D4EDE3';
const INK = '#1C1008';

export const FAVICON_SIZE = 32;

export function renderFavicon(size = FAVICON_SIZE): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const u = size / 64;                       // the icon is authored on a 64 unit grid
  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // chassis
  roundRect(1.5 * u, 1.5 * u, 61 * u, 61 * u, 14 * u);
  ctx.fillStyle = CHASSIS;
  ctx.fill();
  ctx.lineWidth = 3 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // screen face
  roundRect(6.5 * u, 6.5 * u, 51 * u, 51 * u, 9 * u);
  ctx.fillStyle = SCREEN;
  ctx.fill();
  ctx.stroke();
  // eyes and smile
  ctx.lineWidth = 5.6 * u;
  ctx.beginPath();
  ctx.moveTo(24 * u, 25.5 * u); ctx.lineTo(24 * u, 28.9 * u);
  ctx.moveTo(40 * u, 25.5 * u); ctx.lineTo(40 * u, 28.9 * u);
  ctx.stroke();
  ctx.lineWidth = 4.4 * u;
  ctx.beginPath();
  ctx.moveTo(19.5 * u, 35.5 * u);
  ctx.bezierCurveTo(22.5 * u, 40.5 * u, 27.6 * u, 43.1 * u, 32 * u, 43.1 * u);
  ctx.bezierCurveTo(36.4 * u, 43.1 * u, 41.5 * u, 40.5 * u, 44.5 * u, 35.5 * u);
  ctx.stroke();

  return canvas.toDataURL('image/png');
}

/** Points the page favicon at the SourcePin icon, adding a link when absent. */
export function installFavicon(): void {
  const href = renderFavicon();
  if (!href) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/png';
  link.href = href;
}
