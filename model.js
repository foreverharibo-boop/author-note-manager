export const KEY = 'authorNoteItems';
export const PREFIX = 'author-note-items:';

export function integer(value, fallback = 4, max = 9999) {
    if (value === '' || value === null || value === undefined) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.trunc(number))) : fallback;
}

export function nativeNote(source, defaults = false) {
    return {
        text: String((defaults ? source.default : source.note_prompt) ?? ''),
        depth: integer(defaults ? source.defaultDepth : source.note_depth),
        position: integer(defaults ? source.defaultPosition : source.note_position, 1, 2),
        role: integer(defaults ? source.defaultRole : source.note_role, 0, 2),
        interval: integer(defaults ? source.defaultInterval : source.note_interval, 1),
    };
}

export function globalState(settings) {
    settings.note ??= {};
    settings[KEY] ??= { items: [], templateVersion: 1, title: '기존 기본 작가노트' };
    settings[KEY].legacyScan ??= Boolean(settings.note.allowWIScan);
    return settings[KEY];
}

// Snapshot legacy options once; later native changes must not change other items.
export function itemSettings(item, legacyScan = false) {
    item.position = integer(item.position, 1, 2);
    item.role = integer(item.role, 0, 2);
    item.scan ??= Boolean(legacyScan);
    item.interval = integer(item.interval, 1);
    if (item.enabled === false && item.interval > 0) {
        item.previousInterval = item.interval;
        item.interval = 0;
    }
    if (item.interval === 0) item.enabled = false;
    return item;
}

export function setItemInterval(item, value) {
    const interval = integer(value, item.interval ?? 1);
    if (item.interval > 0) item.previousInterval = item.interval;
    item.interval = interval;
    item.enabled = interval > 0;
    if (interval > 0) item.previousInterval = interval;
}

export function setItemEnabled(item, enabled) {
    setItemInterval(item, enabled ? (item.interval || integer(item.previousInterval, 1) || 1) : 0);
}

export function chatState(metadata) {
    metadata[KEY] ??= { items: [], title: '기존 작가노트' };
    return metadata[KEY];
}

export function hasChat(ctx) {
    return ctx.chatId !== undefined && ctx.chatId !== null && ctx.chatId !== ''
        && (ctx.groupId != null || ctx.characterId != null);
}

/** Defaults are templates. Each chat owns a one-time, independent snapshot. */
export function reconcile(ctx, { newChat = false } = {}) {
    const needsLegacyScan = ctx.extensionSettings[KEY]?.legacyScan === undefined;
    const global = globalState(ctx.extensionSettings);
    let settingsChanged = needsLegacyScan;
    const migrate = items => {
        let changed = false;
        for (const item of items) {
            if (item.scan === undefined || item.role === undefined || item.position === undefined) changed = true;
            const before = [item.interval, item.enabled, item.previousInterval];
            itemSettings(item, global.legacyScan);
            if (before.some((value, index) => value !== [item.interval, item.enabled, item.previousInterval][index])) changed = true;
        }
        return changed;
    };
    settingsChanged = migrate(global.items) || settingsChanged;
    // Freeze old shared items once, before later template edits. Unopened legacy
    // chats must not inherit whatever the user happens to change them to later.
    if (global.templateVersion !== 1) {
        global.legacySharedItems = structuredClone(global.items);
        global.templateVersion = 1;
        settingsChanged = true;
    }
    if (Array.isArray(global.legacySharedItems)) settingsChanged = migrate(global.legacySharedItems) || settingsChanged;
    if (!hasChat(ctx)) return { settingsChanged, metadataChanged: false };
    const fresh = !ctx.chatMetadata[KEY];
    const local = chatState(ctx.chatMetadata);
    let metadataChanged = migrate(local.items) || fresh;
    if (local.templateInitialized !== true) {
        // Existing chats are never guessed to be new from their message count.
        const source = fresh ? [] : (global.legacySharedItems || []);
        local.items = [...structuredClone(source), ...local.items];
        local.defaultsApplied = !fresh;
        local.templateInitialized = true;
        delete local.linkedDefault;
        delete local.lastMirrored;
        metadataChanged = true;
    }
    // SillyTavern emits CHAT_CREATED/GROUP_CHAT_CREATED after CHAT_CHANGED.
    // The ordinary change handler may have already initialized an empty state.
    if (newChat && local.defaultsApplied !== true) {
        if (!local.items.length) {
            local.items = structuredClone(global.items);
            local.title = global.title;
            local.nativeCollapsed = Boolean(global.nativeCollapsed);
            if (global.previousInterval !== undefined) local.previousInterval = global.previousInterval;
        }
        local.defaultsApplied = true;
        metadataChanged = true;
    }
    return { settingsChanged, metadataChanged };
}

export function due(interval, chat) {
    const n = integer(interval, 1);
    if (n === 1) return true;
    const count = (chat ?? []).filter(message => message.is_user).length;
    return n > 0 && count > 0 && count % n === 0;
}

/** Native first chat item stays on SillyTavern's own injection path. */
export function prompts(ctx) {
    if (!hasChat(ctx)) return [];
    const global = globalState(ctx.extensionSettings);
    const local = chatState(ctx.chatMetadata);
    const out = [];
    local.items.forEach((item, index) => {
        itemSettings(item, global.legacyScan);
        if (item.enabled && item.text.trim() && due(item.interval, ctx.chat)) {
            out.push({ key: `${PREFIX}chat:${String(index).padStart(6, '0')}`,
                text: item.text, depth: integer(item.depth), position: item.position, role: item.role, scan: Boolean(item.scan) });
        }
    });
    return out;
}

export function newItem() {
    return { id: crypto.randomUUID(), title: '새 항목', text: '', interval: 1, depth: 4, position: 1, role: 0, scan: false, enabled: true };
}
