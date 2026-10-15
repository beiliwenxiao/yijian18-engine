# 实现计划：UI 点击阻止角色移动

## 概述

本实现计划将 UI 点击阻止功能分解为一系列增量式的编码任务。每个任务都建立在前一个任务的基础上，确保代码逐步集成，没有孤立或未连接的代码。

## 任务

- [x] 1. 创建 UIClickHandler 核心类
  - 创建 `src/core/UIClickHandler.js` 文件
  - 实现 UI 元素注册和注销功能
  - 实现按 z-index 排序功能
  - 实现基本的碰撞检测（hitTest）方法
  - 添加 JSDoc 注释
  - _需求：4.1, 4.2, 4.4_

- [ ]* 1.1 为 UIClickHandler 编写单元测试
  - 创建 `src/core/UIClickHandler.test.js` 文件
  - 测试注册和注销功能
  - 测试 z-index 排序
  - 测试碰撞检测
  - _需求：4.1, 4.2, 4.4_

- [x] 2. 实现 UIClickHandler 的点击处理逻辑
  - 实现 `handleClick` 方法
  - 实现 `isUIAtPosition` 方法
  - 添加性能优化（只检查可见元素）
  - 添加早期退出逻辑（一旦处理就停止）
  - _需求：4.1, 4.3, 7.1, 7.3_

- [ ]* 2.1 为点击处理逻辑编写单元测试
  - 测试 handleClick 方法
  - 测试 isUIAtPosition 方法
  - 测试性能优化逻辑
  - _需求：4.1, 4.3, 7.1, 7.3_

- [x] 3. 扩展 InputManager 添加事件处理标记
  - 在 `src/core/InputManager.js` 中添加 `mouse.handled` 属性
  - 实现 `markMouseClickHandled` 方法
  - 实现 `isMouseClickHandled` 方法
  - 在 `update` 方法中重置 `handled` 标记
  - _需求：5.1, 5.2, 5.3_

- [ ]* 3.1 为 InputManager 扩展编写单元测试
  - 测试事件处理标记功能
  - 测试标记清除功能
  - 测试状态查询功能
  - _需求：5.1, 5.2, 5.3_

- [x] 4. 扩展 UIElement 基类添加点击处理接口
  - 在 `src/ui/UIElement.js` 中添加 `handleMouseClick` 方法
  - 添加 `isPointInside` 辅助方法
  - 提供默认实现（点击在范围内即认为已处理）
  - 添加 JSDoc 注释
  - _需求：1.1, 1.2_

- [ ]* 4.1 为 UIElement 扩展编写单元测试
  - 测试 handleMouseClick 方法
  - 测试 isPointInside 方法
  - 测试默认实现
  - _需求：1.1, 1.2_

- [x] 5. 更新 InventoryPanel 实现点击处理
  - 在 `src/ui/InventoryPanel.js` 中重写 `handleMouseClick` 方法
  - 确保点击物品槽、按钮、右键菜单时返回 true
  - 确保点击面板外时返回 false
  - 保持现有的点击处理逻辑不变
  - _需求：1.1, 1.2, 3.1, 3.2_

- [ ]* 5.1 为 InventoryPanel 点击处理编写单元测试
  - 测试点击物品槽
  - 测试点击过滤按钮
  - 测试点击右键菜单
  - 测试点击面板外
  - _需求：1.1, 1.2, 3.1, 3.2_

- [x] 6. 更新 EquipmentPanel 实现点击处理
  - 在 `src/prologue/ui/EquipmentPanel.js` 中重写 `handleMouseClick` 方法
  - 确保点击装备槽时返回 true
  - 确保点击面板外时返回 false
  - _需求：1.1, 1.2_

- [ ]* 6.1 为 EquipmentPanel 点击处理编写单元测试
  - 测试点击装备槽
  - 测试点击面板外
  - _需求：1.1, 1.2_

- [x] 7. 更新 PlayerInfoPanel 实现点击处理
  - 在 `src/ui/PlayerInfoPanel.js` 中重写 `handleMouseClick` 方法
  - 确保点击面板内任何位置时返回 true
  - 确保点击面板外时返回 false
  - _需求：1.1, 1.2_

- [ ]* 7.1 为 PlayerInfoPanel 点击处理编写单元测试
  - 测试点击面板内
  - 测试点击面板外
  - _需求：1.1, 1.2_

- [x] 8. 集成 UIClickHandler 到 Act1SceneECS
  - 在 `src/prologue/scenes/Act1SceneECS.js` 中导入 UIClickHandler
  - 在构造函数中创建 UIClickHandler 实例
  - 在 `enter` 方法中注册所有 UI 元素
  - 在 `update` 方法中，在处理 UI 面板点击之前调用 UIClickHandler
  - 如果 UIClickHandler 处理了点击，调用 `markMouseClickHandled`
  - 移除现有的 `uiHandledClick` 逻辑，使用新的 UIClickHandler
  - _需求：1.1, 1.2, 1.3, 4.1, 4.3_

- [x] 9. 更新 MovementSystem 检查事件处理标记
  - 在 `src/systems/MovementSystem.js` 中修改点击移动逻辑
  - 在处理点击前检查 `isMouseClickHandled`
  - 只有当点击未被处理时才响应移动
  - _需求：1.3, 5.3_

- [ ]* 9.1 为 MovementSystem 修改编写单元测试
  - 测试点击已被处理时不移动
  - 测试点击未被处理时正常移动
  - _需求：1.3, 5.3_

- [x] 10. 添加教程提示框点击检测
  - 在 `src/prologue/systems/TutorialSystem.js` 中添加 `isPointInside` 方法
  - 在 Act1SceneECS 的 update 方法中检查教程提示框
  - 如果点击在教程提示框内，标记为已处理
  - _需求：2.1, 2.2, 2.3_

- [ ]* 10.1 为教程提示框点击检测编写单元测试
  - 测试点击教程提示框内
  - 测试点击教程提示框外
  - 测试教程提示框不可见时
  - _需求：2.1, 2.2, 2.3_

- [x] 11. 检查点 - 确保所有测试通过
  - 运行所有单元测试
  - 确保没有回归问题
  - 如有问题，向用户询问

- [ ]* 12. 编写属性测试 - UI 点击阻止传播
  - 创建 `src/core/UIClickHandler.property.test.js` 文件
  - **属性 1：UI 点击阻止传播**
  - 生成随机 UI 元素和点击位置
  - 验证点击在 UI 内时不传播到移动系统
  - 配置至少 100 次迭代
  - _需求：1.1, 1.2_

- [ ]* 13. 编写属性测试 - 非 UI 点击正常传播
  - **属性 2：非 UI 点击正常传播**
  - 生成随机 UI 元素和点击位置
  - 验证点击在 UI 外时正常传播
  - 配置至少 100 次迭代
  - _需求：1.3_

- [ ]* 14. 编写属性测试 - Z-Index 优先级
  - **属性 3：Z-Index 优先级**
  - 生成随机重叠的 UI 元素
  - 验证高 z-index 元素优先处理
  - 配置至少 100 次迭代
  - _需求：1.4, 4.4_

- [ ]* 15. 编写属性测试 - 不可见元素不参与检测
  - **属性 4：不可见元素不参与检测**
  - 生成随机 UI 元素（部分不可见）
  - 验证不可见元素不参与检测
  - 配置至少 100 次迭代
  - _需求：1.5_

- [ ]* 16. 编写属性测试 - 事件处理标记一致性
  - **属性 5：事件处理标记一致性**
  - 生成随机点击事件
  - 验证处理后标记状态正确
  - 配置至少 100 次迭代
  - _需求：5.1, 5.2_

- [x] 17. 创建集成测试页面
  - 创建 `test/test-ui-click-blocking.html` 文件
  - 设置包含多个 UI 元素的测试场景
  - 添加可视化调试（显示点击位置和 UI 碰撞框）
  - 添加测试说明和交互提示
  - _需求：1.1, 1.2, 1.3_

- [ ] 18. 最终检查点 - 完整功能验证
  - 运行所有单元测试和属性测试
  - 手动测试所有 UI 面板的点击行为
  - 验证角色移动逻辑正常
  - 检查性能（帧率）
  - 如有问题，向用户询问

## 注意事项

- 标记为 `*` 的任务是可选的测试任务，可以跳过以加快 MVP 开发
- 每个任务都引用了具体的需求编号，确保可追溯性
- 任务按照依赖关系排序，确保增量开发
- 检查点任务确保在关键阶段进行验证
- 属性测试任务用于验证通用正确性属性
- 单元测试任务用于验证具体实现细节
