/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const clone = value => value === undefined ? undefined : structuredClone(value);

function tokenize(path) {
  if (Array.isArray(path)) return path.slice();
  if (path === '' || path == null) return [];
  if (String(path).startsWith('/')) {
    return String(path).slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  const tokens = [];
  String(path).replace(/([^[.\]]+)|\[(\d+|"[^"]*"|'[^']*')\]/g, (_match, plain, bracket) => {
    const token = plain ?? bracket;
    tokens.push(/^\d+$/.test(token) ? Number(token) : token.replace(/^(?:"|')|(?:"|')$/g, ''));
    return _match;
  });
  return tokens;
}

function pathFromTokens(tokens) {
  return tokens.reduce((path, token) => joinPath(path, token), '');
}

function joinPath(base, key) {
  if (base === '') return typeof key === 'number' ? `[${key}]` : String(key);
  return typeof key === 'number' ? `${base}[${key}]` : `${base}.${key}`;
}

function readPath(root, path) {
  return tokenize(path).reduce((value, key) => value == null ? undefined : value[key], root);
}

function inferType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value === 'object' ? 'object' : typeof value;
}

function semanticControl(name, rule, value) {
  if (rule?.enum) return 'enum';
  if (/capabilit(?:y|ies)$/i.test(name) || /strategyId$/i.test(name)) return 'capability';
  if (/^(?:do|actions?|actionId)$/i.test(name) || /action$/i.test(name)) return 'action';
  if (/(?:Ref|Refs|Id|Ids)$/i.test(name) && !/^id$/i.test(name)) return 'ref';
  const type = rule?.type || inferType(value);
  if (type === 'object') return 'object';
  if (type === 'array') return 'array';
  return 'scalar';
}

/**
 * 从运行时 ContentValidator 的同一 schema registry 生成无损字段模型。
 * 它只向共享 CanonicalDocumentModel 提交 path patch，不持有第二份文档或历史。
 */
export class SchemaFieldEditor {
  constructor({ registry, documentModel, schemaId, rootPath = '', catalogs = {}, consumptionRegistry = null } = {}) {
    if (!registry || typeof registry.getSchema !== 'function') throw new TypeError('SchemaFieldEditor requires runtime schema registry');
    if (!documentModel || typeof documentModel.patchMany !== 'function') throw new TypeError('SchemaFieldEditor requires CanonicalDocumentModel');
    if (!schemaId) throw new TypeError('SchemaFieldEditor requires schemaId');
    this.registry = registry;
    this.documentModel = documentModel;
    this.schemaId = schemaId;
    this.rootPath = rootPath;
    this.catalogs = catalogs;
    this.consumptionRegistry = consumptionRegistry;
  }

  getValue(path = '') {
    return clone(readPath(this.documentModel.getCandidate(), this._absolute(path)));
  }

  describe(path = '') {
    const absolutePath = this._absolute(path);
    const value = readPath(this.documentModel.getCandidate(), absolutePath);
    return this._describeValue(value, this._ruleFor(path), path, this._schemaFor(path));
  }

  patch(path, value, options) {
    this._assertStableAssetIdentity([{ path, value, op: options?.op || 'set' }]);
    return this.documentModel.patch(this._absolute(path), clone(value), options);
  }

  patchMany(operations) {
    this._assertStableAssetIdentity(operations);
    return this.documentModel.patchMany(operations.map(operation => ({
      ...operation,
      path: this._absolute(operation.path),
      value: clone(operation.value)
    })));
  }

  setNull(path) { return this.patch(path, null); }
  remove(path) { return this.patch(path, undefined, { op: 'delete' }); }
  append(path, value) {
    const current = this.getValue(path);
    if (!Array.isArray(current)) throw new TypeError(`SchemaFieldEditor append target is not array: ${path}`);
    return this.patch(path, [...current, clone(value)]);
  }
  move(path, fromIndex, toIndex) {
    const current = this.getValue(path);
    if (!Array.isArray(current)) throw new TypeError(`SchemaFieldEditor move target is not array: ${path}`);
    if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) {
      throw new RangeError(`SchemaFieldEditor array index out of range: ${path}`);
    }
    const next = current.slice();
    const [entry] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, entry);
    return this.patch(path, next);
  }

  setStableAssetId(path, value) {
    return this.patchMany([
      { path: joinPath(path, 'assetId'), value },
      { path: joinPath(path, 'imageId'), value }
    ]);
  }

  proveConsumption(sources, requirements, options = {}) {
    if (!this.consumptionRegistry) throw new TypeError('SchemaFieldEditor requires ConfigConsumptionRegistry for consumption proof');
    return this.consumptionRegistry.buildSources(sources, { ...options, requirements });
  }

  render(container, { path = '', onChange = null } = {}) {
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('SchemaFieldEditor.render requires DOM container');
    const doc = container.ownerDocument || document;
    const build = descriptor => {
      const wrapper = doc.createElement(descriptor.control === 'object' ? 'fieldset' : 'div');
      wrapper.dataset.schemaPath = descriptor.path;
      wrapper.dataset.control = descriptor.control;
      const label = doc.createElement(descriptor.control === 'object' ? 'legend' : 'label');
      label.textContent = descriptor.name;
      wrapper.append(label);

      if (descriptor.control === 'object' || descriptor.control === 'array') {
        descriptor.children.forEach(child => wrapper.append(build(child)));
        if (descriptor.control === 'array') {
          const add = doc.createElement('button');
          add.type = 'button'; add.textContent = '+';
          add.addEventListener('click', () => { this.append(descriptor.path, null); onChange?.(descriptor.path, this.getValue(descriptor.path)); });
          wrapper.append(add);
        }
      } else {
        const values = descriptor.enumValues || descriptor.referenceValues;
        const input = values ? doc.createElement('select') : doc.createElement('input');
        if (values) {
          for (const entry of values) {
            const option = doc.createElement('option');
            option.value = typeof entry === 'object' ? entry.id : entry;
            option.textContent = typeof entry === 'object' ? entry.name || entry.id : entry;
            input.append(option);
          }
          input.value = descriptor.value ?? '';
        } else if (descriptor.valueType === 'boolean') {
          input.type = 'checkbox'; input.checked = descriptor.value;
        } else {
          input.type = ['number', 'integer'].includes(descriptor.valueType) ? 'number' : 'text';
          input.value = descriptor.value ?? '';
        }
        input.addEventListener('change', () => {
          let value = input.type === 'checkbox' ? input.checked : input.value;
          if (input.type === 'number') value = input.value === '' ? null : Number(input.value);
          this.patch(descriptor.path, value);
          onChange?.(descriptor.path, value);
        });
        wrapper.append(input);
      }
      if (descriptor.nullable && descriptor.path) {
        const setNull = doc.createElement('button');
        setNull.type = 'button'; setNull.textContent = 'null';
        setNull.addEventListener('click', () => { this.setNull(descriptor.path); onChange?.(descriptor.path, null); });
        wrapper.append(setNull);
      }
      if (!descriptor.required && descriptor.present && descriptor.path) {
        const remove = doc.createElement('button');
        remove.type = 'button'; remove.textContent = '缺失';
        remove.addEventListener('click', () => { this.remove(descriptor.path); onChange?.(descriptor.path, undefined); });
        wrapper.append(remove);
      }
      return wrapper;
    };
    container.replaceChildren(build(this.describe(path)));
    return container;
  }

  _absolute(path) {
    if (!this.rootPath) return String(path || '');
    return path === '' || path == null ? this.rootPath : joinPath(this.rootPath, path);
  }

  _schemaFor(path) {
    let schema = this.registry.getSchema(this.schemaId);
    const tokens = tokenize(path);
    for (let index = 0; schema && index < tokens.length; index++) {
      const token = tokens[index];
      if (typeof token === 'number') continue;
      const rule = schema.fields?.[token];
      if (!rule) return null;
      const nextSchemaId = rule.schema || rule.itemSchema;
      schema = nextSchemaId ? this.registry.getSchema(nextSchemaId) : null;
    }
    return schema;
  }

  _ruleFor(path) {
    const tokens = tokenize(path);
    if (tokens.length === 0) return { type: 'object', schema: this.schemaId, required: true };
    let schema = this.registry.getSchema(this.schemaId);
    let rule = null;
    for (const token of tokens) {
      if (typeof token === 'number') continue;
      rule = schema?.fields?.[token] || null;
      schema = rule?.schema || rule?.itemSchema ? this.registry.getSchema(rule.schema || rule.itemSchema) : null;
    }
    return rule;
  }

  _describeValue(value, rule, path, schema) {
    const tokens = tokenize(path);
    const name = tokens.length ? String(tokens[tokens.length - 1]) : this.schemaId;
    const parentPath = tokens.length > 0 ? tokens.slice(0, -1) : [];
    const parent = readPath(this.getValue(''), parentPath);
    const present = tokens.length === 0 || (parent != null && own(parent, tokens[tokens.length - 1]));
    const control = semanticControl(name, rule, value);
    const descriptor = {
      name, path, schemaId: schema?.id || rule?.schema || rule?.itemSchema || null,
      control, controls: [!rule?.required ? 'optional' : null, rule?.nullable ? 'nullable' : null, control].filter(Boolean),
      present, required: rule?.required === true, nullable: rule?.nullable === true,
      value: clone(value), valueType: inferType(value), enumValues: clone(rule?.enum || null),
      referenceValues: clone(this.catalogs[name] || this.catalogs[rule?.ref] || null), children: []
    };
    if (control === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = new Set([...Object.keys(schema?.fields || {}), ...Object.keys(value)]);
      descriptor.children = [...keys].map(key => {
        const childRule = schema?.fields?.[key] || null;
        const childSchema = childRule?.schema ? this.registry.getSchema(childRule.schema) : null;
        return this._describeValue(value[key], childRule, joinPath(path, key), childSchema);
      });
    } else if (control === 'array' && Array.isArray(value)) {
      const childSchema = rule?.itemSchema ? this.registry.getSchema(rule.itemSchema) : null;
      descriptor.children = value.map((entry, index) => this._describeValue(
        entry, rule?.itemType ? { type: rule.itemType } : null, joinPath(path, index), childSchema
      ));
    }
    return Object.freeze(descriptor);
  }

  _assertStableAssetIdentity(operations) {
    const candidate = this.documentModel.getCandidate();
    const pending = new Map(operations.map(operation => [String(operation.path), operation]));
    for (const operation of operations) {
      const tokens = tokenize(operation.path);
      const field = tokens.at(-1);
      if (field !== 'assetId' && field !== 'imageId' || operation.op === 'delete') continue;
      const sibling = field === 'assetId' ? 'imageId' : 'assetId';
      const siblingPath = joinPath(pathFromTokens(tokens.slice(0, -1)), sibling);
      const pendingSibling = pending.get(siblingPath);
      const existingSibling = readPath(this.getValue(''), siblingPath);
      if (pendingSibling && pendingSibling.value === operation.value) continue;
      if (existingSibling !== undefined && existingSibling !== operation.value) {
        throw new TypeError(`assetId/imageId 必须保持相同: ${operation.path}`);
      }
    }
  }
}

export default SchemaFieldEditor;
