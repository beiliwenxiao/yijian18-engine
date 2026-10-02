// 存档选择器核心：巫师式存档列表/栏位选择/覆盖与开始确认/启动游戏。抽取自 example/sanguo_zhangjiao/index.html，跨模块状态经 shell 宿主读写。
export function createSavePickerCore(shell) {
const savePickerModal = document.getElementById('save-picker-modal');
const savePickerPanel = savePickerModal.querySelector('.save-picker-panel');
const savePickerTitle = document.getElementById('save-picker-title');
const savePickerMessage = document.getElementById('save-picker-message');
const savePickerCancel = document.getElementById('save-picker-cancel');
const savePickerClose = document.getElementById('save-picker-close');
const saveSlotsElement = document.getElementById('save-slots');
let savePickerOpener = null;

const overwriteConfirmModal = document.getElementById('overwrite-confirm-modal');
const overwriteConfirmTitle = document.getElementById('overwrite-confirm-title');
const overwriteConfirmMessage = document.getElementById('overwrite-confirm-message');
const overwriteConfirmAccept = document.getElementById('overwrite-confirm-accept');
const overwriteConfirmCancel = document.getElementById('overwrite-confirm-cancel');
let pendingOverwriteConfirmation = null;
let overwriteConfirmOpener = null;

function formatSaveTime(timestamp) {
    if (!timestamp) return '未知时间';
    try { return new Date(timestamp).toLocaleString('zh-CN', { hour12: false }); }
    catch (_error) { return '未知时间'; }
}

let savePickerMode = null;
let selectedSaveValue = '';
let savePickerEntries = [];
let savePickerConfirmInFlight = false;

const saveSlotSelected = document.getElementById('save-slot-selected');
const saveSlotList = document.getElementById('save-slot-list');
const saveSlotInfo = document.getElementById('save-slot-info');
const saveSlotConfirm = document.getElementById('save-slot-confirm');

function autoSaveSelection(index) {
    return `auto:${index}`;
}

function manualSaveSelection(index) {
    return `manual:${index}`;
}

function parseSaveSelection(value) {
    const autoMatch = /^auto:(\d+)$/.exec(String(value || ''));
    const autoIndex = Number(autoMatch?.[1]);
    if (Number.isInteger(autoIndex) && autoIndex >= 1 && autoIndex <= shell.saveGames.autoSlotCount) {
        return { kind: 'auto', index: autoIndex };
    }
    const manualMatch = /^manual:(\d+)$/.exec(String(value || ''));
    const manualIndex = Number(manualMatch?.[1]);
    return Number.isInteger(manualIndex) && manualIndex >= 1 && manualIndex <= shell.saveGames.slotCount
        ? { kind: 'manual', index: manualIndex }
        : null;
}

/** 自动档与手动档统一按保存时间挑选，继续游戏始终恢复最近有效进度。 */
async function getLatestSaveSelection() {
    await shell.saveStorageReady;
    const [autoSlots, manualSlots] = await Promise.all([
        shell.saveGames.getAutoSlotsAsync(),
        shell.saveGames.listExistingSlotsAsync()
    ]);
    const latest = [...autoSlots, ...manualSlots]
        .filter(entry => entry.exists && entry.info)
        .sort((left, right) => {
            const timeDelta = (Number(right.info.createdAt) || 0) - (Number(left.info.createdAt) || 0);
            if (timeDelta) return timeDelta;
            const typeDelta = left.type.localeCompare(right.type);
            return typeDelta || left.index - right.index;
        })[0];
    return latest ? { kind: latest.type, index: latest.index } : null;
}

async function refreshContinueGameAction() {
    const button = document.getElementById('login-continue');
    const selection = await getLatestSaveSelection();
    button.disabled = !selection;
    button.title = selection ? '读取最近保存的游戏进度' : '没有可读取的有效存档';
    return selection;
}

function describeSaveEntry(entry, label) {
    if (!entry?.exists) return `${label}为空`;
    const meta = entry.info?.meta || {};
    return `${label}：${meta.characterName || '未命名角色'}，等级 ${meta.level || 1}，保存于 ${formatSaveTime(entry.info?.createdAt)}`;
}

function getSavePickerEntry(value = selectedSaveValue) {
    return savePickerEntries.find(entry => entry.value === value) || null;
}

function moveSaveSelection(direction) {
    const options = savePickerEntries.filter(entry => !entry.disabled);
    if (!options.length) return;
    const currentIndex = options.findIndex(entry => entry.value === selectedSaveValue);
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    selectSaveEntry(options[nextIndex]?.value, { focus: true });
}

function selectSaveEntry(value, { focus = false } = {}) {
    const selected = getSavePickerEntry(value);
    if (!selected || selected.disabled) return false;
    selectedSaveValue = value;
    for (const entry of savePickerEntries) {
        const isSelected = entry.value === value;
        entry.element.classList.toggle('selected', isSelected);
        entry.element.setAttribute('aria-selected', String(isSelected));
    }
    selected.element.scrollIntoView({ block: 'nearest' });
    if (focus) selected.element.focus();
    updateSavePickerInfo();
    return true;
}

function updateSavePickerInfo() {
    const selection = parseSaveSelection(selectedSaveValue);
    const selected = getSavePickerEntry();
    if (!selection || !selected) return;
    const isManualSave = savePickerMode === 'manualSave';
    saveSlotSelected.textContent = isManualSave
        ? `当前选中：存档 ${selection.index}`
        : selected.label;
    saveSlotInfo.textContent = describeSaveEntry(selected.entry, selected.shortLabel);
    saveSlotConfirm.disabled = savePickerMode === 'continue' && !selected.entry.exists;
    saveSlotConfirm.textContent = savePickerMode === 'continue'
        ? '读取所选存档'
        : (isManualSave ? `保存到存档 ${selection.index}` : '开始新游戏');
}

function buildSavePreview(entry, typeLabel) {
    const preview = document.createElement('div');
    preview.className = 'save-slot-preview';
    const savedPreview = entry.info?.meta?.preview;
    if (typeof savedPreview === 'string' && savedPreview.startsWith('data:image/')) {
        const image = document.createElement('img');
        image.src = savedPreview;
        image.alt = `${typeLabel}游戏画面`;
        preview.appendChild(image);
    }
    const type = document.createElement('span');
    type.className = 'save-slot-type';
    type.textContent = typeLabel;
    preview.appendChild(type);
    return preview;
}

/** 删除单个存档（IndexedDB 权威存储）；文件镜像保留为备份，不阻塞列表刷新。 */
async function deleteSaveEntry(value, entry, shortLabel) {
    if (!entry?.exists) return;
    const confirmed = await requestSaveActionConfirmation({
        title: `删除${shortLabel}？`,
        message: `${shortLabel} 的存档删除后将无法恢复，确定删除吗？`,
        acceptLabel: '确认删除',
        danger: true
    });
    if (!confirmed) return;
    const selection = parseSaveSelection(value);
    if (!selection) return;
    const cleared = selection.kind === 'auto'
        ? await shell.saveGames.clearAutoAsync(selection.index)
        : await shell.saveGames.clearAsync(selection.index);
    if (cleared) {
        if (selectedSaveValue === value) selectedSaveValue = '';
        shell.setLoginMessage(`已删除${shortLabel}。`);
    } else {
        shell.setLoginMessage(`删除${shortLabel}失败，请重试。`);
    }
    if (isSavePickerOpen()) await renderSaveSlots(savePickerMode);
}

/** 巫师式存档浏览：异步读取已提交的 IndexedDB 存档。渲染异常时窗口内给出明确错误而非空白。 */
async function renderSaveSlots(mode) {
    savePickerMode = mode;
    try {
        await renderSaveSlotsInner(mode);
    } catch (error) {
        console.error('存档浏览渲染失败', error);
        savePickerEntries = [];
        saveSlotList.replaceChildren();
        saveSlotSelected.textContent = '存档列表读取失败';
        saveSlotInfo.textContent = error?.message || '读取存档列表时发生错误，请重试。';
        saveSlotConfirm.disabled = true;
        savePickerTitle.textContent = mode === 'continue' ? '读取存档'
            : (mode === 'manualSave' ? '手动存档' : '开始新游戏');
        saveSlotsElement.classList.add('visible');
        savePickerModal.classList.remove('hidden');
        savePickerModal.setAttribute('aria-hidden', 'false');
        shell.armMenuPadNavigation();
    }
}

async function renderSaveSlotsInner(mode) {
    await shell.saveStorageReady;
    const [manualSlots, autoSlots] = await Promise.all([
        shell.saveGames.listExistingSlotsAsync(),
        shell.saveGames.getAutoSlotsAsync()
    ]);
    const nextAvailableSlotIndex = mode === 'continue'
        ? null
        : await shell.saveGames.getNextAvailableSlotIndex();
    const usedIndices = new Set(manualSlots.map(slot => slot.index));

    savePickerEntries = [];
    saveSlotList.replaceChildren();

    function addGroup(label) {
        const group = document.createElement('div');
        group.className = 'save-slot-group';
        group.textContent = label;
        saveSlotList.appendChild(group);
    }

    function addOption(value, entry, shortLabel) {
        const disabled = mode === 'continue' && !entry.exists;
        const meta = entry.info?.meta || {};
        const option = document.createElement('div');
        const label = describeSaveEntry(entry, shortLabel);
        option.className = `save-slot-option${disabled ? ' disabled' : ''}`;
        option.tabIndex = disabled ? -1 : 0;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-disabled', String(disabled));
        option.setAttribute('aria-selected', 'false');

        const details = document.createElement('div');
        details.className = 'save-slot-details';
        const title = document.createElement('div');
        title.className = 'save-slot-title';
        title.textContent = entry.exists
            ? `${shortLabel} · ${meta.characterName || '未命名角色'}`
            : `${shortLabel} · 空白栏位`;
        const location = document.createElement('div');
        location.className = 'save-slot-location';
        location.textContent = entry.exists
            ? (meta.location || meta.currentSceneId || 'S01')
            : (mode === 'continue' ? '没有可读取的进度' : '在此开始新的旅程');
        const cardMeta = document.createElement('div');
        cardMeta.className = 'save-slot-meta';
        const level = document.createElement('span');
        level.textContent = entry.exists ? `等级 ${meta.level || 1}` : '未创建';
        const time = document.createElement('time');
        time.textContent = entry.exists ? formatSaveTime(entry.info?.createdAt) : '—';
        cardMeta.append(level, time);
        details.append(title, location, cardMeta);
        option.append(buildSavePreview(entry, shortLabel), details);
        if (entry.exists) {
            // 已有存档支持就地删除；确认弹窗防误触，删除后刷新列表。
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'save-slot-delete';
            deleteButton.textContent = '删除';
            deleteButton.setAttribute('aria-label', `删除${shortLabel}`);
            deleteButton.addEventListener('click', event => {
                event.stopPropagation();
                void deleteSaveEntry(value, entry, shortLabel);
            });
            option.appendChild(deleteButton);
        }
        option.addEventListener('click', () => {
            if (selectSaveEntry(value)) handleSavePickerConfirm();
        });
        option.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (selectSaveEntry(value)) handleSavePickerConfirm();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveSaveSelection(event.key === 'ArrowDown' ? 1 : -1);
            }
        });
        saveSlotList.appendChild(option);
        savePickerEntries.push({ value, entry, shortLabel, label, disabled, element: option });
    }

    if (mode === 'continue') {
        const existingAutoSlots = autoSlots.filter(slot => slot.exists);
        if (existingAutoSlots.length > 0) {
            addGroup('自动存档（保留最近 3 份）');
            for (const slot of existingAutoSlots) addOption(autoSaveSelection(slot.index), slot, `自动 ${slot.index}`);
        }
    }

    addGroup(`手动存档（已存 ${manualSlots.length} 个）`);
    for (const slot of manualSlots) {
        addOption(manualSaveSelection(slot.index), slot, `存档 ${slot.index}`);
    }

    // 读取模式只显示真实存在的存档；新建/手动保存额外显示一个下一可用栏位。
    if (mode !== 'continue' && nextAvailableSlotIndex != null && !usedIndices.has(nextAvailableSlotIndex)) {
        addOption(manualSaveSelection(nextAvailableSlotIndex), {
            type: 'manual',
            index: nextAvailableSlotIndex,
            id: `slot-${nextAvailableSlotIndex}`,
            exists: false,
            info: null
        }, `存档 ${nextAvailableSlotIndex}${nextAvailableSlotIndex > 9 ? '（新）' : ''}`);
    }

    const firstManual = manualSlots[0] || null;
    const latestAuto = autoSlots
        .filter(slot => slot.exists)
        .sort((left, right) => (Number(right.info?.createdAt) || 0) - (Number(left.info?.createdAt) || 0))[0] || null;
    const preferred = mode === 'continue'
        ? (latestAuto ? autoSaveSelection(latestAuto.index) : firstManual ? manualSaveSelection(firstManual.index) : '')
        : manualSaveSelection(nextAvailableSlotIndex);
    if (preferred) selectSaveEntry(preferred);
    else {
        selectedSaveValue = '';
        saveSlotSelected.textContent = '没有可读取的存档';
        saveSlotInfo.textContent = '存档为空，请选择 开始游戏。';
        saveSlotConfirm.disabled = true;
        saveSlotConfirm.textContent = '读取所选存档';
    }
    if (!isSavePickerOpen()) {
        savePickerOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    savePickerTitle.textContent = mode === 'continue' ? '读取存档'
        : (mode === 'manualSave' ? '手动存档' : '开始新游戏');
    savePickerMessage.textContent = shell.loginMessage.textContent;
    saveSlotsElement.classList.add('visible');
    savePickerModal.classList.remove('hidden');
    savePickerModal.setAttribute('aria-hidden', 'false');
    // 预武装：打开存档窗口时摇杆可能仍偏转，不要求先归中即可导航（离散步进）。
    shell.armMenuPadNavigation();
    requestAnimationFrame(() => {
        if (isSavePickerOpen()) getSavePickerEntry()?.element.focus();
    });
}

function isSavePickerOpen() {
    return !savePickerModal.classList.contains('hidden');
}

function isOverwriteConfirmationOpen() {
    return !overwriteConfirmModal.classList.contains('hidden');
}

function requestSaveActionConfirmation({ title, message, acceptLabel, danger = false }) {
    if (pendingOverwriteConfirmation) return pendingOverwriteConfirmation.promise;

    let resolveConfirmation;
    const promise = new Promise(resolve => { resolveConfirmation = resolve; });
    pendingOverwriteConfirmation = { promise, resolve: resolveConfirmation };
    overwriteConfirmOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overwriteConfirmTitle.textContent = title;
    overwriteConfirmMessage.textContent = message;
    overwriteConfirmAccept.textContent = acceptLabel;
    overwriteConfirmAccept.classList.toggle('danger', danger);
    savePickerPanel.setAttribute('inert', '');
    overwriteConfirmModal.classList.remove('hidden');
    overwriteConfirmModal.setAttribute('aria-hidden', 'false');
    shell.armMenuPadNavigation();
    requestAnimationFrame(() => {
        if (isOverwriteConfirmationOpen()) overwriteConfirmAccept.focus();
    });
    return promise;
}

function requestOverwriteConfirmation(index, { startGame = false } = {}) {
    return requestSaveActionConfirmation({
        title: '覆盖已有存档？',
        message: `手动存档 ${index} 已有进度，覆盖后将无法恢复。`,
        acceptLabel: startGame ? '开始游戏' : '确认覆盖',
        danger: true
    });
}

/** 手动存档必须先由玩家确认目标栏位，避免直接写入错误的存档。 */
function requestManualSaveConfirmation() {
    if (savePickerMode !== 'manualSave' || savePickerConfirmInFlight || pendingOverwriteConfirmation) return false;
    const selection = parseSaveSelection(selectedSaveValue);
    if (!selection || selection.kind !== 'manual') return false;

    void requestSaveActionConfirmation({
        title: `当前选中：存档 ${selection.index}`,
        message: `确认将当前游戏进度保存到存档 ${selection.index} 吗？`,
        acceptLabel: `保存到存档 ${selection.index}`
    }).then(confirmed => {
        if (confirmed && savePickerMode === 'manualSave') void confirmSavePicker();
    });
    return true;
}

function handleSavePickerConfirm() {
    if (savePickerMode === 'manualSave') {
        requestManualSaveConfirmation();
        return;
    }
    void confirmSavePicker();
}

function requestStartGameConfirmation(mode, selection, entry = null) {
    const slotLabel = selection.kind === 'auto' ? `自动存档 ${selection.index}` : `手动存档 ${selection.index}`;
    const message = mode === 'continue'
        ? `将读取${slotLabel}${entry?.info?.meta?.characterName ? `（${entry.info.meta.characterName}）` : ''}并进入游戏。`
        : `将在${slotLabel}开始新的游戏。`;
    return requestSaveActionConfirmation({
        title: '开始游戏？',
        message,
        acceptLabel: '开始游戏'
    });
}

function settleOverwriteConfirmation(result, { restoreFocus = !result } = {}) {
    const pending = pendingOverwriteConfirmation;
    if (!pending && !isOverwriteConfirmationOpen()) return;

    const opener = overwriteConfirmOpener;
    pendingOverwriteConfirmation = null;
    overwriteConfirmOpener = null;
    if (overwriteConfirmModal.contains(document.activeElement)) document.activeElement.blur();
    overwriteConfirmModal.classList.add('hidden');
    overwriteConfirmModal.setAttribute('aria-hidden', 'true');
    overwriteConfirmAccept.classList.remove('danger');
    savePickerPanel.removeAttribute('inert');
    shell.resetMenuPadIndex();
    pending?.resolve(Boolean(result));
    if (restoreFocus && opener?.isConnected && !shell.loginScreen.classList.contains('hidden')) {
        requestAnimationFrame(() => opener.focus());
    }
}

/** 弹窗关闭兜底：优先还原触发者（可见时），否则落到系统菜单第一个可见的菜单动作按钮。 */
function refocusAfterModalClose(opener, restoreFocus) {
    if (restoreFocus && opener?.isConnected && !shell.loginScreen.classList.contains('hidden')
      && opener.offsetParent !== null) {
        opener.focus();
        return;
    }
    const fallback = Array.from(shell.loginScreen.querySelectorAll('.login-action'))
        .find(button => button.offsetParent !== null && !button.disabled);
    fallback?.focus();
}

function closeSavePicker({ restoreFocus = true } = {}) {
    if (isOverwriteConfirmationOpen()) {
        settleOverwriteConfirmation(false, { restoreFocus: false });
    }
    const opener = savePickerOpener;
    savePickerModal.classList.add('hidden');
    savePickerModal.setAttribute('aria-hidden', 'true');
    saveSlotsElement.classList.remove('visible');
    savePickerMode = null;
    selectedSaveValue = '';
    savePickerEntries = [];
    savePickerMessage.textContent = '';
    saveSlotSelected.textContent = '请选择存档栏位';
    saveSlotInfo.textContent = '';
    saveSlotConfirm.disabled = false;
    shell.resetMenuPadIndex();
    savePickerOpener = null;
    // 焦点不得留在 aria-hidden 弹窗内（无障碍警告）：关闭后统一移回可见的安全位置
    if (savePickerModal.contains(document.activeElement)) {
        refocusAfterModalClose(opener, restoreFocus);
        return;
    }
    if (restoreFocus && opener?.isConnected && !shell.loginScreen.classList.contains('hidden')) opener.focus();
}

async function confirmSavePicker() {
    if (savePickerConfirmInFlight || isOverwriteConfirmationOpen()) return;
    const selection = parseSaveSelection(selectedSaveValue);
    if (!selection) return;
    const selected = getSavePickerEntry();
    const entry = selected?.entry;
    if (!entry) return;

    const mode = savePickerMode;
    savePickerConfirmInFlight = true;
    saveSlotConfirm.disabled = true;
    try {
        if (mode === 'continue') {
            if (!entry.exists) {
                shell.setLoginMessage('存档为空，请选择 开始游戏。');
                return;
            }
            const confirmed = await requestStartGameConfirmation('continue', selection, entry);
            if (!confirmed || !isSavePickerOpen()) return;
            startGameFromSelection('continue', selection);
            return;
        }

        // 开始游戏与手动保存只能写入手动栏位，自动位绝不允许被覆盖。
        if (selection.kind !== 'manual') return;
        if (entry.exists) {
            const confirmed = await requestOverwriteConfirmation(selection.index, { startGame: mode === 'new' });
            if (!confirmed || !isSavePickerOpen()) return;
        }

        if (mode === 'manualSave') {
            shell.activeSaveSlot = selection.index;
            const saved = await shell.saveCurrentGame({ silent: true });
            const message = saved?.ok ? `已手动保存到栏位 ${selection.index}`
                : saved?.snapshot ? '手动存档已写入 IndexedDB，但存档文件或缩略图保存失败。'
                : '手动保存失败，请稍后重试。';
            shell.setLoginMessage(message);
            if (isSavePickerOpen()) await renderSaveSlots('manualSave');
            return;
        }
        if (!entry.exists) {
            const confirmed = await requestStartGameConfirmation('new', selection, entry);
            if (!confirmed || !isSavePickerOpen()) return;
        }
        startGameFromSelection('new', selection);
    } finally {
        savePickerConfirmInFlight = false;
        if (isSavePickerOpen() && !isOverwriteConfirmationOpen()) updateSavePickerInfo();
    }
}

function startGameFromSelection(mode, selection) {
    shell.pauseLoginGamepadPolling();
    closeSavePicker({ restoreFocus: false });
    shell.setLoginMessage('');
    // 加载阶段 sceneManager 尚未稳定，必须先用 Promise 锁阻止第二次初始化。
    if (shell.initGamePromise) return;
    if (shell.gameStarted || shell.sceneManager) {
        const bootCommand = {
            mode,
            selection,
            profile: mode === 'new' ? shell.SelectedCharacterStore.get() : null
        };
        sessionStorage.setItem('yijian18:boot-command', JSON.stringify(bootCommand));
        location.reload();
        return;
    }
    if (selection.kind === 'manual') shell.activeSaveSlot = selection.index;
    shell.loginScreen.classList.add('hidden');
    shell.loadingScreen.style.display = 'flex';
    shell.initGamePromise = shell.initGame({ loadSave: mode === 'continue', saveSelection: selection });
    void shell.initGamePromise.finally(() => { shell.initGamePromise = null; });
}

document.getElementById('login-continue').addEventListener('click', async () => {
    let selection = null;
    try {
        selection = await refreshContinueGameAction();
    } catch (error) {
        console.error('读取存档列表失败', error);
        shell.setLoginMessage('存档列表读取失败，请重试。');
        return;
    }
    if (!selection) {
        shell.setLoginMessage('没有可读取的有效存档，请选择 开始游戏。');
        return;
    }
    let autoSlots = [];
    let manualSlots = [];
    try {
        [autoSlots, manualSlots] = await Promise.all([
            shell.saveGames.getAutoSlotsAsync(),
            shell.saveGames.listExistingSlotsAsync()
        ]);
    } catch (error) {
        console.error('读取存档列表失败', error);
        shell.setLoginMessage('存档列表读取失败，请重试。');
        return;
    }
    const entry = selection.kind === 'auto'
        ? autoSlots.find(slot => slot.index === selection.index)
        : manualSlots.find(slot => slot.index === selection.index);
    const confirmed = await requestStartGameConfirmation('continue', selection, entry);
    if (confirmed && !shell.loginScreen.classList.contains('hidden')) startGameFromSelection('continue', selection);
});

document.getElementById('login-read-save').addEventListener('click', async () => {
    let hasAny = false;
    try {
        hasAny = await shell.saveGames.hasAnyAsync();
    } catch (error) {
        console.error('读取存档列表失败', error);
        shell.setLoginMessage('存档列表读取失败，请重试。');
        return;
    }
    if (!hasAny) {
        closeSavePicker({ restoreFocus: false });
        shell.setLoginMessage('存档为空，请选择 开始游戏。');
        return;
    }
    shell.setLoginMessage('请选择自动存档或手动存档栏位。');
    await renderSaveSlots('continue');
});
document.getElementById('login-manual-save').addEventListener('click', async () => {
    shell.setLoginMessage('请选择要写入的手动存档栏位。');
    await renderSaveSlots('manualSave');
});

saveSlotConfirm.addEventListener('click', handleSavePickerConfirm);
savePickerClose.addEventListener('click', () => closeSavePicker());
savePickerCancel.addEventListener('click', () => closeSavePicker());
savePickerModal.addEventListener('click', event => {
    if (event.target === savePickerModal) closeSavePicker();
});

overwriteConfirmAccept.addEventListener('click', () => settleOverwriteConfirmation(true));
overwriteConfirmCancel.addEventListener('click', () => settleOverwriteConfirmation(false));
overwriteConfirmModal.addEventListener('click', event => {
    if (event.target === overwriteConfirmModal) settleOverwriteConfirmation(false);
});

    function getSavePickerEntries() {
        return savePickerEntries;
    }

    function getSelectedSaveValue() {
        return selectedSaveValue;
    }

    return {
        getSavePickerEntries,
        getSelectedSaveValue,
        savePickerModal,
        savePickerMessage,
        saveSlotsElement,
        saveSlotConfirm,
        overwriteConfirmAccept,
        overwriteConfirmCancel,
        isSavePickerOpen,
        isOverwriteConfirmationOpen,
        selectSaveEntry,
        handleSavePickerConfirm,
        settleOverwriteConfirmation,
        closeSavePicker,
        renderSaveSlots,
        refreshContinueGameAction,
        startGameFromSelection
    };
}
