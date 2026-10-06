// 校验 refugee-girl.png 各帧非透明像素数
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const buf = readFileSync('example/sanguo_zhangjiao/assets/images/player/refugee-girl.png');
let offset = 8;
const idat = [];
while (offset < buf.length) {
  const len = buf.readUInt32BE(offset);
  const type = buf.toString('ascii', offset + 4, offset + 8);
  if (type === 'IDAT') idat.push(buf.slice(offset + 8, offset + 8 + len));
  offset += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));
const W = 256, H = 512, stride = W * 4 + 1;
const img = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y += 1) {
  const filter = raw[y * stride];
  const line = raw.slice(y * stride + 1, (y + 1) * stride);
  for (let x = 0; x < W * 4; x += 1) {
    const left = x >= 4 ? img[y * W * 4 + x - 4] : 0;
    const up = y > 0 ? img[(y - 1) * W * 4 + x] : 0;
    const upLeft = (y > 0 && x >= 4) ? img[(y - 1) * W * 4 + x - 4] : 0;
    let v = line[x];
    if (filter === 1) v += left;
    else if (filter === 2) v += up;
    else if (filter === 3) v += Math.floor((left + up) / 2);
    else if (filter === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      v += (pa <= pb && pa <= pc) ? left : (pb <= pc) ? up : upLeft;
    }
    img[y * W * 4 + x] = v & 0xff;
  }
}
const out = [];
for (let row = 0; row < 8; row += 1) {
  for (let col = 0; col < 4; col += 1) {
    let count = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const i = ((row * 64 + y) * W + col * 64 + x) * 4;
        if (img[i + 3] > 40) count += 1;
      }
    }
    out.push(`r${row}c${col}:${count}`);
  }
}
console.log(out.join(' '));
