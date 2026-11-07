# Checklist：灵魂复活弹窗手柄焦点与左摇杆切换

- [x] 焦点解析：`selectedId → focusId → 首个非 cancel → choices[0]`，灵魂快照聚焦「复活」
- [x] 打开即武装摇杆导航，偏置作首帧基线（不误切换、不连发）
- [x] 松手后再推左/右可切换，循环正确
- [x] 十字键左右同样可用；A 确认 / B 取消不变
- [x] compact 不启用键盘 A/D（世界移动不冲突）；非 compact 键盘左右保持可用
- [x] `npx vitest run src/ui/IrreversibleChoiceView.test.js` 7/7
- [x] `npx vitest run src/ui src/core/scene src/core/input` 无新增失败（既有 `GamepadManager` 十字键用例失败与本次无关）
- [x] 实机探针 `scripts/probe-soul-revive-gamepad.mjs` PASS
