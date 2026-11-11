import { setFloatingPrompt } from '../../../authors-note.js';
import { PREFIX, integer, globalState, chatState, hasChat, reconcile, prompts, newItem } from './model.js';

const context = () => SillyTavern.getContext();
const sections = new Map();
let syncing = false;
let mounted = false;
let foldSequence = 0;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function state(scope, ctx = context()) {
    return scope === 'common' ? globalState(ctx.extensionSettings) : chatState(ctx.chatMetadata);
}

function save(scope, ctx = context()) {
    if (scope === 'common') ctx.saveSettingsDebounced();
    else if (hasChat(ctx)) ctx.saveMetadataDebounced();
}

function refreshPrompts() {
    const ctx = context();
    for (const key of Object.keys(ctx.extensionPrompts)) {
        if (key.startsWith(PREFIX)) delete ctx.extensionPrompts[key];
    }
    for (const note of prompts(ctx)) {
        ctx.setExtensionPrompt(note.key, note.text, note.position, note.depth,
            ctx.extensionSettings.note?.allowWIScan ?? false, note.role);
    }
}

function mirrorNativeFields(ctx) {
    const $ = globalThis.jQuery;
    $('#extension_floating_prompt').val(ctx.chatMetadata.note_prompt ?? '');
    for (const field of ['depth', 'interval', 'role']) {
        $(`#extension_floating_${field}`).val(ctx.chatMetadata[`note_${field}`]);
    }
    $('input[name="extension_floating_position"]').each(function () {
        this.checked = Number(this.value) === ctx.chatMetadata.note_position;
    });
}

function synchronize(render = false) {
    if (syncing) return;
    syncing = true;
    try {
        const ctx = context();
        const result = reconcile(ctx);
        if (result.settingsChanged) ctx.saveSettingsDebounced();
        if (result.metadataChanged) {
            mirrorNativeFields(ctx);
            ctx.saveMetadataDebounced();
        }
        if (hasChat(ctx)) setFloatingPrompt();
        refreshPrompts();
        if (render) renderLists();
        updateNativeToggles();
    } finally {
        syncing = false;
    }
}

function switchControl(labelText, checked, onChange) {
    const label = element('label', 'ani-switch');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', labelText);
    const track = element('span', 'ani-switch-track');
    track.setAttribute('aria-hidden', 'true');
    const caption = element('span', 'ani-switch-caption', checked ? '켜짐' : '꺼짐');
    label.title = checked ? '끄기' : '켜기';
    input.addEventListener('change', () => {
        caption.textContent = input.checked ? '켜짐' : '꺼짐';
        label.title = input.checked ? '끄기' : '켜기';
        onChange(input.checked);
    });
    label.append(input, track, caption);
    return { label, input, caption };
}

function foldControl(header, content, getCollapsed, setCollapsed) {
    content.id = `ani-content-${++foldSequence}`;
    const button = element('button', 'ani-fold');
    button.type = 'button';
    button.setAttribute('aria-controls', content.id);
    const icon = element('i', 'inline-drawer-icon fa-solid');
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    const update = () => {
        const collapsed = Boolean(getCollapsed());
        content.hidden = collapsed;
        icon.classList.toggle('fa-circle-chevron-down', collapsed);
        icon.classList.toggle('fa-circle-chevron-up', !collapsed);
        icon.classList.toggle('down', collapsed);
        icon.classList.toggle('up', !collapsed);
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', collapsed ? '항목 펼치기' : '항목 접기');
        button.title = collapsed ? '펼치기' : '접기';
    };
    const toggle = () => { setCollapsed(!getCollapsed()); update(); };
    button.addEventListener('click', toggle);
    header.addEventListener('click', event => {
        if (event.target.closest('input, button, label, select, textarea, a')) return;
        toggle();
    });
    header.append(button);
    update();
    return { update, button };
}

function renderCard(scope, item, owner) {
    const card = element('section', 'ani-card');
    card.dataset.enabled = String(item.enabled);
    const top = element('div', 'inline-drawer-header ani-card-top');
    const title = element('input', 'text_pole textarea_compact ani-title');
    title.value = item.title;
    title.placeholder = '항목 제목';
    title.setAttribute('aria-label', '항목 제목');
    // The rendered owner is checked so events from an old chat cannot edit a new one.
    const editable = () => scope === 'common' || (hasChat(context()) && state(scope) === owner);
    const changed = () => { save(scope); refreshPrompts(); };
    title.addEventListener('input', () => {
        if (!editable()) return;
        item.title = title.value;
        toggle.input.setAttribute('aria-label', `${item.title || '이름 없는 항목'} 사용`);
        changed();
    });
    const toggle = switchControl(`${item.title} 사용`, item.enabled, enabled => {
        if (!editable()) return;
        item.enabled = enabled;
        card.dataset.enabled = String(enabled);
        changed();
    });
    top.append(toggle.label, title);
    const body = element('textarea', 'text_pole textarea_compact ani-body');
    body.rows = 8;
    body.value = item.text;
    body.placeholder = 'AI에게 전달할 작가노트를 입력합니다.';
    body.setAttribute('aria-label', '작가노트 내용');
    body.setAttribute('data-macros', '');
    body.addEventListener('input', () => {
        if (!editable()) return;
        item.text = body.value;
        changed();
    });
    const bottom = element('div', 'ani-card-bottom');
    const depthLabel = element('label', 'ani-depth-label', '깊이');
    const depth = element('input', 'text_pole textarea_compact widthNatural ani-depth');
    depth.type = 'number';
    depth.min = '0';
    depth.max = '9999';
    depth.step = '1';
    depth.value = item.depth;
    depth.addEventListener('input', () => {
        if (!editable() || depth.value === '' || !depth.validity.valid) return;
        item.depth = integer(depth.value);
        changed();
    });
    depth.addEventListener('change', () => {
        if (!editable()) return;
        item.depth = integer(depth.value, item.depth);
        depth.value = item.depth;
        changed();
    });
    depthLabel.append(depth);
    const remove = element('button', 'menu_button ani-remove', '삭제');
    remove.type = 'button';
    remove.addEventListener('click', () => {
        if (!editable() || !window.confirm(`“${item.title || '이름 없는 항목'}”을 삭제할까요?`)) return;
        const index = owner.items.indexOf(item);
        if (index < 0) return;
        owner.items.splice(index, 1);
        changed();
        renderLists();
    });
    bottom.append(depthLabel, remove);
    const content = element('div', 'ani-content');
    content.append(body, bottom);
    foldControl(top, content, () => item.collapsed, collapsed => {
        if (!editable()) return;
        item.collapsed = collapsed;
        save(scope);
    });
    card.append(top, content);
    return card;
}

function renderLists() {
    const ctx = context();
    for (const [scope, section] of sections) {
        section.list.replaceChildren();
        const available = scope === 'common' || hasChat(ctx);
        section.add.disabled = !available;
        section.nativeTitle.disabled = !available;
        section.toggle.input.disabled = !available;
        if (!available) {
            section.list.append(element('p', 'ani-hint', '채팅을 열면 이 채팅의 항목을 관리할 수 있습니다.'));
            continue;
        }
        const owner = state(scope, ctx);
        section.nativeTitle.value = owner.title;
        section.fold.update();
        for (const item of owner.items) {
            if (section.list.childElementCount) section.list.append(element('hr', 'sysHR'));
            section.list.append(renderCard(scope, item, owner));
        }
    }
}

function updateNativeToggles() {
    const ctx = context();
    for (const [scope, section] of sections) {
        const inputId = scope === 'common' ? 'extension_default_interval' : 'extension_floating_interval';
        const enabled = Number(document.getElementById(inputId)?.value ?? 0) > 0;
        section.toggle.input.checked = enabled;
        section.toggle.caption.textContent = enabled ? '켜짐' : '꺼짐';
        section.toggle.label.title = enabled ? '끄기' : '켜기';
        if (scope === 'chat') {
            const linked = hasChat(ctx) && state(scope, ctx).linkedDefault;
            section.toggle.input.disabled = !hasChat(ctx) || linked;
            section.linked.textContent = hasChat(ctx) && state(scope, ctx).linkedDefault
                ? '기본 작가노트와 연결되어 있습니다. 켜기/끄기는 아래 기본 작가노트에서 관리합니다. 여기서 본문·깊이 등을 바꾸면 현재 채팅 전용으로 분리됩니다.'
                : '이 첫 항목은 실리태번의 기존 작가노트와 같은 내용입니다.';
        }
    }
}

function mountSection(scope, textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return false;
    const container = textarea.parentElement;
    container.classList.add('ani-native-section');
    const intro = element('p', 'ani-hint', scope === 'common'
        ? '공통 항목은 모든 채팅에 적용됩니다. 기존 기본 작가노트의 복사본은 연결하여 한 번만 넣고, 따로 수정한 채팅 노트는 보존합니다.'
        : '기존 작가노트와 이 채팅 전용 항목을 관리합니다. 꺼도 내용은 보관됩니다.');
    // Replace only the old explanatory caption; all native controls retain their handlers.
    const oldCaption = container.querySelector(':scope > small');
    if (oldCaption) oldCaption.classList.add('ani-original-caption');
    container.insertBefore(intro, textarea);
    const header = element('div', 'inline-drawer-header ani-card-top ani-native-top');
    const nativeTitle = element('input', 'text_pole textarea_compact ani-title');
    nativeTitle.placeholder = '항목 제목';
    nativeTitle.setAttribute('aria-label', '기존 항목 제목');
    nativeTitle.addEventListener('input', () => {
        if (scope === 'chat' && !hasChat(context())) return;
        state(scope).title = nativeTitle.value;
        save(scope);
    });
    const toggle = switchControl(scope === 'common' ? '기본 작가노트 사용' : '현재 작가노트 사용', true, enabled => {
        if (scope === 'chat' && !hasChat(context())) return;
        const owner = state(scope);
        const id = scope === 'common' ? 'extension_default_interval' : 'extension_floating_interval';
        const input = document.getElementById(id);
        if (!enabled && Number(input.value) > 0) owner.previousInterval = integer(input.value, 1);
        globalThis.jQuery(input).val(enabled ? (owner.previousInterval || 1) : 0).trigger('input');
        save(scope);
        synchronize();
    });
    header.append(toggle.label, nativeTitle);
    container.insertBefore(header, textarea);
    const linked = element('p', 'ani-hint ani-linked');
    if (scope === 'chat') container.insertBefore(linked, textarea);
    // Move, rather than recreate, native fields so their values and handlers survive.
    const nativeContent = element('div', 'ani-content ani-native-content');
    while (header.nextSibling) nativeContent.append(header.nextSibling);
    container.append(nativeContent);
    const fold = foldControl(header, nativeContent,
        () => scope === 'common' || hasChat(context()) ? state(scope).nativeCollapsed : false,
        collapsed => {
            if (scope === 'chat' && !hasChat(context())) return;
            state(scope).nativeCollapsed = collapsed;
            save(scope);
        });
    const extra = element('div', 'ani-extra');
    extra.append(element('hr', 'sysHR'));
    extra.append(element('div', 'ani-extra-heading', scope === 'common' ? '공통 추가 항목' : '이 채팅의 추가 항목'));
    extra.append(element('p', 'ani-hint', '추가 항목은 각각 지정한 깊이에 시스템 메시지로 들어갑니다. 깊이 0은 마지막 메시지 위치입니다.'));
    const list = element('div', 'ani-list');
    const add = element('button', 'menu_button ani-add', '+ 항목 추가');
    add.type = 'button';
    add.addEventListener('click', () => {
        if (scope === 'chat' && !hasChat(context())) return;
        state(scope).items.push(newItem());
        save(scope);
        renderLists();
        list.lastElementChild?.querySelector('.ani-title')?.focus();
    });
    extra.append(list, add);
    container.append(extra);
    sections.set(scope, { list, add, nativeTitle, toggle, linked, fold });
    return true;
}

function initialize() {
    if (mounted) return;
    if (!document.getElementById('extension_floating_prompt') || !document.getElementById('extension_floating_default')) return;
    mounted = true;
    mountSection('chat', 'extension_floating_prompt');
    mountSection('common', 'extension_floating_default');
    const nativeSelector = [
        '#extension_floating_prompt', '#extension_floating_depth', '#extension_floating_interval', '#extension_floating_role',
        '#extension_floating_default', '#extension_default_depth', '#extension_default_interval', '#extension_default_role',
        '#extension_floating_allow_wi_scan', 'input[name="extension_floating_position"]', 'input[name="extension_default_position"]',
    ].join(',');
    globalThis.jQuery(document).on('input.authorNoteItems change.authorNoteItems', nativeSelector, () => synchronize());
    const ctx = context();
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => synchronize(true));
    ctx.eventSource.on(ctx.eventTypes.GENERATION_AFTER_COMMANDS, () => synchronize());
    synchronize(true);
}

const ctx = context();
ctx.eventSource.on(ctx.eventTypes.APP_READY, initialize);
// Extension reloads can happen after APP_READY.
globalThis.jQuery(initialize);
