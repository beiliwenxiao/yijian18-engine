// 临时：合成 walk_down 四相位预览图（验证全身骨骼摆动与部件衔接）
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { evaluateSkeletonPose } from '../src/animation/SkeletonPose.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const doc = JSON.parse(readFileSync('example/sanguo_zhangjiao/assets/skeletons/player.json', 'utf8'));
const asset = parseSkeletonAsset(doc);
const clip = asset.clips.get('walk_down');

const imgCache = new Map();
function loadImage(f) {
  if (imgCache.has(f)) return imgCache.get(f);
  const b = readFileSync(f);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let pos = 8; const idat = [];
  while (pos < b.length) { const len = b.readUInt32BE(pos), t = b.toString('ascii', pos + 4, pos + 8); if (t === 'IDAT') idat.push(b.slice(pos + 8, pos + 8 + len)); pos += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4); const stride = w * 4 + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = y * stride + 1 + x * 4, d = (y * w + x) * 4; px[d] = raw[s]; px[d + 1] = raw[s + 1]; px[d + 2] = raw[s + 2]; px[d + 3] = raw[s + 3]; }
  const r = { w, h, px }; imgCache.set(f, r); return r;
}

const CW = 4 * 72, CH = 76;
const canvas = Buffer.alloc(CW * CH * 4);
function stampPart(img, cx, cy, rad, flip) {
  const cos = Math.cos(-rad), sin = Math.sin(-rad);
  const x0 = Math.round(cx - 46), x1 = Math.round(cx + 46), y0 = Math.round(cy - 46), y1 = Math.round(cy + 46);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - cx, dy = y - cy;
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    const sx0 = flip ? -lx : lx;
    const sxi = Math.round(sx0 + 32), syi = Math.round(ly + 32);
    if (sxi < 0 || syi < 0 || sxi >= img.w || syi >= img.h) continue;
    const s = (syi * img.w + sxi) * 4;
    if (img.px[s + 3] < 8) continue;
    if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
    const d = (y * CW + x) * 4;
    canvas[d] = img.px[s]; canvas[d + 1] = img.px[s + 1]; canvas[d + 2] = img.px[s + 2]; canvas[d + 3] = 255;
  }
}

const P = 'example/sanguo_zhangjiao/assets/images/player/parts/';
const frames = [0, 155, 310, 465];
frames.forEach((t, fi) => {
  const { world } = evaluateSkeletonPose(asset, clip, t);
  const ox = fi * 72 + 36, oy = 72;
  for (const slot of asset.slots) {
    const att = slot.attachment;
    if (!att || att.type === 'empty' || att.visible === false) continue;
    const bw = world.get(slot.bone);
    if (!bw) continue;
    const img = loadImage(P + att.assetId.replace('player.parts.', '') + '.png');
    const rad = bw.rad + (att.rot || 0) * Math.PI / 180;
    stampPart(img, ox + bw.x + att.x, oy + bw.y + att.y, rad, !!att.flipX);
  }
});

const S = 5, W2 = CW * S, H2 = CH * S;
const big = Buffer.alloc(W2 * H2 * 4);
for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const s = ((Math.floor(y / S)) * CW + Math.floor(x / S)) * 4, d = (y * W2 + x) * 4; big[d] = canvas[s]; big[d + 1] = canvas[s + 1]; big[d + 2] = canvas[s + 2]; big[d + 3] = canvas[s + 3]; }

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xFF] ^ (c >>> 8)) >>> 0; return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body)); return Buffer.concat([l, body, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W2, 0); ih.writeUInt32BE(H2, 4); ih[8] = 8; ih[9] = 6;
const raw = Buffer.alloc(H2 * (W2 * 4 + 1));
for (let y = 0; y < H2; y++) { raw[y * (W2 * 4 + 1)] = 0; big.copy(raw, y * (W2 * 4 + 1) + 1, y * W2 * 4, (y + 1) * W2 * 4); }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
mkdirSync('Temp', { recursive: true });
writeFileSync('Temp/walk-phases.png', png);
console.log('walk phase preview written');
