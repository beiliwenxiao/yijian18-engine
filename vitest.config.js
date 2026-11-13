import { defineConfig } from 'vitest/config';

// Temp/ 存放历史基线快照副本（如 baseline-wt），其过时测试副本不应被 vitest
// 子串匹配收集（曾导致 HostBackendDefaults 等以旧版断言误报失败）。
// 末尾三条是 node:test 套件（import { describe, it } from 'node:test'），
// 与 vitest 的收集器不兼容（收集到会报「测试套件为空」），它们用
// `node --test test/s02*.test.js` 单独运行。
const EXCLUDE = [
  '**/node_modules/**',
  '**/Temp/**',
  '**/dist/**',
  '**/waitdel/**',
  'test/s02ArmyPossession.test.js',
  'test/s02WoundDebuff.test.js',
  'test/s02ZhangjiaoSkills.test.js'
];

// 公共测试参数（projects 各自的 test 配置不继承根级 test 选项，故逐项显式声明）
// - testTimeout/hookTimeout 20000：jsdom 重渲染型用例（任务向导/场景编辑器，
//   单次 detail 渲染 ~15 万字符）在并发高压下可能超过默认 5s，仅放宽上限。
// - pool: 'forks'：实测 threads 池的 jsdom 环境更慢（同批 228s vs 170s），保持默认。
//
// jsdom 环境成本实测（2026-11-10）：`import('jsdom')` 在本机冷启动约 25~90s
// （`new JSDOM` 本身仅 0.14s，瓶颈是 jsdom 依赖图数百个 CJS 文件的首次加载）。
// 默认 pool 会为每个测试文件另起 worker 进程（实测 3 个文件 3 个不同 pid），
// 于是每个 jsdom 文件都要重付一次该成本（全量 environment 347s 的主因）。
// 解法：让同一项目的文件复用同一 worker 进程——editor 用 singleFork（本就要求串行），
// unit 靠 fileParallelism 的 worker 复用；进程内 jsdom 模块缓存命中后为 0~1ms。
// 不改变 use 例隔离语义（isolate 保持默认 true，每个文件仍是新环境）。
const shared = {
  exclude: EXCLUDE,
  testTimeout: 20000,
  hookTimeout: 20000,
  pool: 'forks'
};

export default defineConfig({
  test: {
    ...shared,
    projects: [
      {
        test: {
          ...shared,
          name: 'editor',
          // editor 套件 17 个 jsdom 文件并发时（内存/CPU 高压）出现跨文件漂移的
          // 偶发失败（localStorage/vi 未定义、超时——单跑全部稳定），故整个
          // editor 项目保持顺序跑文件；singleFork 让这 27 个文件复用同一个 worker
          // 进程，jsdom 只导入一次，而不是每个文件重启进程重付一次。
          include: ['editor/**/*.test.js'],
          fileParallelism: false,
          poolOptions: {
            forks: {
              singleFork: true
            }
          }
        }
      },
      {
        test: {
          ...shared,
          name: 'unit',
          include: ['src/**/*.test.js', 'test/**/*.test.js'],
          // 8 核机器留出余量给 editor 项目与外部进程：并发过高会把 editor 里
          // 重渲染型用例推过超时线（老竞态），不放大压力。
          fileParallelism: true,
          maxWorkers: 4
        }
      }
    ]
  }
});
