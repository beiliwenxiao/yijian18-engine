/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { Scene } from '../core/Scene.js';

/**
 * 角色选择场景
 * 处理角色创建和选择
 */
export class CharacterScene extends Scene {
    constructor(engine = null) {
        super('Character');
        this.engine = engine;
        
        // 场景状态
        this.mode = 'list'; // 'list' 或 'create'
        
        // 角色列表（模拟数据）
        this.characters = [];
        
        // 角色创建表单
        this.createForm = {
            nameInput: '',
            selectedClass: 'warrior', // 'warrior', 'strategist', 'archer'
            isInputActive: false,
            cursorBlink: 0
        };
        
        // 职业信息
        this.classes = {
            warrior: {
                name: '战士',
                description: '近战物理攻击，高生命值和防御',
                color: '#ff6b6b'
            },
            strategist: {
                name: '军师',
                description: '战场谋略与符阵辅助，擅长范围控制',
                color: '#4a9eff'
            },
            archer: {
                name: '弓箭手',
                description: '远程物理攻击，高敏捷和暴击',
                color: '#51cf66'
            }
        };
        
        // UI按钮
        this.buttons = {
            createNew: { x: 0, y: 0, width: 200, height: 50, text: '创建新角色', hovered: false },
            back: { x: 0, y: 0, width: 150, height: 50, text: '返回', hovered: false },
            confirm: { x: 0, y: 0, width: 150, height: 50, text: '确认创建', hovered: false },
            cancel: { x: 0, y: 0, width: 150, height: 50, text: '取消', hovered: false }
        };
        
        // 职业选择按钮
        this.classButtons = [];
        
        // 错误信息
        this.errorMessage = '';
        this.errorTime = 0;
    }

    /**
     * 场景进入
     */
    enter(data = null) {
        super.enter(data);
        
        // 重置状态
        this.mode = 'list';
        this.errorMessage = '';
        this.createForm.nameInput = '';
        this.createForm.selectedClass = 'warrior';
        
        // 加载角色列表（模拟数据）
        this.loadCharacters();
    }

    /**
     * 加载角色列表
     */
    loadCharacters() {
        // 模拟已有角色数据
        this.characters = [
            {
                id: '1',
                name: '测试战士',
                class: 'warrior',
                level: 5
            }
        ];
    }

    /**
     * 更新场景
     */
    update(deltaTime) {
        // 更新光标闪烁
        if (this.createForm.isInputActive) {
            this.createForm.cursorBlink += deltaTime;
        }
        
        // 更新错误消息显示时间
        if (this.errorMessage) {
            this.errorTime += deltaTime;
            if (this.errorTime > 3) {
                this.errorMessage = '';
                this.errorTime = 0;
            }
        }
    }

    /**
     * 渲染场景
     */
    render(ctx) {
        const canvas = ctx.canvas;

        // 绘制背景
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (this.mode === 'list') {
            this.renderCharacterList(ctx);
        } else if (this.mode === 'create') {
            this.renderCharacterCreate(ctx);
        }

        // 绘制错误消息
        if (this.errorMessage) {
            this.renderErrorMessage(ctx);
        }
    }

    /**
     * 渲染角色列表
     */
    renderCharacterList(ctx) {
        const canvas = ctx.canvas;
        const centerX = canvas.width / 2;

        // 标题
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('选择角色', centerX, 100);

        // 角色列表
        const startY = 200;
        const itemHeight = 80;
        
        if (this.characters.length === 0) {
            ctx.fillStyle = '#888888';
            ctx.font = '24px Arial';
            ctx.fillText('暂无角色，请创建新角色', centerX, startY + 50);
        } else {
            this.characters.forEach((char, index) => {
                const y = startY + index * itemHeight;
                this.renderCharacterItem(ctx, char, centerX, y, index);
            });
        }

        // 创建新角色按钮
        const btnY = startY + this.characters.length * itemHeight + 50;
        this.buttons.createNew.x = centerX - this.buttons.createNew.width / 2;
        this.buttons.createNew.y = btnY;
        this.renderButton(ctx, this.buttons.createNew);

        // 返回按钮
        this.buttons.back.x = 50;
        this.buttons.back.y = canvas.height - 80;
        this.renderButton(ctx, this.buttons.back);
    }

    /**
     * 渲染角色项
     */
    renderCharacterItem(ctx, character, centerX, y, index) {
        const width = 600;
        const height = 60;
        const x = centerX - width / 2;
        
        // 检查鼠标悬停
        const mousePos = this.engine?.inputManager?.getMousePosition() || { x: 0, y: 0 };
        const hovered = mousePos.x >= x && mousePos.x <= x + width &&
                       mousePos.y >= y && mousePos.y <= y + height;

        // 背景
        ctx.fillStyle = hovered ? '#2a2a4e' : '#1e1e3e';
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;
        this.roundRect(ctx, x, y, width, height, 8);
        ctx.fill();
        ctx.stroke();

        // 职业颜色标记
        const classColor = this.classes[character.class]?.color || '#ffffff';
        ctx.fillStyle = classColor;
        ctx.fillRect(x + 10, y + 10, 5, height - 20);

        // 角色信息
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(character.name, x + 30, y + 25);

        ctx.fillStyle = '#aaaaaa';
        ctx.font = '18px Arial';
        const className = this.classes[character.class]?.name || character.class;
        ctx.fillText(`${className} - 等级 ${character.level}`, x + 30, y + 48);

        // 存储点击区域
        character._clickArea = { x, y, width, height };
    }

    /**
     * 渲染角色创建界面
     */
    renderCharacterCreate(ctx) {
        const canvas = ctx.canvas;
        const centerX = canvas.width / 2;

        // 标题
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('创建角色', centerX, 100);

        // 角色名称输入
        this.renderNameInput(ctx, centerX, 200);

        // 职业选择
        this.renderClassSelection(ctx, centerX, 320);

        // 确认和取消按钮
        this.buttons.confirm.x = centerX - 170;
        this.buttons.confirm.y = canvas.height - 120;
        this.renderButton(ctx, this.buttons.confirm);

        this.buttons.cancel.x = centerX + 20;
        this.buttons.cancel.y = canvas.height - 120;
        this.renderButton(ctx, this.buttons.cancel);
    }

    /**
     * 渲染名称输入框
     */
    renderNameInput(ctx, centerX, y) {
        const width = 400;
        const height = 50;
        const x = centerX - width / 2;

        // 标签
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('角色名称:', x, y - 10);

        // 输入框背景
        ctx.fillStyle = this.createForm.isInputActive ? '#2a2a4e' : '#1e1e3e';
        ctx.strokeStyle = this.createForm.isInputActive ? '#4a9eff' : '#666666';
        ctx.lineWidth = 2;
        this.roundRect(ctx, x, y, width, height, 5);
        ctx.fill();
        ctx.stroke();

        // 输入文本
        ctx.fillStyle = '#ffffff';
        ctx.font = '24px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const text = this.createForm.nameInput || '';
        ctx.fillText(text, x + 15, y + height / 2);

        // 光标
        if (this.createForm.isInputActive && Math.floor(this.createForm.cursorBlink * 2) % 2 === 0) {
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = '#4a9eff';
            ctx.fillRect(x + 15 + textWidth + 2, y + 10, 2, height - 20);
        }

        // 占位符
        if (!text && !this.createForm.isInputActive) {
            ctx.fillStyle = '#666666';
            ctx.fillText('请输入角色名称 (2-12个字符)', x + 15, y + height / 2);
        }

        // 存储点击区域
        this.createForm._inputArea = { x, y, width, height };
    }

    /**
     * 渲染职业选择
     */
    renderClassSelection(ctx, centerX, y) {
        // 标签
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('选择职业:', centerX, y - 10);

        // 职业按钮
        const classKeys = Object.keys(this.classes);
        const buttonWidth = 180;
        const buttonHeight = 120;
        const spacing = 20;
        const totalWidth = classKeys.length * buttonWidth + (classKeys.length - 1) * spacing;
        const startX = centerX - totalWidth / 2;

        this.classButtons = [];

        classKeys.forEach((classKey, index) => {
            const classInfo = this.classes[classKey];
            const x = startX + index * (buttonWidth + spacing);
            const selected = this.createForm.selectedClass === classKey;

            // 检查鼠标悬停
            const mousePos = this.engine?.inputManager?.getMousePosition() || { x: 0, y: 0 };
            const hovered = mousePos.x >= x && mousePos.x <= x + buttonWidth &&
                           mousePos.y >= y && mousePos.y <= y + buttonHeight;

            // 背景
            ctx.fillStyle = selected ? classInfo.color : (hovered ? '#2a2a4e' : '#1e1e3e');
            ctx.strokeStyle = selected ? '#ffffff' : classInfo.color;
            ctx.lineWidth = selected ? 3 : 2;
            this.roundRect(ctx, x, y, buttonWidth, buttonHeight, 8);
            ctx.fill();
            ctx.stroke();

            // 职业名称
            ctx.fillStyle = selected ? '#ffffff' : classInfo.color;
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(classInfo.name, x + buttonWidth / 2, y + 30);

            // 职业描述
            ctx.fillStyle = selected ? '#ffffff' : '#aaaaaa';
            ctx.font = '14px Arial';
            const words = classInfo.description.split('，');
            words.forEach((word, i) => {
                ctx.fillText(word, x + buttonWidth / 2, y + 60 + i * 20);
            });

            // 存储点击区域
            this.classButtons.push({
                classKey,
                x,
                y,
                width: buttonWidth,
                height: buttonHeight
            });
        });
    }

    /**
     * 渲染按钮
     */
    renderButton(ctx, button) {
        // 背景
        ctx.fillStyle = button.hovered ? '#5aa9ff' : '#4a9eff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        this.roundRect(ctx, button.x, button.y, button.width, button.height, 8);
        ctx.fill();
        ctx.stroke();

        // 文字
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(button.text, button.x + button.width / 2, button.y + button.height / 2);
    }

    /**
     * 渲染错误消息
     */
    renderErrorMessage(ctx) {
        const canvas = ctx.canvas;
        const centerX = canvas.width / 2;
        const y = 150;

        ctx.fillStyle = 'rgba(255, 68, 68, 0.9)';
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        this.roundRect(ctx, centerX - 200, y, 400, 50, 5);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.errorMessage, centerX, y + 25);
    }

    /**
     * 绘制圆角矩形
     */
    roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    /**
     * 处理输入
     */
    handleInput(inputManager) {
        const mousePos = inputManager.getMousePosition();

        if (this.mode === 'list') {
            this.handleListInput(inputManager, mousePos);
        } else if (this.mode === 'create') {
            this.handleCreateInput(inputManager, mousePos);
        }
    }

    /**
     * 处理列表模式输入
     */
    handleListInput(inputManager, mousePos) {
        // 检查按钮悬停
        this.buttons.createNew.hovered = this.isPointInButton(mousePos, this.buttons.createNew);
        this.buttons.back.hovered = this.isPointInButton(mousePos, this.buttons.back);

        // 检查点击
        if (inputManager.isMouseClicked()) {
            if (this.buttons.createNew.hovered) {
                this.mode = 'create';
                this.createForm.isInputActive = true;
            } else if (this.buttons.back.hovered) {
                this.goBack();
            } else {
                // 检查角色项点击
                for (const char of this.characters) {
                    if (char._clickArea && this.isPointInButton(mousePos, char._clickArea)) {
                        this.selectCharacter(char);
                        break;
                    }
                }
            }
        }
    }

    /**
     * 处理创建模式输入
     */
    handleCreateInput(inputManager, mousePos) {
        // 检查按钮悬停
        this.buttons.confirm.hovered = this.isPointInButton(mousePos, this.buttons.confirm);
        this.buttons.cancel.hovered = this.isPointInButton(mousePos, this.buttons.cancel);

        // 检查点击
        if (inputManager.isMouseClicked()) {
            // 输入框点击
            if (this.createForm._inputArea && this.isPointInButton(mousePos, this.createForm._inputArea)) {
                this.createForm.isInputActive = true;
            } else {
                this.createForm.isInputActive = false;
            }

            // 职业选择点击
            for (const classBtn of this.classButtons) {
                if (this.isPointInButton(mousePos, classBtn)) {
                    this.createForm.selectedClass = classBtn.classKey;
                    break;
                }
            }

            // 按钮点击
            if (this.buttons.confirm.hovered) {
                this.confirmCreate();
            } else if (this.buttons.cancel.hovered) {
                this.mode = 'list';
                this.createForm.nameInput = '';
                this.createForm.isInputActive = false;
            }
        }

        // 键盘输入
        if (this.createForm.isInputActive) {
            this.handleKeyboardInput(inputManager);
        }
    }

    /**
     * 处理键盘输入
     */
    handleKeyboardInput(inputManager) {
        // 检查退格键
        if (inputManager.isKeyPressed('Backspace')) {
            this.createForm.nameInput = this.createForm.nameInput.slice(0, -1);
        }
        
        // 检查回车键
        if (inputManager.isKeyPressed('enter') || inputManager.isKeyPressed('Enter')) {
            this.confirmCreate();
            return;
        }
        
        // 获取本帧按下的键
        const keys = inputManager.getKeysPressed();
        
        for (const key of keys) {
            // 跳过特殊键
            if (['Backspace', 'Enter', 'enter', 'Shift', 'shift', 'Control', 'ctrl', 
                 'Alt', 'Tab', 'tab', 'Escape', 'escape', 'space',
                 'up', 'down', 'left', 'right',
                 'skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6'].includes(key)) {
                continue;
            }
            
            // 只允许字母、数字和中文
            if (this.createForm.nameInput.length < 12 && key.length === 1) {
                this.createForm.nameInput += key;
            }
        }
    }

    /**
     * 检查点是否在按钮内
     */
    isPointInButton(point, button) {
        return point.x >= button.x &&
               point.x <= button.x + button.width &&
               point.y >= button.y &&
               point.y <= button.y + button.height;
    }

    /**
     * 确认创建角色
     */
    confirmCreate() {
        const name = this.createForm.nameInput.trim();

        // 验证角色名称
        if (!this.validateCharacterName(name)) {
            return;
        }

        // 创建角色（使用模拟数据）
        const newCharacter = {
            id: Date.now().toString(),
            name: name,
            class: this.createForm.selectedClass,
            level: 1,
            exp: 0,
            stats: this.getClassStats(this.createForm.selectedClass),
            skills: this.getClassSkills(this.createForm.selectedClass),
            equipment: {},
            position: { x: 640, y: 360 }
        };

        console.log('CharacterScene: Character created', newCharacter);

        // 直接进入游戏场景
        this.enterGame(newCharacter);
    }

    /**
     * 验证角色名称
     */
    validateCharacterName(name) {
        if (!name) {
            this.showError('请输入角色名称');
            return false;
        }

        if (name.length < 2) {
            this.showError('角色名称至少2个字符');
            return false;
        }

        if (name.length > 12) {
            this.showError('角色名称最多12个字符');
            return false;
        }

        // 检查特殊字符
        const invalidChars = /[<>\/\\|*?:"]/;
        if (invalidChars.test(name)) {
            this.showError('角色名称包含非法字符');
            return false;
        }

        return true;
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        this.errorMessage = message;
        this.errorTime = 0;
    }

    /**
     * 获取职业初始属性
     */
    getClassStats(classKey) {
        const baseStats = {
            warrior: { hp: 150, maxHp: 150, mp: 50, maxMp: 50, attack: 15, defense: 10, speed: 150 },
            strategist: { hp: 80, maxHp: 80, mp: 150, maxMp: 150, attack: 25, defense: 5, speed: 180 },
            archer: { hp: 100, maxHp: 100, mp: 80, maxMp: 80, attack: 18, defense: 7, speed: 200 }
        };
        return baseStats[classKey] || baseStats.warrior;
    }

    /**
     * 获取职业初始技能
     */
    getClassSkills(classKey) {
        const classSkills = {
            warrior: ['basic_attack', 'power_strike', 'shield_bash'],
            strategist: ['basic_attack', 'strategist_fire_talisman', 'strategist_binding_talisman'],
            archer: ['basic_attack', 'multi_shot', 'poison_arrow']
        };
        return classSkills[classKey] || classSkills.warrior;
    }

    /**
     * 选择已有角色
     */
    selectCharacter(character) {
        console.log('CharacterScene: Character selected', character);
        this.enterGame(character);
    }

    /**
     * 进入游戏场景
     */
    enterGame(character) {
        console.log('CharacterScene: Attempting to enter game with character:', character);

        if (!this.engine) {
            console.error('CharacterScene: engine is not injected');
            this.showError('游戏引擎未初始化');
            return;
        }

        if (!this.engine.sceneManager) {
            console.error('CharacterScene: sceneManager is not defined');
            this.showError('场景管理器未初始化');
            return;
        }

        console.log('CharacterScene: Switching to Game scene...');
        this.engine.sceneManager.switchTo('Game', { character });
    }

    /**
     * 返回登录场景
     */
    goBack() {
        if (this.engine?.sceneManager) {
            this.engine.sceneManager.switchTo('Login');
        }
    }
}
