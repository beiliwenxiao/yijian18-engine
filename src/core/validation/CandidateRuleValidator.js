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

import { DEFAULT_TRIGGER_ACTION_IDS } from '../../systems/TriggerActions.js';
import { createStandardCapabilityStrategyRegistry } from '../../systems/items/CapabilityStrategyRegistry.js';
import { ValidationCode, makeError } from './ValidationError.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isReferenceStub = value => isObject(value) && typeof value.$ref === 'string';
const list = value => Array.isArray(value) ? value : [];

function validateSunbeamConfig(value, errors) {
  const path = 'system.weather.sunbeams';
  if (!isObject(value)) {
    errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, 'sunbeams 必须为对象'));
    return;
  }
  if (!Array.isArray(value.imageIds) || value.imageIds.length !== 3) {
    errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.imageIds`, 'imageIds 必须恰好包含三张光束图片'));
  } else {
    const seen = new Set();
    value.imageIds.forEach((imageId, index) => {
      if (typeof imageId !== 'string' || !imageId.trim()) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.imageIds[${index}]`, '图片 ID 必须为非空字符串'));
      } else if (seen.has(imageId)) {
        errors.push(makeError(ValidationCode.DUPLICATE_ID, `${path}.imageIds[${index}]`, '光束图片 ID 不可重复'));
      } else {
        seen.add(imageId);
      }
    });
  }
  if (!Number.isInteger(value.maxBeams) || value.maxBeams < 0 || value.maxBeams > 3) {
    errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.maxBeams`, 'maxBeams 必须是 0–3 的整数'));
  }
}

function stableIds(values, path, errors, seen = new Set()) {
  list(values).forEach((value, index) => {
    const idPath = `${path}[${index}].id`;
    const id = value?.id;
    if (typeof id !== 'string' || !id.trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, idPath, '定义缺少非空稳定 id'));
    } else if (seen.has(id)) {
      errors.push(makeError(ValidationCode.DUPLICATE_ID, idPath, `重复的 id: ${id}`));
    } else {
      seen.add(id);
    }
  });
  return seen;
}

function referenceArray(owner, field, targetIds, path, label, errors) {
  if (!own(owner, field)) return;
  if (!Array.isArray(owner[field])) {
    errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.${field}`, `${field} 必须为数组`));
    return;
  }
  owner[field].forEach((ref, index) => {
    if (typeof ref === 'string' && targetIds.has(ref)) return;
    errors.push(makeError(
      ValidationCode.INVALID_REFERENCE,
      `${path}.${field}[${index}]`,
      `${label}不存在: ${String(ref)}`
    ));
  });
}

function validateSceneEventDependencyGraph(sceneEvents, sceneEventIds, errors, label = 'SceneEvent', arrayPath = 'sceneEvents') {
  const byId = new Map(list(sceneEvents)
    .filter(event => typeof event?.id === 'string' && event.id.trim())
    .map(event => [event.id, event]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) {
      errors.push(makeError('sceneEventDependencyCycle', `${arrayPath}.${id}.dependsOn`, `${label} 依赖形成循环: ${id}`));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependencyId of list(byId.get(id)?.dependsOn)) {
      if (sceneEventIds.has(dependencyId)) visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

const EXECUTABLE_CONTENT_FIELDS = new Set([
  'execute', 'handler', 'callback', 'modulePath', 'className', 'function',
  'code', 'script', 'sourceCode', 'eval', 'adapter'
]);

function rejectExecutableContent(value, path, errors, seen = new WeakSet(), schemaPropertyMap = false) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if ((!schemaPropertyMap && EXECUTABLE_CONTENT_FIELDS.has(key)) || typeof child === 'function') {
      errors.push(makeError('executableContentNotAllowed', childPath, `canonical action 不得声明可执行内容 ${key}`));
      continue;
    }
    rejectExecutableContent(child, childPath, errors, seen, key === 'properties');
  }
}

/**
 * 完整候选的 schema/reference/business-rule 聚合器。
 * 所有方法均为只读，并尽可能收集互相独立的错误而不是遇到首错即停止。
 */
export class CandidateRuleValidator {
  constructor({ contentValidator, businessRuleValidators = [], capabilityStrategyRegistry = null } = {}) {
    if (!contentValidator) throw new TypeError('CandidateRuleValidator requires contentValidator');
    this.contentValidator = contentValidator;
    this.capabilityStrategyRegistry = capabilityStrategyRegistry || createStandardCapabilityStrategyRegistry();
    this.businessRuleValidators = list(businessRuleValidators).filter(value => typeof value === 'function');
  }

  validateSchema(candidate, schemaId = 'gameProject') {
    const errors = [];
    errors.push(...this.contentValidator.validateVersion(candidate).errors);
    errors.push(...this.contentValidator.validate(candidate, schemaId).errors);

    if (isObject(candidate?.presentation) && !isReferenceStub(candidate.presentation)) {
      errors.push(...this.contentValidator.validate(candidate.presentation, 'presentationProfile', 'presentation').errors);
    }
    if (isObject(candidate?.assetManifest) && !isReferenceStub(candidate.assetManifest)) {
      errors.push(...this.contentValidator.validate(candidate.assetManifest, 'assetManifest', 'assetManifest').errors);
    }
    if (Array.isArray(candidate?.rescues)) {
      candidate.rescues.forEach((rescue, index) => {
        if (!isReferenceStub(rescue)) errors.push(...this.contentValidator.validate(rescue, 'rescueDefinition', `rescues[${index}]`).errors);
      });
    }
    if (Array.isArray(candidate?.library?.items)) {
      errors.push(...this.contentValidator.validateList(candidate.library.items, 'itemDefinition', 'library.items').errors);
    }

    const progression = candidate?.progression;
    if (isObject(progression)) {
      errors.push(...this.contentValidator.validate(progression, 'progressionConfig', 'progression').errors);
      const skills = Array.isArray(progression.skills?.skills)
        ? progression.skills.skills
        : (Array.isArray(progression.skills) ? progression.skills : []);
      errors.push(...this.contentValidator.validateList(skills, 'skill', 'progression.skills').errors);
      list(progression.graphs).forEach((graph, index) => {
        if (!isReferenceStub(graph)) {
          errors.push(...this.contentValidator.validate(graph, 'progressionGraph', `progression.graphs[${index}]`).errors);
        }
      });
    }

    list(candidate?.variables?.cityStates).forEach((city, index) => {
      errors.push(...this.contentValidator.validate(city, 'city', `variables.cityStates[${index}]`).errors);
    });
    return errors;
  }

  validateReferences(candidate) {
    const errors = [];
    const sceneIds = stableIds(candidate?.scenes, 'scenes', errors);
    const dialogueIds = stableIds(candidate?.dialogues, 'dialogues', errors);
    const tutorialIds = stableIds(candidate?.tutorials, 'tutorials', errors);
    const questIds = stableIds(candidate?.quests, 'quests', errors);
    const triggerIds = stableIds(candidate?.triggers, 'triggers', errors);

    // ★ FlowGroup 双读兼容：flowGroups 优先，缺失时回退 sceneEvents（旧名）
    // 使用 Set 合并去重：flowGroups 的 id 覆盖 sceneEvents 的 id
    const flowGroupsList = list(candidate?.flowGroups);
    const sceneEventsList = list(candidate?.sceneEvents);
    const flowGroupMap = new Map();
    [...sceneEventsList, ...flowGroupsList].forEach(item => {
      if (item && typeof item.id === 'string' && item.id.trim()) flowGroupMap.set(item.id, item);
    });
    const flowGroupsAll = Array.from(flowGroupMap.values());
    const flowGroupIds = stableIds(flowGroupsAll, (flowGroupsList.length ? 'flowGroups' : (sceneEventsList.length ? 'sceneEvents' : 'flowGroups')), errors);
    const flowGroupsById = new Map(flowGroupsAll.map(fg => [fg.id, fg]));

    // 数组展示名：新格式用 flowGroups 下标，旧格式用 sceneEvents 下标
    const fgArrayPath = flowGroupsList.length ? 'flowGroups' : 'sceneEvents';
    const fgLabel = 'FlowGroup(SceneEvent)';

    const eventOrderByScene = new Map();
    flowGroupsAll.forEach((flowGroup, index) => {
      const path = `${fgArrayPath}[${index}]`;
      const scopedSceneIds = list(flowGroup?.scope?.sceneIds);
      scopedSceneIds.forEach((sceneId, sceneIndex) => {
        if (!sceneIds.has(sceneId)) {
          errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${path}.scope.sceneIds[${sceneIndex}]`, `场景不存在: ${String(sceneId)}`));
          return;
        }
        const orders = eventOrderByScene.get(sceneId) || new Map();
        if (orders.has(flowGroup.order)) {
          errors.push(makeError('duplicateSceneEventOrder', `${path}.order`, `${sceneId} 中 ${fgLabel}.order ${flowGroup.order} 与 ${orders.get(flowGroup.order)} 重复`));
        } else {
          orders.set(flowGroup.order, flowGroup.id);
          eventOrderByScene.set(sceneId, orders);
        }
      });
      referenceArray(flowGroup, 'dependsOn', flowGroupIds, path, `前置 ${fgLabel}`, errors);
      if (list(flowGroup?.dependsOn).includes(flowGroup?.id)) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${path}.dependsOn`, `${fgLabel} 不得依赖自身`));
      }
    });
    if (flowGroupsAll.length > 0) {
      validateSceneEventDependencyGraph(flowGroupsAll, flowGroupIds, errors, fgLabel, fgArrayPath);
    }
    // 全 Trigger 化：flowGroups/sceneEvents 目录清空后，trigger/tutorial 的
    // flowGroupId 仅为兼容标签，不再校验其登记存在性（也不再校验场景归属）。
    const flowGroupsCatalogEmpty = flowGroupsAll.length === 0;

    list(candidate?.triggers).forEach((trigger, index) => {
      // 双字段校验：flowGroupId 优先，sceneEventId 次之；两者都存在但不一致时报错
      const hasFlowGroup = own(trigger, 'flowGroupId');
      const hasSceneEvent = own(trigger, 'sceneEventId');
      if (!hasFlowGroup && !hasSceneEvent) return;
      const fgId = (hasFlowGroup ? String(trigger.flowGroupId || '') : '') || String(trigger.sceneEventId || '');
      const path = hasFlowGroup ? `triggers[${index}].flowGroupId` : `triggers[${index}].sceneEventId`;
      if (hasFlowGroup && hasSceneEvent && String(trigger.flowGroupId || '') !== String(trigger.sceneEventId || '')) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `triggers[${index}]`, `${fgLabel} 双字段不一致: flowGroupId=${String(trigger.flowGroupId)}, sceneEventId=${String(trigger.sceneEventId)}`));
        return;
      }
      if (!fgId) return;
      if (flowGroupsCatalogEmpty) return; // 兼容标签：目录清空后不再校验存在性
    });

    list(candidate?.tutorials).forEach((tutorial, index) => {
      const path = `tutorials[${index}]`;
      if (tutorial?.autoTrigger === true) {
        errors.push(makeError(
          'tutorialAutoDisplayNotAllowed',
          `${path}.autoTrigger`,
          'Tutorial 不允许自动触发；必须由事件 action 显式调用 tutorial.command(show, tutorialId)'
        ));
      }
      if (tutorial?.autoAdvance === true) {
        errors.push(makeError(
          'tutorialAutoDisplayNotAllowed',
          `${path}.autoAdvance`,
          'Tutorial 完成后不允许自动展示下一项；下一项必须由事件 action 显式调用'
        ));
      }
      const hasFlowGroup = own(tutorial, 'flowGroupId');
      const hasSceneEvent = own(tutorial, 'sceneEventId');
      if (!hasFlowGroup && !hasSceneEvent) return;
      const fgId = (hasFlowGroup ? String(tutorial.flowGroupId || '') : '') || String(tutorial.sceneEventId || '');
      if (hasFlowGroup && hasSceneEvent && String(tutorial.flowGroupId || '') !== String(tutorial.sceneEventId || '')) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, path, `${fgLabel} 双字段不一致: flowGroupId=${String(tutorial.flowGroupId)}, sceneEventId=${String(tutorial.sceneEventId)}`));
        return;
      }
      if (!fgId) return;
      if (flowGroupsCatalogEmpty) return; // 兼容标签：目录清空后不再校验存在性
    });

    const libraryIds = {};
    for (const [kind, definitions] of Object.entries(candidate?.library || {})) {
      if (Array.isArray(definitions)) libraryIds[kind] = stableIds(definitions, `library.${kind}`, errors);
    }

    const itemIds = libraryIds.items || new Set();
    const toolTypes = new Set(list(candidate?.library?.items)
      .filter(item => item?.type === 'tool' && typeof item.toolType === 'string')
      .map(item => item.toolType));
    list(candidate?.library?.resourceNodes).forEach((node, index) => {
      if (!itemIds.has(node?.itemId)) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `library.resourceNodes[${index}].itemId`, `资源节点引用了不存在的物品: ${node?.itemId}`));
      }
      if (node?.requiredToolType && !toolTypes.has(node.requiredToolType)) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `library.resourceNodes[${index}].requiredToolType`, `资源节点要求的工具类型不存在: ${node.requiredToolType}`));
      }
    });

    list(candidate?.quests).forEach((quest, index) => {
      const path = `quests[${index}]`;
      referenceArray(quest, 'prerequisites', questIds, path, '前置任务', errors);
      referenceArray(quest, 'triggerRefs', triggerIds, path, '触发器', errors);
      referenceArray(quest, 'dialogueRefs', dialogueIds, path, '对话', errors);
      referenceArray(quest, 'sceneRefs', sceneIds, path, '场景', errors);
    });

    const commandDefinitions = Array.isArray(candidate?.commands)
      ? candidate.commands
      : list(candidate?.commandCatalog?.commands);
    const commandIds = stableIds(commandDefinitions, 'commands', errors);
    const scenarioIds = stableIds(candidate?.scenarios, 'scenarios', errors);

    list(candidate?.scenarios).forEach((scenario, index) => {
      const path = `scenarios[${index}]`;
      referenceArray(scenario, 'triggerRefs', triggerIds, path, '触发器', errors);
      referenceArray(scenario, 'questRefs', questIds, path, '任务', errors);
      referenceArray(scenario, 'dialogueRefs', dialogueIds, path, '对话', errors);
      referenceArray(scenario, 'sceneRefs', sceneIds, path, '场景', errors);
      referenceArray(scenario, 'commandRefs', commandIds, path, '命令', errors);
      referenceArray(scenario, 'scenarioRefs', scenarioIds, path, '场景编排', errors);
      referenceArray(scenario, 'entryTriggerRefs', triggerIds, path, '入口触发器', errors);
      referenceArray(scenario, 'exitTriggerRefs', triggerIds, path, '出口触发器', errors);
    });

    const actionDefinitions = [
      ...list(candidate?.triggerCatalog?.actions),
      ...list(candidate?.actionCatalog?.actions),
      ...list(candidate?.actions)
    ];
    const actionDescriptorsById = new Map(actionDefinitions
      .filter(isObject)
      .map(descriptor => [descriptor.value || descriptor.id, descriptor])
      .filter(([id]) => typeof id === 'string' && id.trim()));
    const actionIds = new Set([
      ...DEFAULT_TRIGGER_ACTION_IDS,
      ...actionDefinitions
        .map(action => typeof action === 'string' ? action : action?.value || action?.id)
        .filter(Boolean)
    ]);
    const extensionEndings = isObject(candidate?.extensions?.endings)
      ? [candidate.extensions.endings]
      : [];
    const vehicleIds = libraryIds.vehicles || new Set();
    const standardActionReferences = {
      'rescue.command': ['rescueId', stableIds(candidate?.rescues, 'rescues', errors), '救援'],
      'battle.command': ['battleId', stableIds(candidate?.battles, 'battles', errors), '战役'],
      'construction.command': ['definitionId', stableIds(candidate?.construction?.definitions, 'construction.definitions', errors), '营建定义'],
      // Vehicle definitions are scene-owned canonical data. Project-only validation verifies
      // a non-empty stable reference here; a populated global library remains strictly closed.
      'vehicle.command': ['vehicleId', vehicleIds, '载具', { allowSceneOwned: true }],
      'quest.command': ['questId', questIds, '任务'],
      'world.teleport': ['sceneId', sceneIds, '场景'],
      'ending.command': ['endingId', stableIds(candidate?.endings || extensionEndings, candidate?.endings ? 'endings' : 'extensions.endings', errors), '结局'],
      'dialogue.command': ['dialogueId', dialogueIds, '对话'],
      'tutorial.command': ['tutorialId', tutorialIds, '教学'],
      'state.transaction': ['definitionId', stableIds(candidate?.commands, 'commands', errors), '事务']
    };
    if (actionIds.size > 0) {
      list(candidate?.triggers).forEach((trigger, triggerIndex) => {
        const validateActionSteps = (steps, actionPathPrefix) => {
          list(steps).forEach((action, actionIndex) => {
            const actionPath = `${actionPathPrefix}.do[${actionIndex}]`;
            // branch[] 分支容器：递归校验子路径动作
            if (Array.isArray(action?.branch)) {
              for (const [bIndex, branch] of action.branch.entries()) {
                validateActionSteps(branch?.do || [], `${actionPath}.branch[${bIndex}]`);
              }
              return;
            }
            if (!actionIds.has(action?.action)) {
              errors.push(makeError(
                ValidationCode.INVALID_REFERENCE,
                `${actionPath}.action`,
                `未登记的 action: ${String(action?.action)}`
              ));
            }
            const catalogDescriptor = actionDescriptorsById.get(action?.action);
            const operations = list(catalogDescriptor?.operations);
            if (operations.length > 0) {
              const operationId = action?.params?.operation;
              const operationIds = new Set(operations
                .map(operation => typeof operation === 'string' ? operation : operation?.value || operation?.id)
                .filter(Boolean));
              if (typeof operationId !== 'string' || !operationId.trim() || !operationIds.has(operationId)) {
                errors.push(makeError(
                  ValidationCode.INVALID_REFERENCE,
                  `${actionPath}.params.operation`,
                  `未登记的 operation: ${String(operationId)}`
                ));
              }
            }
            const referenceContract = standardActionReferences[action?.action];
            if (referenceContract) {
              const [field, ids, label, options = {}] = referenceContract;
              const referenceId = action?.params?.[field];
              const canResolveFromScene = options.allowSceneOwned === true && ids.size === 0;
              if (typeof referenceId !== 'string' || !referenceId.trim() || (!canResolveFromScene && !ids.has(referenceId))) {
                errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${actionPath}.params.${field}`, `${label}不存在: ${String(referenceId)}`));
              }
            }
            if (action?.commandType && commandIds.size > 0 && !commandIds.has(action.commandType)) {
              errors.push(makeError(
                ValidationCode.INVALID_REFERENCE,
                `${actionPath}.commandType`,
                `未登记的 command: ${action.commandType}`
              ));
            }
          });
        };
        validateActionSteps(trigger?.do, `triggers[${triggerIndex}]`);
      });
    }

    this._validateCapabilities(candidate, errors);
    return errors;
  }

  _validateCapabilities(candidate, errors) {
    const catalog = candidate?.capabilityCatalog;
    const capabilityIds = new Set(
      Array.isArray(catalog) ? catalog.map(value => typeof value === 'string' ? value : value?.id)
        : Object.keys(isObject(catalog) ? catalog : {})
    );
    const strategies = candidate?.strategyCatalog;
    const strategyIds = new Set(
      Array.isArray(strategies) ? strategies.map(value => typeof value === 'string' ? value : value?.id)
        : Object.keys(isObject(strategies) ? strategies : {})
    );
    const hasDefinition = (kind, id) => list(candidate?.library?.[kind]).some(definition => definition?.id === id)
      || list(candidate?.[kind]).some(definition => definition?.id === id);

    for (const [kind, definitions] of Object.entries(candidate?.library || {})) {
      list(definitions).forEach((definition, definitionIndex) => {
        const values = Array.isArray(definition?.capabilities)
          ? definition.capabilities
          : Object.entries(isObject(definition?.capabilities) ? definition.capabilities : {})
            .map(([id, parameters]) => ({ id, ...(isObject(parameters) ? parameters : { parameters }) }));
        values.forEach((capability, capabilityIndex) => {
          const id = typeof capability === 'string' ? capability : capability?.capabilityId || capability?.id;
          const path = `library.${kind}[${definitionIndex}].capabilities[${capabilityIndex}]`;
          const builtIn = this.capabilityStrategyRegistry.find(id, capability?.strategyId);
          if (!builtIn && !capabilityIds.has(id)) {
            errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${path}.id`, `未知 capability: ${String(id)}`));
          }
          const strategyId = typeof capability === 'object' ? capability?.strategyId : null;
          if (strategyId && !builtIn && !strategyIds.has(strategyId)) {
            errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${path}.strategyId`, `未知 strategy: ${strategyId}`));
          }
        });
        if (values.length > 0 && kind === 'items') {
          errors.push(...this.capabilityStrategyRegistry.validateDefinition(definition, {
            path: `library.${kind}[${definitionIndex}]`, hasDefinition, allowUnknownStrategies: true
          }));
        }
      });
    }
  }

  validateBusinessRules(candidate, context = {}) {
    const errors = [];
    const weather = candidate?.system?.weather;
    if (weather !== undefined) {
      const weatherTypes = new Set(['clear', 'breeze', 'wind', 'lightRain', 'heavyRain', 'lightFog', 'heavyFog', 'storm']);
      if (!isObject(weather)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, 'system.weather', 'weather 必须为对象'));
      } else {
        if (typeof weather.default !== 'string' || !weatherTypes.has(weather.default)) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, 'system.weather.default', 'default weather 未登记'));
        }
        if (typeof weather.transitionSpeed !== 'number' || !Number.isFinite(weather.transitionSpeed) || weather.transitionSpeed <= 0) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, 'system.weather.transitionSpeed', 'transitionSpeed 必须为正数'));
        }
        if (own(weather, 'fog')) {
          if (!isObject(weather.fog)) {
            errors.push(makeError(ValidationCode.TYPE_MISMATCH, 'system.weather.fog', 'fog 必须为对象'));
          } else if (own(weather.fog, 'fadeDurationSeconds')) {
            const fadeDurationSeconds = weather.fog.fadeDurationSeconds;
            if (!isObject(fadeDurationSeconds)) {
              errors.push(makeError(
                ValidationCode.TYPE_MISMATCH,
                'system.weather.fog.fadeDurationSeconds',
                'fadeDurationSeconds 必须为对象'
              ));
            } else {
              const min = fadeDurationSeconds.min;
              const max = fadeDurationSeconds.max;
              const validMin = typeof min === 'number' && Number.isFinite(min) && min >= 10 && min <= 30;
              const validMax = typeof max === 'number' && Number.isFinite(max) && max >= 10 && max <= 30;
              if (!validMin) {
                errors.push(makeError(
                  ValidationCode.OUT_OF_RANGE,
                  'system.weather.fog.fadeDurationSeconds.min',
                  'min 必须是 10–30 秒的有限数字'
                ));
              }
              if (!validMax) {
                errors.push(makeError(
                  ValidationCode.OUT_OF_RANGE,
                  'system.weather.fog.fadeDurationSeconds.max',
                  'max 必须是 10–30 秒的有限数字'
                ));
              }
              if (validMin && validMax && min > max) {
                errors.push(makeError(
                  ValidationCode.OUT_OF_RANGE,
                  'system.weather.fog.fadeDurationSeconds',
                  'min 不能大于 max'
                ));
              }
            }
          }
        }
        if (own(weather, 'sunbeams')) {
          validateSunbeamConfig(weather.sunbeams, errors);
        }
        if (own(weather, 'particles') && !isObject(weather.particles)) {
          errors.push(makeError(ValidationCode.TYPE_MISMATCH, 'system.weather.particles', 'particles 必须为对象'));
        }
      }
    }
    const month = candidate?.variables?.storyState?.month;
    if (month !== undefined && (!Number.isInteger(month) || month < 1)) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, 'variables.storyState.month', 'month 必须为正整数'));
    }
    const triggers = list(candidate?.triggers);
    triggers.forEach((trigger, index) => {
      const path = `triggers[${index}]`;
      if (typeof trigger?.when?.type !== 'string' || !trigger.when.type.trim()) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.when.type`, 'trigger.when.type 必须是非空字符串'));
      }
      if (!Array.isArray(trigger?.do)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.do`, 'trigger.do 必须为数组'));
      } else {
        const stepIds = new Set();
        const requiresStableSteps = Boolean(
          (typeof trigger?.flowGroupId === 'string' && trigger.flowGroupId.trim())
          || (typeof trigger?.sceneEventId === 'string' && trigger.sceneEventId.trim())
        );
        trigger.do.forEach((action, actionIndex) => {
          const actionPath = `${path}.do[${actionIndex}]`;
          rejectExecutableContent(action, actionPath, errors);
          if (typeof action?.action !== 'string' || !action.action.trim()) {
            errors.push(makeError(ValidationCode.MISSING_FIELD, `${actionPath}.action`, 'action 必须是非空字符串'));
          }
          if (own(action, 'params') && !isObject(action.params)) {
            errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${actionPath}.params`, 'action.params 必须为对象'));
          }
          const stepId = typeof action?.stepId === 'string' ? action.stepId.trim() : '';
          if (requiresStableSteps && !stepId) {
            errors.push(makeError(ValidationCode.MISSING_FIELD, `${actionPath}.stepId`, '已归属 FlowGroup(SceneEvent) 的动作必须声明稳定 stepId'));
          } else if (stepId && stepIds.has(stepId)) {
            errors.push(makeError(ValidationCode.DUPLICATE_ID, `${actionPath}.stepId`, `重复的 stepId: ${stepId}`));
          }
          if (stepId) stepIds.add(stepId);
          if (requiresStableSteps && own(action, 'await')) {
            errors.push(makeError('legacyAwaitNotAllowed', `${actionPath}.await`, 'await 已废弃；TriggerSystem 始终严格串行等待并在失败时短路'));
          } else if (own(action, 'await') && typeof action.await !== 'boolean') {
            errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${actionPath}.await`, 'action.await 必须为布尔值'));
          }
        });
      }
      if (own(trigger, 'cooldown') && (typeof trigger.cooldown !== 'number' || trigger.cooldown < 0)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.cooldown`, 'cooldown 必须为非负数'));
      }
      if (trigger?.when?.type === 'timer') {
        const seconds = trigger.when.params?.seconds;
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.when.params.seconds`, 'timer seconds 必须大于 0'));
        }
      }
    });

    list(candidate?.quests).forEach((quest, questIndex) => {
      const path = `quests[${questIndex}]`;
      if (!isObject(quest)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, 'QuestDefinition 必须为对象'));
        return;
      }
      if (!Array.isArray(quest.objectives)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.objectives`, 'quest objectives 必须为数组'));
      } else {
        stableIds(quest.objectives, `${path}.objectives`, errors);
        quest.objectives.forEach((objective, objectiveIndex) => {
          const objectivePath = `${path}.objectives[${objectiveIndex}]`;
          if (typeof objective?.type !== 'string' || !objective.type.trim()) errors.push(makeError(ValidationCode.MISSING_FIELD, `${objectivePath}.type`, '任务目标必须声明 type'));
          if (objective?.targetId !== undefined && objective.targetId !== null && typeof objective.targetId !== 'string') errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${objectivePath}.targetId`, 'targetId 必须为字符串或 null（通配）'));
          if (objective?.requiredCount !== undefined && (!Number.isInteger(objective.requiredCount) || objective.requiredCount < 1)) errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${objectivePath}.requiredCount`, 'requiredCount 必须为正整数'));
          if (objective?.optional !== undefined && typeof objective.optional !== 'boolean') errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${objectivePath}.optional`, 'optional 必须为布尔值'));
        });
      }
      for (const field of ['text', 'giver', 'turnIn', 'reward', 'time', 'repeatPolicy']) {
        if (own(quest, field) && !isObject(quest[field])) errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.${field}`, `${field} 必须为对象`));
      }
      const runtimeFields = ['questRuntimeId', 'state', 'objectiveProgress', 'acceptedLogicalTime', 'remaining', 'repeat', 'rewardSettlementLedger', 'tracking', 'stateRevision', 'acceptedTime', 'completedTime', 'expiresAt', 'lastCompletedTime', 'tracked'];
      runtimeFields.forEach(field => {
        if (own(quest, field)) errors.push(makeError('runtimeFieldInDefinition', `${path}.${field}`, `QuestDefinition 不得包含运行态字段 ${field}`));
      });
    });

    list(candidate?.rescues).forEach((rescue, rescueIndex) => {
      const path = `rescues[${rescueIndex}]`;
      const positiveFields = ['duration', 'postGateDuration', 'evacuationRadius', 'followDistance', 'followMaxDistance'];
      positiveFields.forEach(field => {
        if (!own(rescue, field)) return;
        const value = rescue[field];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.${field}`, `${field} 必须为正数`));
        }
      });
      for (const field of ['requiredGuardCount', 'assassinWaveCount']) {
        if (!own(rescue, field)) continue;
        if (!Number.isInteger(rescue[field]) || rescue[field] <= 0) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.${field}`, `${field} 必须为正整数`));
        }
      }
      if (own(rescue, 'followDistance') && own(rescue, 'followMaxDistance')
        && Number(rescue.followDistance) >= Number(rescue.followMaxDistance)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.followDistance`, 'followDistance 必须小于 followMaxDistance'));
      }
      if (own(rescue, 'followOffset') && (!isObject(rescue.followOffset)
        || typeof rescue.followOffset.x !== 'number' || !Number.isFinite(rescue.followOffset.x)
        || typeof rescue.followOffset.y !== 'number' || !Number.isFinite(rescue.followOffset.y))) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.followOffset`, 'followOffset 必须包含有限数值 x/y'));
      }
    });

    list(candidate?.scenarios).forEach((scenario, scenarioIndex) => {
      const path = `scenarios[${scenarioIndex}]`;
      if (own(scenario, 'actions') || own(scenario, 'execute')) {
        errors.push(makeError('scenarioExecutionNotAllowed', path, 'ScenarioDefinition 只能声明引用闭包，不能持有执行逻辑'));
      }
    });

    const actionDefinitions = [
      ...list(candidate?.triggerCatalog?.actions),
      ...list(candidate?.actionCatalog?.actions),
      ...list(candidate?.actions)
    ];
    actionDefinitions.forEach((descriptor, index) => {
      if (!isObject(descriptor)) return;
      const path = `actions[${index}]`;
      rejectExecutableContent(descriptor, path, errors);
      if (own(descriptor, 'paramsSchema') && !isObject(descriptor.paramsSchema) && typeof descriptor.paramsSchema !== 'string') {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.paramsSchema`, 'paramsSchema 必须为对象或 schema id'));
      }
      const operationIds = new Set();
      list(descriptor.operations).forEach((operation, operationIndex) => {
        const operationPath = `${path}.operations[${operationIndex}]`;
        if (!isObject(operation)) {
          errors.push(makeError(ValidationCode.TYPE_MISMATCH, operationPath, 'operation descriptor 必须为对象'));
          return;
        }
        rejectExecutableContent(operation, operationPath, errors);
        const operationValue = typeof operation.value === 'string' ? operation.value.trim() : '';
        const operationLegacyId = typeof operation.id === 'string' ? operation.id.trim() : '';
        if (operationValue && operationLegacyId && operationValue !== operationLegacyId) {
          errors.push(makeError(
            ValidationCode.INVALID_REFERENCE,
            `${operationPath}.id`,
            `operation.id 必须与 operation.value 一致: ${operationLegacyId} !== ${operationValue}`
          ));
        }
        const operationId = operationValue || operationLegacyId;
        if (!operationId) {
          errors.push(makeError(ValidationCode.MISSING_FIELD, `${operationPath}.value`, 'operation 必须声明非空稳定 value/id'));
        } else if (operationIds.has(operationId)) {
          errors.push(makeError(ValidationCode.DUPLICATE_ID, `${operationPath}.value`, `重复的 operation: ${operationId}`));
        } else {
          operationIds.add(operationId);
        }
        if (typeof operation.label !== 'string' || !operation.label.trim()) {
          errors.push(makeError(ValidationCode.MISSING_FIELD, `${operationPath}.label`, 'operation 必须声明中文可读 label'));
        }
        if (!own(operation, 'paramsSchema')) {
          errors.push(makeError(ValidationCode.MISSING_FIELD, `${operationPath}.paramsSchema`, 'operation 必须声明 paramsSchema'));
        } else if (!isObject(operation.paramsSchema) && typeof operation.paramsSchema !== 'string') {
          errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${operationPath}.paramsSchema`, 'operation paramsSchema 必须为对象或 schema id'));
        }
        if (!own(operation, 'resultSemantics')) {
          errors.push(makeError(ValidationCode.MISSING_FIELD, `${operationPath}.resultSemantics`, 'operation 必须声明 resultSemantics'));
        } else if (typeof operation.resultSemantics !== 'string'
          && !isObject(operation.resultSemantics)) {
          errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${operationPath}.resultSemantics`, 'resultSemantics 必须为字符串或对象'));
        }
      });
    });

    const commandDefinitions = Array.isArray(candidate?.commands)
      ? candidate.commands
      : list(candidate?.commandCatalog?.commands);
    commandDefinitions.forEach((command, index) => {
      const path = `commands[${index}]`;
      if (!isObject(command)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, 'command descriptor 必须为对象'));
        return;
      }
      rejectExecutableContent(command, path, errors);
      if (own(command, 'payloadSchema') && !isObject(command.payloadSchema) && typeof command.payloadSchema !== 'string') {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.payloadSchema`, 'payloadSchema 必须为对象或 schema id'));
      }
    });

    for (const [kind, definitions] of Object.entries(candidate?.library || {})) {
      list(definitions).forEach((definition, definitionIndex) => {
        const capabilities = list(definition?.capabilities);
        const ids = capabilities.map(value => typeof value === 'string' ? value : value?.capabilityId || value?.id).filter(Boolean);
        const seen = new Set();
        ids.forEach((id, capabilityIndex) => {
          if (seen.has(id)) {
            errors.push(makeError(ValidationCode.DUPLICATE_ID, `library.${kind}[${definitionIndex}].capabilities[${capabilityIndex}]`, `重复 capability: ${id}`));
          }
          seen.add(id);
        });
        capabilities.forEach((capability, capabilityIndex) => {
          if (!isObject(capability)) return;
          const path = `library.${kind}[${definitionIndex}].capabilities[${capabilityIndex}]`;
          referenceArray(capability, 'requires', seen, path, '依赖 capability', errors);
          referenceArray(capability, 'conflictsWith', seen, path, '互斥 capability', errors);
          if (own(capability, 'parameters') && !isObject(capability.parameters)) {
            errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.parameters`, 'capability parameters 必须为对象'));
          }
        });
      });
    }

    for (const validator of this.businessRuleValidators) {
      try {
        const result = validator(candidate, context);
        const validatorErrors = Array.isArray(result) ? result : list(result?.errors);
        validatorErrors.forEach(error => errors.push({
          code: error?.code || 'projectPolicy',
          path: error?.path || 'project',
          message: error?.message || '项目内容策略校验失败',
          ...(isObject(error) ? error : {})
        }));
      } catch (error) {
        errors.push(makeError('projectPolicy', 'project', String(error?.message || error)));
      }
    }
    return errors;
  }
}

export default CandidateRuleValidator;
