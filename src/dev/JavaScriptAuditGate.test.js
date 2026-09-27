import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { auditTrackedJavaScript, compareJavaScriptAuditSnapshots, countPhysicalLines, createJavaScriptAuditSnapshot } from './JavaScriptAuditGate.js';

const hash = source => crypto.createHash('sha256').update(source).digest('hex');

function audit(files, exceptions = []) {
  return auditTrackedJavaScript({
    root: process.cwd(),
    paths: Object.keys(files),
    readFile: file => files[file],
    exceptionManifest: { exceptions }
  });
}

describe('JavaScriptAuditGate', () => {
  it('counts every physical line, including empty lines and comments', () => {
    expect(countPhysicalLines('// one\n\n// three\n')).toBe(4);
    const report = audit({ 'src/systems/LineCounter.js': '// one\n\n// three\n' });
    expect(report.units[0]).toMatchObject({ physicalLines: 4, responsibility: 'businessLogic' });
  });

  it('uses tracked scope and reports inclusion and exclusion reasons', () => {
    const report = audit({
      'src/systems/Active.js': 'export const active = true;\n',
      'editor/index.html': '<script>window.boot = true;</script>',
      'test/a.test.js': 'throw new Error();',
      'example/sanguo_zhangjiao/data/content.js': 'export default {};',
      'desktop/main.js': 'console.log(1);',
      'dist/out.js': 'console.log(1);',
      'docs/guide.js': 'console.log(1);'
    });
    expect(report.included.map(entry => entry.file)).toEqual(['editor/index.html', 'src/systems/Active.js']);
    expect(report.units.find(unit => unit.file === 'editor/index.html#script:1')).toMatchObject({
      physicalLines: 1,
      responsibility: 'editorInteraction'
    });
    expect(report.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'test/a.test.js', reason: 'test source' }),
      expect.objectContaining({ file: 'desktop/main.js' }),
      expect.objectContaining({ file: 'dist/out.js' }),
      expect.objectContaining({ file: 'docs/guide.js' })
    ]));
  });

  it('classifies execution units into exactly one permitted responsibility', () => {
    const report = audit({
      'src/core/SceneGameplaySystemAssembler.js': 'export const make = () => ({});',
      'src/systems/QuestTransactionService.js': 'export const apply = () => ({});',
      'src/ui/QuestPanel.js': 'export const render = () => ({});',
      'editor/SceneEditorInteraction.js': 'export const bind = () => ({});'
    });
    expect(report.units.map(unit => unit.responsibility)).toEqual([
      'editorInteraction', 'assembly', 'businessLogic', 'presentation'
    ]);
    expect(report.units.every(unit => ['assembly', 'businessLogic', 'presentation', 'editorInteraction'].includes(unit.responsibility))).toBe(true);
  });

  it('finds responsibility-boundary violations and forbidden architecture shortcuts', () => {
    const report = audit({
      'src/systems/IllegalBusiness.js': 'document.querySelector("#app");\nnew Date();\nMath.random();\nif (online) {}',
      'src/ui/IllegalView.js': 'inventory.quantity = 1;',
      'editor/IllegalEditor.js': 'fetch("/api/save-file", { method: "POST" });\nstory.chapter = 2;',
      'src/core/IllegalAssembler.js': 'document.createElement("canvas");\nstats.hp = 1;',
      'src/systems/IllegalFlow.js': 'function S11Action() {}\nif (sceneId === "S11") {}\nsetTimeout(() => {}, 1);\nimport(modulePath);\nconst singleton = Singleton;\nsync(clientState);'
    });
    expect(report.violations.map(violation => violation.code)).toEqual(expect.arrayContaining([
      'business-dom-or-canvas-access',
      'direct-business-clock-or-random',
      'business-online-branch',
      'presentation-business-state-write',
      'editor-command-service-bypass',
      'editor-business-state-write',
      'assembly-presentation-overreach',
      'assembly-business-overreach',
      'content-named-handler',
      'content-flow-branch',
      'story-timer',
      'arbitrary-module-path',
      'singleton-or-service-locator',
      'whole-client-state-submit'
    ]));
  });

  it('ignores clock/random inside comments and injected-clock value positions, but still flags direct calls', () => {
    const report = audit({
      'src/systems/CommentOnly.js': [
        '// 结算禁止直接用 Math.random()/Date.now()，改用注入的 RNG：',
        '/* 例如 new Date() 与 Math.random() 的对比 */',
        'export function make(options = {}) {',
        '  this.now = options.now || (() => Date.now());',
        '  return this;',
        '}',
        ''
      ].join('\n'),
      'src/systems/StillRandom.js': 'export function roll() {\n  return Math.random();\n}\n'
    });
    expect(report.violations.filter(violation => violation.file === 'src/systems/CommentOnly.js')).toEqual([]);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'src/systems/StillRandom.js', code: 'direct-business-clock-or-random' })
    ]));
  });

  it('does not flag equality comparisons as state writes, but still flags real writes', () => {
    const report = audit({
      'src/ui/QuestCompareView.js': 'export const pick = quest => quest.state === "active" ? quest : null;',
      'src/ui/QuestWriteView.js': 'export const touch = quest => { quest.state = "active"; };'
    });
    expect(report.violations.filter(violation => violation.code === 'presentation-business-state-write'))
      .toEqual([expect.objectContaining({ file: 'src/ui/QuestWriteView.js' })]);
  });

  it('exempts HTML shell inline scripts from DOM rules but keeps state-write rules', () => {
    const report = audit({
      'example/sanguo_zhangjiao/shell.html': '<script type="module">\nconst canvas = document.getElementById("game");\nquest.state = "active";\n</script>'
    });
    expect(report.violations.filter(violation => violation.code === 'assembly-presentation-overreach')).toEqual([]);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'example/sanguo_zhangjiao/shell.html#script:1', code: 'assembly-business-overreach' })
    ]));
  });

  it('allows editor save-file calls that target editor/config paths only', () => {
    const report = audit({
      'editor/OwnConfigWriter.js': 'await fetch("/api/save-file", { method: "POST", body: JSON.stringify({ path: "editor/config/images.json" }) });',
      'editor/CanonicalWriter.js': 'await fetch("/api/canonical-transaction", { method: "POST" });'
    });
    expect(report.violations.filter(violation => violation.file === 'editor/OwnConfigWriter.js')).toEqual([]);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'editor/CanonicalWriter.js', code: 'editor-command-service-bypass' })
    ]));
  });

  it('reclassifies editor and platform infrastructure files out of business boundary rules', () => {
    const report = audit({
      'editor/SceneDataManager.js': 'const stamp = Date.now();\ndocument.title = "editor";',
      'src/network/WebSocketClient.js': 'this.lastPongTime = Date.now();\nsetInterval(() => {}, 1000);\ndocument.title = "net";',
      'src/core/snapshot/IndexedDBAdapter.js': 'updatedAt: Date.now(),',
      'src/platform/save/SaveStorageCore.js': 'const stamp = Date.now();\ndocument.getElementById("save-slots");',
      'src/core/RNG.js': 'this._state = (seed != null ? seed : (Date.now() >>> 0)) >>> 0;',
      'src/systems/StillBusiness.js': 'Math.random();'
    });
    const byFile = file => report.units.find(unit => unit.file === file);
    expect(byFile('editor/SceneDataManager.js')).toMatchObject({ responsibility: 'editorInteraction' });
    expect(byFile('src/network/WebSocketClient.js')).toMatchObject({ responsibility: 'platformInfra' });
    expect(byFile('src/core/snapshot/IndexedDBAdapter.js')).toMatchObject({ responsibility: 'platformInfra' });
    expect(byFile('src/platform/save/SaveStorageCore.js')).toMatchObject({ responsibility: 'platformInfra' });
    expect(byFile('src/core/RNG.js')).toMatchObject({ responsibility: 'platformInfra' });
    expect(report.violations.filter(violation => violation.file !== 'src/systems/StillBusiness.js'
      && violation.code !== 'line-limit-or-invalid-exception')).toEqual([]);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'src/systems/StillBusiness.js', code: 'direct-business-clock-or-random' })
    ]));
  });

  it('flags only hardcoded content comparisons as content-flow branches', () => {
    const report = audit({
      'src/systems/ContentFlow.js': [
        'if (sceneId === target.sceneId) {}',
        'switch (stage) { case nextStage: break; }',
        'if (sceneId === "S01") {}',
        'switch (stage) { case "S02": break; }'
      ].join('\n')
    });
    expect(report.violations.filter(violation => violation.code === 'content-flow-branch')).toHaveLength(2);
  });

  it('keeps editor index scripts as editorInteraction and excludes dev tooling', () => {
    const report = audit({
      'editor/guide.html': '<script>export const guide = 1;</script>',
      'src/dev/Tool.js': 'Math.random();'
    });
    expect(report.units.find(unit => unit.file === 'editor/guide.html#script:1'))
      .toMatchObject({ responsibility: 'editorInteraction' });
    expect(report.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'src/dev/Tool.js', reason: 'dev tooling source' })
    ]));
    expect(report.units.find(unit => unit.file === 'src/dev/Tool.js')).toBeUndefined();
  });


  it('does not flag method definitions named import/require/getInstance', () => {
    const report = audit({
      'editor/CommandService.js': 'import(projectPath, payload) { return this.execute("import", projectPath, payload); }',
      'src/systems/Registry.js': 'require(id) {}\ngetInstance(instanceId) { return null; }'
    });
    expect(report.violations).toEqual([]);
  });

  it('exempts only the listed violation codes when a codes array is provided', () => {
    const source = 'function S11Action() {}\nMath.random();\n';
    const exception = {
      file: 'src/systems/LegacyFlow.js',
      evidence: 'transitional content-engine handler',
      lines: 3,
      responsibility: 'businessLogic',
      owner: 'beiliwenxiao',
      date: '2026-09-27',
      contentHash: hash(source),
      codes: ['content-named-handler']
    };
    const report = audit({ 'src/systems/LegacyFlow.js': source }, [exception]);
    expect(report.violations.some(violation => violation.code === 'content-named-handler')).toBe(false);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'direct-business-clock-or-random' })
    ]));
  });

  it('accepts only exact external-contract exceptions and never exempts responsibility checks', () => {
    const oversized = Array.from({ length: 1001 }, () => '// contract line').join('\n');
    const validException = {
      file: 'src/systems/ExternalContract.js',
      evidence: 'https://example.invalid/external-contract',
      lines: 1001,
      responsibility: 'businessLogic',
      owner: 'architecture-owner',
      date: '2026-08-14',
      contentHash: hash(oversized)
    };
    const accepted = audit({ 'src/systems/ExternalContract.js': oversized }, [validException]);
    expect(accepted.units[0].exception.status).toBe('valid');
    expect(accepted.violations.some(violation => violation.code === 'line-limit-or-invalid-exception')).toBe(false);

    const grown = audit({ 'src/systems/ExternalContract.js': `${oversized}\n// added` }, [validException]);
    expect(grown.units[0].exception).toMatchObject({ status: 'invalid' });
    expect(grown.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'line-limit-or-invalid-exception' })
    ]));

    const presentationSource = `${Array.from({ length: 1001 }, () => '// contract line').join('\n')}\ninventory.quantity = 2;`;
    const presentationException = {
      ...validException,
      file: 'src/ui/ExternalContractView.js',
      responsibility: 'presentation',
      lines: 1002,
      contentHash: hash(presentationSource)
    };
    const stillChecked = audit({ 'src/ui/ExternalContractView.js': presentationSource }, [presentationException]);
    expect(stillChecked.units[0].exception.status).toBe('valid');
    expect(stillChecked.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'presentation-business-state-write' })
    ]));
  });
});


describe('JavaScriptAuditGate hash snapshots', () => {
  it('records each audited executable unit and reports added, removed, and changed hashes', () => {
    const before = createJavaScriptAuditSnapshot({
      root: process.cwd(),
      paths: ['src/systems/A.js', 'src/systems/Removed.js'],
      readFile: file => ({
        'src/systems/A.js': 'export const value = 1;\n',
        'src/systems/Removed.js': 'export const removed = true;\n'
      })[file]
    });
    const after = createJavaScriptAuditSnapshot({
      root: process.cwd(),
      paths: ['src/systems/A.js', 'src/systems/Added.js'],
      readFile: file => ({
        'src/systems/A.js': 'export const value = 2;\n',
        'src/systems/Added.js': 'export const added = true;\n'
      })[file]
    });

    expect(before.hashes).toEqual(expect.objectContaining({ 'src/systems/A.js': expect.any(String) }));
    expect(compareJavaScriptAuditSnapshots(before, before)).toMatchObject({ equal: true, changeCount: 0 });
    expect(compareJavaScriptAuditSnapshots(before, after).changes).toEqual([
      expect.objectContaining({ file: 'src/systems/A.js', kind: 'changed' }),
      expect.objectContaining({ file: 'src/systems/Added.js', kind: 'added' }),
      expect.objectContaining({ file: 'src/systems/Removed.js', kind: 'removed' })
    ]);
  });
});