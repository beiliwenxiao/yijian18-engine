/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * Systems Index
 * 导出所有游戏系统
 */

export { MovementSystem } from './MovementSystem.js';
export { CombatSystem } from './CombatSystem.js';
export { BattleSystem, BattleMode, BattleState } from './BattleSystem.js';
export { BattlefieldRuntimeSystem } from './BattlefieldRuntimeSystem.js';
export { CityWarSystem } from './CityWarSystem.js';
export { RescueSystem, RescueStatus } from './RescueSystem.js';
export { ConstructionSystem } from './ConstructionSystem.js';
export { VehicleSystem } from './VehicleSystem.js';
export { MannedStructureAdapter } from './MannedStructureAdapter.js';
export { VehicleLogisticsSystem } from './VehicleLogisticsSystem.js';
export { SkillTreeSystem, SkillTree, SkillTreeNode } from './SkillTreeSystem.js';
export { AttributeSystem, AttributeData, AttributeType, AttributeEffectCalculator } from './AttributeSystem.js';
export { TalentSystem, TalentTree, TalentNode, TalentType } from './TalentSystem.js';
export { MapSystem, GameMap, Portal, MapState, PortalType } from './MapSystem.js';
export { DungeonSystem, DungeonTemplate, DungeonInstance, DungeonWave, DungeonReward, DungeonDifficulty, DungeonState } from './DungeonSystem.js';
export { EventSystem, EventType, EventState, EventReward, WorldEvent, EventTemplate } from './EventSystem.js';
export { NPCSystem, NPC, NPCType, NPCState, DialogOption, DialogNode, DialogTree } from './NPCSystem.js';
export { QuestSystem, Quest, QuestType, QuestState, ObjectiveType, QuestObjective, QuestReward } from './QuestSystem.js';
export { TaskGraphSystem, TASK_GRAPH_SCHEMA_VERSION } from './TaskGraphSystem.js';
export { QuestRuntimeState, QUEST_RUNTIME_SCHEMA_VERSION } from './QuestRuntimeState.js';
export { QuestTransactionService, QUEST_COMMANDS } from './QuestTransactionService.js';
export { QuestResolver } from './resolvers/QuestResolver.js';
export { ShopSystem, Shop, ShopItem, ShopType, CurrencyType } from './ShopSystem.js';
export { ChatSystem, ChatChannel, ChatMessageType, ChatMessage } from './ChatSystem.js';
export { PlayerSyncSystem, RemotePlayer, PlayerState } from './PlayerSyncSystem.js';
export { FriendSystem, Friend, FriendRequest, FriendStatus, FriendRequestStatus, FriendGroupType } from './FriendSystem.js';
export { TeamSystem, Team, TeamMember, TeamInvite, TeamState, TeamRole, InviteStatus, ExpShareMode, LootMode } from './TeamSystem.js';
export { PVPSystem, PVPPlayerData, ArenaBattle, PVPState, ArenaState, PVPConfig } from './PVPSystem.js';
export { DialogueSystem } from './DialogueSystem.js';
export { TutorialSystem } from './TutorialSystem.js';
export { TutorialDefinitionRepository } from './TutorialDefinitionRepository.js';
export { ProgressManager } from './ProgressManager.js';
export { ClassSystem, ClassType, ClassNames, ClassInstructors, ClassData, SpecializationData } from './ClassSystem.js';
export { AISystem } from './AISystem.js';
export { NPCRecruitmentSystem } from './NPCRecruitmentSystem.js';
export { FlightSystem } from './FlightSystem.js';
export { JumpSystem } from './JumpSystem.js';
