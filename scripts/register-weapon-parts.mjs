// 向 assets.json 登记 4 张程序化生成的武器部件图（插入在 weapon-spear 条目之后，CRLF 兼容）
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'example/sanguo_zhangjiao/assets/manifests/assets.json';
const content = readFileSync(path, 'utf8');

const names = ['weapon-skinningKnife', 'weapon-wolfFang', 'weapon-bow', 'weapon-staff'];
if (content.includes('player.parts.weapon-skinningKnife')) {
  console.log('已登记过，跳过');
  process.exit(0);
}

const anchor = '"assetId": "player.parts.weapon-spear"';
const anchorIdx = content.indexOf(anchor);
if (anchorIdx < 0) throw new Error('锚点未找到');
// 锚点之后第一个条目结束："revision": 1 + 换行 + 4空格 },（CRLF 兼容）
const tailRe = /("revision": 1\r?\n    \},)/;
const rest = content.slice(anchorIdx);
const m = rest.match(tailRe);
if (!m) throw new Error('条目结束符未找到');
const insertAt = anchorIdx + m.index + m[1].length;

const block = (name) => `    {
      "assetId": "player.parts.${name}",
      "imageId": "player.parts.${name}",
      "category": "character-part",
      "usage": [
        "player-skeleton-part"
      ],
      "sourceFile": "assets/images/player/parts/${name}.png",
      "runtime2D": {
        "path": "assets/images/player/parts/${name}.png",
        "mode": "image"
      },
      "runtime3D": {
        "mode": "billboard",
        "sourceAssetId": "player.parts.${name}"
      },
      "pivot": {
        "x": 0.5,
        "y": 0.5
      },
      "bounds": {
        "width": 64,
        "height": 64
      },
      "grid": {
        "columns": 1,
        "rows": 1,
        "cellWidth": 64,
        "cellHeight": 64
      },
      "animations": [],
      "targetPhase": "P1",
      "status": "placeholder",
      "revision": 1
    },`;

// 沿用锚点行的换行风格（\r\n 或 \n）
const eol = content.includes('\r\n') ? '\r\n' : '\n';
const insert = names.map(block).join(eol) + eol;
const next = content.slice(0, insertAt) + insert + content.slice(insertAt);
writeFileSync(path, next);
// 自验证
JSON.parse(next);
console.log('已登记', names.length, '个部件条目，JSON 校验通过');
