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
 * 登录场景
 * 显示游戏标题和开始按钮
 */
export class LoginScene extends Scene {
    constructor(engine = null) {
        super('Login');
        this.engine = engine;
        
        // UI元素
        this.title = 'HTML5 MMRPG';
        this.subtitle = 'Real-time Combat Adventure';
        this.startButton = {
            x: 0,
            y: 0,
            width: 200,
            height: 60,
            text: '开始游戏',
            hovered: false
        };
        
        // 动画效果
        this.titlePulse = 0;
        this.particleTime = 0;
    }

    /**
     * 场景进入
     */
    enter(data = null) {
        super.enter(data);
        
        // 重置状态
        this.titlePulse = 0;
        this.particleTime = 0;
    }

    /**
     * 更新场景
     */
    update(deltaTime) {
        // 更新标题脉动动画
        this.titlePulse += deltaTime * 2;
        
        // 更新粒子时间
        this.particleTime += deltaTime;
    }

    /**
     * 渲染场景
     */
    render(ctx) {
        const canvas = ctx.canvas;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        // 绘制背景渐变
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#0f0c29');
        gradient.addColorStop(0.5, '#302b63');
        gradient.addColorStop(1, '#24243e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 绘制装饰性粒子
        this.renderParticles(ctx);

        // 绘制游戏标题
        const titleScale = 1 + Math.sin(this.titlePulse) * 0.05;
        ctx.save();
        ctx.translate(centerX, centerY - 150);
        ctx.scale(titleScale, titleScale);
        
        // 标题阴影
        ctx.shadowColor = 'rgba(74, 158, 255, 0.5)';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold 72px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.title, 0, 0);
        
        ctx.restore();

        // 绘制副标题
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.subtitle, centerX, centerY - 80);

        // 绘制开始按钮
        this.renderStartButton(ctx, centerX, centerY + 50);

        // 绘制版本信息
        ctx.fillStyle = '#666666';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('v1.0.0 - HTML5 Canvas Game', centerX, canvas.height - 30);
    }

    /**
     * 渲染装饰性粒子
     */
    renderParticles(ctx) {
        const canvas = ctx.canvas;
        ctx.fillStyle = 'rgba(74, 158, 255, 0.3)';
        
        for (let i = 0; i < 20; i++) {
            const x = (i * 100 + this.particleTime * 30) % (canvas.width + 100);
            const y = (i * 50 + Math.sin(this.particleTime + i) * 20) % canvas.height;
            const size = 2 + Math.sin(this.particleTime * 2 + i) * 1;
            
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * 渲染开始按钮
     */
    renderStartButton(ctx, centerX, centerY) {
        // 更新按钮位置
        this.startButton.x = centerX - this.startButton.width / 2;
        this.startButton.y = centerY - this.startButton.height / 2;

        // 按钮背景
        ctx.fillStyle = this.startButton.hovered ? '#5aa9ff' : '#4a9eff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        
        // 绘制圆角矩形
        this.roundRect(
            ctx,
            this.startButton.x,
            this.startButton.y,
            this.startButton.width,
            this.startButton.height,
            10
        );
        ctx.fill();
        ctx.stroke();

        // 按钮文字
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            this.startButton.text,
            centerX,
            centerY
        );

        // 悬停提示
        if (this.startButton.hovered) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            this.roundRect(
                ctx,
                this.startButton.x,
                this.startButton.y,
                this.startButton.width,
                this.startButton.height,
                10
            );
            ctx.fill();
        }
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
        // 检查鼠标悬停
        const mousePos = inputManager.getMousePosition();
        this.startButton.hovered = this.isPointInButton(mousePos, this.startButton);

        // 检查鼠标点击
        if (inputManager.isMouseClicked()) {
            if (this.startButton.hovered) {
                this.onStartButtonClick();
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
     * 开始按钮点击事件
     */
    onStartButtonClick() {
        console.log('LoginScene: Start button clicked');
        
        // 触发场景切换（需要通过SceneManager）
        // 这将在GameEngine中处理
        this.engine?.sceneManager?.switchTo('Character');
    }
}
