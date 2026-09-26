import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrologueScene } from './PrologueScene.js';

describe('PrologueScene', () => {
    let scene;
    let mockSceneData;

    beforeEach(() => {
        mockSceneData = {
            tutorials: [
                { id: 'movement', title: '移动教程' }
            ],
            dialogues: {
                intro: { id: 'intro', text: '欢迎' }
            },
            quests: [
                { id: 'quest1', name: '第一个任务' }
            ],
            npcs: [
                { id: 'npc1', name: '张角' }
            ]
        };
        
        scene = new PrologueScene(1, mockSceneData);
    });

    describe('构造函数', () => {
        it('应该正确初始化场景', () => {
            expect(scene.name).toBe('Act1Scene');
            expect(scene.actNumber).toBe(1);
            expect(scene.sceneData).toBe(mockSceneData);
            expect(scene.isLoaded).toBe(false);
            expect(scene.isPaused).toBe(false);
        });

        it('应该初始化空的实体和NPC集合', () => {
            expect(scene.entities.size).toBe(0);
            expect(scene.npcs.size).toBe(0);
        });
    });

    describe('enter', () => {
        it('应该激活场景', () => {
            scene.enter();
            expect(scene.isActive).toBe(true);
        });

        it('应该保存玩家引用', () => {
            const mockPlayer = { id: 'player1', name: '测试玩家' };
            scene.enter({ player: mockPlayer });
            expect(scene.player).toBe(mockPlayer);
        });

        it('应该加载场景数据', () => {
            scene.enter();
            expect(scene.isLoaded).toBe(true);
        });
    });

    describe('update', () => {
        it('当场景未激活时不应更新', () => {
            scene.isActive = false;
            const mockEntity = { update: vi.fn() };
            scene.addEntity('entity1', mockEntity);
            
            scene.update(0.016);
            
            expect(mockEntity.update).not.toHaveBeenCalled();
        });

        it('当场景暂停时不应更新', () => {
            scene.isActive = true;
            scene.isPaused = true;
            const mockEntity = { update: vi.fn() };
            scene.addEntity('entity1', mockEntity);
            
            scene.update(0.016);
            
            expect(mockEntity.update).not.toHaveBeenCalled();
        });

        it('应该更新所有实体', () => {
            scene.isActive = true;
            const mockEntity1 = { update: vi.fn() };
            const mockEntity2 = { update: vi.fn() };
            scene.addEntity('entity1', mockEntity1);
            scene.addEntity('entity2', mockEntity2);
            
            scene.update(0.016);
            
            expect(mockEntity1.update).toHaveBeenCalledWith(0.016);
            expect(mockEntity2.update).toHaveBeenCalledWith(0.016);
        });
    });

    describe('render', () => {
        let mockCtx;

        beforeEach(() => {
            mockCtx = {
                canvas: { width: 800, height: 600 },
                fillStyle: '',
                fillRect: vi.fn()
            };
        });

        it('当场景未激活时不应渲染', () => {
            scene.isActive = false;
            scene.render(mockCtx);
            expect(mockCtx.fillRect).not.toHaveBeenCalled();
        });

        it('应该渲染背景', () => {
            scene.isActive = true;
            scene.render(mockCtx);
            expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
        });

        it('应该渲染所有实体', () => {
            scene.isActive = true;
            const mockEntity = { render: vi.fn() };
            scene.addEntity('entity1', mockEntity);
            
            scene.render(mockCtx);
            
            expect(mockEntity.render).toHaveBeenCalledWith(mockCtx);
        });

        it('应该渲染所有NPC', () => {
            scene.isActive = true;
            const mockNPC = { render: vi.fn() };
            scene.addNPC('npc1', mockNPC);
            
            scene.render(mockCtx);
            
            expect(mockNPC.render).toHaveBeenCalledWith(mockCtx);
        });
    });

    describe('exit', () => {
        it('应该停用场景', () => {
            scene.isActive = true;
            scene.exit();
            expect(scene.isActive).toBe(false);
        });

        it('应该清理所有实体和NPC', () => {
            scene.addEntity('entity1', {});
            scene.addNPC('npc1', {});
            
            scene.exit();
            
            expect(scene.entities.size).toBe(0);
            expect(scene.npcs.size).toBe(0);
        });
    });

    describe('实体管理', () => {
        it('应该能添加实体', () => {
            const entity = { id: 'test' };
            scene.addEntity('entity1', entity);
            expect(scene.entities.size).toBe(1);
            expect(scene.getEntity('entity1')).toBe(entity);
        });

        it('应该能移除实体', () => {
            scene.addEntity('entity1', {});
            scene.removeEntity('entity1');
            expect(scene.entities.size).toBe(0);
            expect(scene.getEntity('entity1')).toBeNull();
        });

        it('移除不存在的实体不应报错', () => {
            expect(() => scene.removeEntity('nonexistent')).not.toThrow();
        });
    });

    describe('NPC管理', () => {
        it('应该能添加NPC', () => {
            const npc = { id: 'test', name: '张角' };
            scene.addNPC('npc1', npc);
            expect(scene.npcs.size).toBe(1);
            expect(scene.getNPC('npc1')).toBe(npc);
        });

        it('应该能移除NPC', () => {
            scene.addNPC('npc1', {});
            scene.removeNPC('npc1');
            expect(scene.npcs.size).toBe(0);
            expect(scene.getNPC('npc1')).toBeNull();
        });

        it('移除不存在的NPC不应报错', () => {
            expect(() => scene.removeNPC('nonexistent')).not.toThrow();
        });
    });

    describe('暂停和恢复', () => {
        it('应该能暂停场景', () => {
            scene.pause();
            expect(scene.isPaused).toBe(true);
        });

        it('应该能恢复场景', () => {
            scene.pause();
            scene.resume();
            expect(scene.isPaused).toBe(false);
        });
    });

    describe('场景切换', () => {
        it('应该能前往下一个场景', () => {
            const mockSceneManager = {
                switchTo: vi.fn()
            };
            scene.setSceneManager(mockSceneManager);
            scene.player = { id: 'player1' };

            scene.goToNextScene({ customData: 'test' });

            expect(mockSceneManager.switchTo).toHaveBeenCalledWith(
                'Act2Scene',
                expect.objectContaining({
                    player: scene.player,
                    previousAct: 1,
                    customData: 'test'
                })
            );
        });

        it('第六幕完成后应该调用序章完成回调', () => {
            const scene6 = new PrologueScene(6);
            const mockSceneManager = {
                switchTo: vi.fn()
            };
            scene6.setSceneManager(mockSceneManager);
            scene6.onPrologueComplete = vi.fn();

            scene6.goToNextScene();

            expect(mockSceneManager.switchTo).not.toHaveBeenCalled();
            expect(scene6.onPrologueComplete).toHaveBeenCalled();
        });
    });

    describe('数据加载', () => {
        it('应该加载场景数据', () => {
            const loadTutorialsSpy = vi.spyOn(scene, 'loadTutorials');
            const loadDialoguesSpy = vi.spyOn(scene, 'loadDialogues');
            const loadQuestsSpy = vi.spyOn(scene, 'loadQuests');
            const loadNPCsSpy = vi.spyOn(scene, 'loadNPCs');
            
            scene.loadSceneData();
            
            expect(loadTutorialsSpy).toHaveBeenCalledWith(mockSceneData.tutorials);
            expect(loadDialoguesSpy).toHaveBeenCalledWith(mockSceneData.dialogues);
            expect(loadQuestsSpy).toHaveBeenCalledWith(mockSceneData.quests);
            expect(loadNPCsSpy).toHaveBeenCalledWith(mockSceneData.npcs);
            expect(scene.isLoaded).toBe(true);
        });

        it('没有场景数据时不应报错', () => {
            const emptyScene = new PrologueScene(1);
            expect(() => emptyScene.loadSceneData()).not.toThrow();
        });
    });
});
