/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * redraw-player-parts.mjs
 * 在现有部件图基础上精绘（保留内容 bbox 与配色体系 → 绑定/挂点数据零改动）：
 *   - 每部件 = 显式像素网格（字符行），色键见 PALETTE
 *   - 自动描边：内容相邻透明像素补 outline，轮廓更干净
 *   - 覆盖：head-front / head-side / head-back / torso / skirt-front / skirt-back
 * 用法：node scripts/redraw-player-parts.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');

// ---- 调色板（取自原部件采样色 + 同族衍生） ----
const PALETTE = {
  o: '#211f26', // 描边
  // 肤色
  S: '#f0b080', s: '#d89868', d: '#b07060', L: '#f8c8a0',
  // 黄发/帽
  H: '#e0b040', h: '#b09030', Y: '#f0d060',
  // 深发
  D: '#302020', e: '#202010', l: '#4a3a32',
  // 袍
  R: '#505060', r: '#404050', E: '#343444', U: '#6a6a7c',
  // 腰带/饰
  B: '#a05030', b: '#c06840', X: '#803030', T: '#f0d090',
  // 裙（金）
  G: '#c0a050', g: '#a08040', F: '#806030', W: '#d4b868', f: '#8a7038',
  // 眼/口
  e: '#202010', w: '#f8f8f8', M: '#b07060'
};

// ---- 网格定义：每行等宽；'.' 为透明 ----
const GRIDS = {
  // 17x23 @(24,3)：黄发+侧发+脸（眼/眉/鼻/嘴/腮），下巴收窄至颈部
  'head-front.png': {
    x: 24, y: 3,
    rows: [
      '.....HHHHHHH.....',
      '...HHHHHHHHHHH...',
      '.HHYHHHHHHHHYHH..',
      '.HHHHHHHHHHHHHH..',
      '.HHhhhhhhhhhhhH..',
      '.DDHHHHHHHHHHDD..',
      '.DDDHDDDDDDHDDD..',
      '.DDSSSSSSSSSSDD..',
      '.DSSSSSSSSSSSSD..',
      '.DDSdSSSSSSSdSD..',
      '.DDSoosSSSSoosD..',
      '.DDSSSSSSSSSSSD..',
      '.DDSeeSSSSSeeSD..',
      '.DDSssSSSSSssSD..',
      '.DDSSSSssSSSSSD..',
      '.DDSSSSSSSSSSSD..',
      '.DDScSSMMMSSScD..',
      '..DSSSSSSSSSSD...',
      '..DSSssSSSSssD...',
      '...DSSSSSSSSD....',
      '....DSSSSSSD.....',
      '.....DssssD......',
      '.....DssssD......'
    ]
  },
  // 18x23 @(23,3)：侧脸——左缘面颊轮廓 + 耳，发量为主
  'head-side.png': {
    x: 23, y: 3,
    rows: [
      '....HHHHHHHHH.....',
      '..HHHHHHHHHHHHH...',
      '.HHHHHHHHHHHHHHH..',
      '.HHYHHHHHHHHHHHH..',
      '.HHHHHHHHHHHHHHH..',
      '.HHhhhhhhhhhhhhH..',
      '.DDHHHHHHHHHHHHH..',
      '.DDDDDDDDDDDDDDD..',
      '.DSSDDDDDDDDDDDD..',
      '.SSSSDDDDDDDDDDD..',
      '.sSoSSDDDDDDDDDD..',
      '.SSSSsDDDDDDDDDD..',
      '.SSSE1SSDDDDDDDD..',
      '.SSSSSSsDDDDDDDD..',
      '.sSSSSSSDDDDDDDD..',
      '..SSSSMSSDDDDDDD..',
      '..sSSSSSSsDDDDDD..',
      '...sSSSSSSSsDDD...',
      '....DSSSSSSSD.....',
      '.....DSSSSSD......',
      '.....DsssssD......',
      '......DssssD......',
      '......DssssD......'
    ]
  },
  // 17x22 @(24,3)：后脑——黄帽顶 + 深发梳纹
  'head-back.png': {
    x: 24, y: 3,
    rows: [
      '.....HHHHHHH.....',
      '...HHHHHHHHHHH...',
      '.HHHHHHHHHHHHHH..',
      '.HHHHHHHHHHHHHH..',
      '.HHYHHHHHHHHYHH..',
      '.HHhhhhhhhhhhHH..',
      '.HHHHHHHHHHHHHH..',
      '.DDDDDDDDDDDDDD..',
      '.DDlDDDDDDDDlDD..',
      '.DDDlDDDDDDlDDD..',
      '.DDDDlDDDDlDDDD..',
      '.DDlDDDDDDDDlDD..',
      '.DDDDlDDDDlDDDD..',
      '.DDlDDDDDDDDlDD..',
      '.DDDDlDDDDlDDDD..',
      '..DDlDDDDDDlDD...',
      '..DDDDlDDlDDDD...',
      '...DDDDDDDDDD....',
      '...DDlDDDDlDD....',
      '....DDDDDDDD.....',
      '.....DDDDDD......',
      '......DDDD.......'
    ]
  },
  // 20x23 @(22,10)：袍——领口/垂褶/腰带（红穗）/下摆；上半中部被头遮挡
  'torso.png': {
    x: 22, y: 10,
    rows: [
      '....oooooooooo......',
      '..ooTTTTTTTTTToo....',
      '.oRRRRRRRRRRRRRRo...',
      '.oRRRRrrrrRRRRRRo...',
      '.oRRUUURRRRRRRRRo...',
      '.oRRUUURRRRRRRRRo...',
      '.oRRUUURRRRRRRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oBBBBbBBBBBBBXXo...',
      '.oBBBBbBBBBBBBXXo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRRRRRrRRRRrRRRo...',
      '.oRrRRRrRRRRrRRRo...',
      '.oEErEErEEEErEEEo...',
      '..oooooooooooooo....'
    ]
  },
  // 22x16 @(21,6)：前裙（金）——竖褶 + 高光 + 下摆阴影
  'skirt-front.png': {
    x: 21, y: 6,
    rows: [
      '..oooooooooooooo....',
      '.oGGGGWGGGGGGGGGGo..',
      '.oGGGWGGfGGGGGGGGo..',
      '.oGGWGGGfGGGfGGGGo..',
      '.oGWGGGgGfGGGfGGGo..',
      '.oWGGGgGGGfGGGfGGo..',
      '.oGGGgGGGGGfGGGfGo..',
      '.oGGgGGGGGGGfGGGGo..',
      '.oGgGGGGGGGGGfGGGo..',
      '.oggGGGGGGGGGGfGGo..',
      '.ogggGGGGGGGGGgGGo..',
      '.oggggGGGGGGGGggGo..',
      '..ogggggGGGGGggggo..',
      '...oggggggggggggo...',
      '....oooooooooooo....',
      '....oooooooooooo....'
    ]
  },
  // 24x15 @(20,6)：后裙（暗金）——更简的竖褶
  'skirt-back.png': {
    x: 20, y: 6,
    rows: [
      '..oooooooooooooooooo..',
      '.o888888888888888888o.',
      '.o9888888088888088888o',
      '.o8888088888088888088o',
      '.o8880888888088888088o',
      '.o8888088888088888088o',
      '.o8888888088888088888o',
      '.o8888888088888088888o',
      '.o8880888888088888088o',
      '.o8888088888088888088o',
      '.o8888888088888088888o',
      '.o8888888088888088888o',
      '..o88888888888888888o.',
      '...oooooooooooooooo...',
      '....oooooooooooooo....'
    ]
  }
};

// 色键 '0'-'8' → 后裙暗金（上表 8/9/0 为数字键，展开映射）
PALETTE['8'] = '#807030';
PALETTE['9'] = '#908040';
PALETTE['0'] = '#705030';

/** 网格 → 64x64 像素数据（含自动描边：内容相邻透明像素补 outline）。 */
function rasterize(grid) {
  const size = 64;
  const buf = Buffer.alloc(size * size * 4, 0);
  const { x: bx, y: by, rows } = grid;
  const width = rows[0].length;
  for (const [index, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`网格行宽不一致：${grid.x},${grid.y} 第 ${index} 行长度 ${row.length} ≠ ${width}`);
    }
  }
  const content = Buffer.alloc(size * size, 0); // 0 透明，1 内容，2 描边
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      const key = rows[row][col];
      if (key === '.') continue;
      const px = bx + col;
      const py = by + row;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      content[py * size + px] = 1;
    }
  }
  // 自动描边：透明且四邻有内容 → 描边
  const mark = [];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      if (content[py * size + px] !== 0) continue;
      const near = (px > 0 && content[py * size + px - 1] === 1)
        || (px < size - 1 && content[py * size + px + 1] === 1)
        || (py > 0 && content[(py - 1) * size + px] === 1)
        || (py < size - 1 && content[(py + 1) * size + px] === 1);
      if (near) mark.push([px, py]);
    }
  }
  for (const [px, py] of mark) content[py * size + px] = 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const kind = content[py * size + px];
      if (kind === 0) continue;
      const key = kind === 2 ? 'o' : rows[py - by]?.[px - bx];
      const color = PALETTE[key] || PALETTE.o;
      const i = (py * size + px) * 4;
      buf[i] = parseInt(color.slice(1, 3), 16);
      buf[i + 1] = parseInt(color.slice(3, 5), 16);
      buf[i + 2] = parseInt(color.slice(5, 7), 16);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

for (const [name, grid] of Object.entries(GRIDS)) {
  const buf = rasterize(grid);
  await sharp(buf, { raw: { width: 64, height: 64, channels: 4 } }).png().toFile(path.join(dir, name));
  console.log('重绘', name);
}
console.log('完成');
