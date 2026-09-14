/************************************************************

 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)

 *

 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎

 * @author    刘枭 (beiliwenxiao)

 * @email     beiliwenxiao@qq.com

 * @date      2026-01-14

 * @blog      https://blog.csdn.net/beiliwenxiao

 * @repo      https://github.com/beiliwenxiao/yijian18-engine

 *            https://gitee.com/coderaaa/yijian18-engine

 ************************************************************/

import { FieldType } from '../../core/validation/ContentValidator.js';
import { ValidationCode, makeError } from '../../core/validation/ValidationError.js';

export const PRESENTATION_SCHEMA_VERSION = 1;
const positive = (required = true) => ({ type: FieldType.NUMBER, required, min: Number.MIN_VALUE });

export const PRESENTATION_DIMENSION_SCHEMA = {
  id: 'presentationDimension', allowUnknown: false,
  fields: { width: positive(), height: positive() }
};

export const PRESENTATION_COLLISION_OFFSET_SCHEMA = {
  id: 'presentationCollisionOffset', allowUnknown: false,
  fields: {
    offsetX: { type: FieldType.NUMBER, required: true },
    offsetY: { type: FieldType.NUMBER, required: true }
  }
};

export const PRESENTATION_COLLISION_ELLIPSE_SCHEMA = {
  id: 'presentationCollisionEllipse', allowUnknown: false,
  fields: { radiusX: positive(), radiusY: positive() }
};

export const PRESENTATION_LOGICAL_RESOLUTION_SCHEMA = {
  id: 'presentationLogicalResolution', allowUnknown: false,
  fields: {
    width: positive(), height: positive(),
    // window：逻辑视口跟随窗口尺寸，世界 1:1 不缩放；fit/stretch 保持固定参考分辨率。
    scaleMode: { type: FieldType.STRING, required: true, enum: ['fit', 'stretch', 'window'] }
  }
};

export const PRESENTATION_WORLD_SCHEMA = {
  id: 'presentationWorld', allowUnknown: false,
  fields: {
    pixelsPerWorldUnit: positive(), gridSize: positive(),
    tileWidth: positive(), tileHeight: positive()
  }
};

export const PRESENTATION_DEADZONE_SCHEMA = {
  id: 'presentationDeadzone', allowUnknown: false,
  fields: {
    x: { type: FieldType.NUMBER, required: true, min: 0 },
    y: { type: FieldType.NUMBER, required: true, min: 0 }
  }
};

export const PRESENTATION_CAMERA_SCHEMA = {
  id: 'presentationCamera', allowUnknown: false,
  fields: {
    followSpeed: { type: FieldType.NUMBER, required: true, min: 0 },
    deadzone: { type: FieldType.OBJECT, required: true, schema: 'presentationDeadzone' }
  }
};

export const PRESENTATION_ACTOR_SCHEMA = {
  id: 'presentationActor', allowUnknown: false,
  fields: {
    visual: { type: FieldType.OBJECT, required: true, schema: 'presentationDimension' },
    footprint: { type: FieldType.OBJECT, required: true, schema: 'presentationDimension' },
    colliderRadius: positive(),
    collisionOffset: { type: FieldType.OBJECT, required: false, schema: 'presentationCollisionOffset' },
    collisionEllipse: { type: FieldType.OBJECT, required: false, schema: 'presentationCollisionEllipse' }
  }
};

export const PRESENTATION_ACTORS_SCHEMA = {
  id: 'presentationActors', allowUnknown: false,
  fields: {
    directionMode: { type: FieldType.INTEGER, required: true, enum: [4, 8] },
    player: { type: FieldType.OBJECT, required: true, schema: 'presentationActor' },
    unit: { type: FieldType.OBJECT, required: true, schema: 'presentationActor' }
  }
};

export const PRESENTATION_UI_SCHEMA = {
  id: 'presentationUi', allowUnknown: false,
  fields: { mobileMinFontPx: positive() }
};

export const PRESENTATION_PROFILE_SCHEMA = {
  id: 'presentationProfile',
  fields: {
    schemaVersion: { type: FieldType.INTEGER, required: true, min: 1, max: PRESENTATION_SCHEMA_VERSION },
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    visualStyle: { type: FieldType.OBJECT },
    logicalResolution: { type: FieldType.OBJECT, required: true, schema: 'presentationLogicalResolution' },
    world: { type: FieldType.OBJECT, required: true, schema: 'presentationWorld' },
    camera: { type: FieldType.OBJECT, required: true, schema: 'presentationCamera' },
    actors: { type: FieldType.OBJECT, required: true, schema: 'presentationActors' },
    ui: { type: FieldType.OBJECT, required: true, schema: 'presentationUi' },
    palette: { type: FieldType.OBJECT, required: true, valueType: FieldType.STRING }
  },
  validate(profile) {
    const errors = [];
    const positivePaths = [
      ['logicalResolution.width', profile.logicalResolution?.width],
      ['logicalResolution.height', profile.logicalResolution?.height],
      ['world.pixelsPerWorldUnit', profile.world?.pixelsPerWorldUnit],
      ['world.gridSize', profile.world?.gridSize], ['world.tileWidth', profile.world?.tileWidth],
      ['world.tileHeight', profile.world?.tileHeight], ['actors.player.colliderRadius', profile.actors?.player?.colliderRadius],
      ['actors.unit.colliderRadius', profile.actors?.unit?.colliderRadius], ['ui.mobileMinFontPx', profile.ui?.mobileMinFontPx]
    ];
    for (const [path, value] of positivePaths) {
      if (Number(value) > 0) continue;
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, path, '表现规格数值必须大于 0'));
    }
    return { ok: errors.length === 0, errors };
  }
};

export const PRESENTATION_PROFILE_SCHEMAS = [
  PRESENTATION_DIMENSION_SCHEMA, PRESENTATION_COLLISION_OFFSET_SCHEMA, PRESENTATION_COLLISION_ELLIPSE_SCHEMA,
  PRESENTATION_LOGICAL_RESOLUTION_SCHEMA, PRESENTATION_WORLD_SCHEMA,
  PRESENTATION_DEADZONE_SCHEMA, PRESENTATION_CAMERA_SCHEMA,
  PRESENTATION_ACTOR_SCHEMA, PRESENTATION_ACTORS_SCHEMA, PRESENTATION_UI_SCHEMA,
  PRESENTATION_PROFILE_SCHEMA
];
