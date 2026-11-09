import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom 重渲染型用例（任务向导/场景编辑器，单次 detail 渲染 ~15 万字符）在多 worker
    // 并发高压下可能超过默认 5s；正常路径不受影响，仅放宽病态慢跑的超时上限。
    testTimeout: 20000,
    hookTimeout: 20000,
    // editor 套件 17 个 jsdom 文件并发时（内存/CPU 高压）出现跨文件漂移的偶发失败
    //（localStorage/vi 未定义、超时——单跑全部稳定），改顺序跑文件消除压力竞态。
    fileParallelism: false,
    // Temp/ 存放历史基线快照副本（如 baseline-wt），其过时测试副本不应被 vitest
    // 子串匹配收集（曾导致 HostBackendDefaults 等以旧版断言误报失败）。
    // 末尾三条是 node:test 套件（import { describe, it } from 'node:test'），
    // 与 vitest 的收集器不兼容（收集到会报「测试套件为空」），它们用
    // `node --test test/s02*.test.js` 单独运行。
    exclude: [
      '**/node_modules/**',
      '**/Temp/**',
      '**/dist/**',
      '**/waitdel/**',
      'test/s02ArmyPossession.test.js',
      'test/s02WoundDebuff.test.js',
      'test/s02ZhangjiaoSkills.test.js'
    ]
  }
});
