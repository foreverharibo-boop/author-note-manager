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

export const signature = note => JSON.stringify(note);

// Compact equality keys avoid keeping a complete copy of the default on every keystroke.
function equalityKey(text) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 16777619);
        b = Math.imul(b, 33) ^ c;
    }
    return `${text.length}:${a >>> 0}:${b >>> 0}`;
}

export function globalState(settings) {
    settings.note ??= {};
    settings[KEY] ??= { items: [], defaultHistory: [], title: '기존 기본 작가노트' };
    settings[KEY].legacyScan ??= Boolean(settings.note.allowWIScan);
    return settings[KEY];
}

// Snapshot legacy options once; later native changes must not change other items.
export function itemSettings(item, legacyScan = false) {
    item.position = integer(item.position, 1, 2);
    item.role = integer(item.role, 0, 2);
    item.scan ??= Boolean(legacyScan);
    return item;
}

export function chatState(metadata) {
    metadata[KEY] ??= { items: [], title: '기존 작가노트' };
    return metadata[KEY];
}

export function hasChat(ctx) {
    return ctx.chatId !== undefined && ctx.chatId !== null && ctx.chatId !== ''
        && (ctx.groupId != null || ctx.characterId != null);
}

/** Keep inherited native notes linked, while preserving edited chat notes. */
export function reconcile(ctx) {
    const needsLegacyScan = ctx.extensionSettings[KEY]?.legacyScan === undefined;
    const global = globalState(ctx.extensionSettings);
    const base = nativeNote(ctx.extensionSettings.note, true);
    const currentDefault = signature(base);
    let settingsChanged = needsLegacyScan;
    const migrate = items => {
        let changed = false;
        for (const item of items) {
            if (item.scan === undefined || item.role === undefined || item.position === undefined) changed = true;
            itemSettings(item, global.legacyScan);
        }
        return changed;
    };
    settingsChanged = migrate(global.items) || settingsChanged;
    if (global.lastDefault !== currentDefault) {
        const previousKey = global.lastDefault && equalityKey(global.lastDefault);
        if (previousKey && !global.defaultHistory.includes(previousKey)) {
            global.defaultHistory.push(previousKey);
        }
        global.lastDefault = currentDefault;
        settingsChanged = true;
    }
    if (!hasChat(ctx)) return { settingsChanged, metadataChanged: false, linked: false };
    const fresh = !ctx.chatMetadata[KEY];
    const local = chatState(ctx.chatMetadata);
    const native = nativeNote(ctx.chatMetadata);
    const current = signature(native);
    let metadataChanged = migrate(local.items) || fresh;
    if (local.linkedDefault === undefined) {
        local.linkedDefault = !native.text || current === currentDefault || global.defaultHistory.includes(equalityKey(current));
        local.lastMirrored = current;
        metadataChanged = true;
    } else if (local.linkedDefault && current !== local.lastMirrored) {
        local.linkedDefault = false;
        metadataChanged = true;
    }
    if (local.linkedDefault) {
        for (const [field, value] of Object.entries(base)) {
            const key = field === 'text' ? 'note_prompt' : `note_${field}`;
            if (ctx.chatMetadata[key] !== value) {
                ctx.chatMetadata[key] = value;
                metadataChanged = true;
            }
        }
        local.lastMirrored = currentDefault;
    }
    return { settingsChanged, metadataChanged, linked: local.linkedDefault };
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
    const base = nativeNote(ctx.extensionSettings.note, true);
    const localText = nativeNote(ctx.chatMetadata).text;
    if (!local.linkedDefault && base.text.trim() && base.text !== localText && due(base.interval, ctx.chat)) {
        out.push({ key: `${PREFIX}default`, ...base, scan: Boolean(ctx.extensionSettings.note.allowWIScan) });
    }
    for (const [scope, items] of [['common', global.items], ['chat', local.items]]) {
        items.forEach((item, index) => {
            itemSettings(item, global.legacyScan);
            if (item.enabled && item.text.trim()) {
                out.push({ key: `${PREFIX}${scope}:${String(index).padStart(6, '0')}`,
                    text: item.text, depth: integer(item.depth), position: item.position, role: item.role, scan: Boolean(item.scan) });
            }
        });
    }
    return out;
}

export function newItem() {
    return { id: crypto.randomUUID(), title: '새 항목', text: '', depth: 4, position: 1, role: 0, scan: false, enabled: true };
}
