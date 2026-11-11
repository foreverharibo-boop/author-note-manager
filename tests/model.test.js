import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, globalState, chatState, reconcile, prompts, due, integer } from '../model.js';

function fixture(text = '공통 문체') {
    return { chatId: 'chat-a', characterId: 0, groupId: null, chat: [],
        extensionSettings: { note: { default: '공통 문체', defaultDepth: 4, defaultInterval: 1, defaultPosition: 1, defaultRole: 0 } },
        chatMetadata: { note_prompt: text, note_depth: 4, note_interval: 1, note_position: 1, note_role: 0 } };
}

test('existing native default copy uses the native path exactly once', () => {
    const ctx = fixture();
    assert.equal(reconcile(ctx).linked, true);
    assert.deepEqual(prompts(ctx), []);
    assert.equal(ctx.chatMetadata.note_prompt, '공통 문체');
});

test('global edit and toggle propagate to inherited current and older chats', () => {
    const ctx = fixture();
    reconcile(ctx);
    ctx.extensionSettings.note.default = '바뀐 문체';
    ctx.extensionSettings.note.defaultDepth = 7;
    ctx.extensionSettings.note.defaultInterval = 0;
    reconcile(ctx);
    assert.equal(ctx.chatMetadata.note_prompt, '바뀐 문체');
    assert.equal(ctx.chatMetadata.note_depth, 7);
    assert.equal(ctx.chatMetadata.note_interval, 0);
    ctx.chatId = 'older';
    ctx.chatMetadata = fixture().chatMetadata;
    reconcile(ctx);
    assert.equal(ctx.chatMetadata.note_prompt, '바뀐 문체');
    assert.equal(ctx.chatMetadata.note_interval, 0);
});

test('custom native note is preserved and common default is additional', () => {
    const ctx = fixture('현재 방 장면');
    reconcile(ctx);
    assert.equal(ctx.chatMetadata.note_prompt, '현재 방 장면');
    assert.deepEqual(prompts(ctx).map(p => p.text), ['공통 문체']);
    ctx.extensionSettings.note.default = '새 공통';
    reconcile(ctx);
    assert.equal(ctx.chatMetadata.note_prompt, '현재 방 장면');
    assert.equal(prompts(ctx)[0].text, '새 공통');
});

test('native editing detaches inherited text without overwriting the edit', () => {
    const ctx = fixture();
    reconcile(ctx);
    ctx.chatMetadata.note_prompt = '직접 수정';
    reconcile(ctx);
    assert.equal(ctx.chatMetadata[KEY].linkedDefault, false);
    assert.equal(ctx.chatMetadata.note_prompt, '직접 수정');
});

test('enabled independent items retain their own depth, blank/off items do not inject', () => {
    const ctx = fixture();
    reconcile(ctx);
    globalState(ctx.extensionSettings).items.push({ text: '공통 항목', depth: 2, enabled: true });
    chatState(ctx.chatMetadata).items.push(
        { text: '장면', depth: 0, enabled: true },
        { text: '꺼진 기록', depth: 8, enabled: false },
        { text: '   ', depth: 1, enabled: true },
    );
    assert.deepEqual(prompts(ctx).map(p => [p.text, p.depth]), [['공통 항목', 2], ['장면', 0]]);
    assert.equal(chatState(ctx.chatMetadata).items[1].text, '꺼진 기록');
});

test('switching chat removes local items while shared edits remain live', () => {
    const ctx = fixture();
    reconcile(ctx);
    globalState(ctx.extensionSettings).items.push({ text: '공통', depth: 6, enabled: true });
    chatState(ctx.chatMetadata).items.push({ text: 'A 전용', depth: 1, enabled: true });
    const chatA = JSON.parse(JSON.stringify(ctx.chatMetadata));
    ctx.chatId = 'chat-b';
    ctx.chatMetadata = fixture().chatMetadata;
    reconcile(ctx);
    assert.deepEqual(prompts(ctx).map(p => p.text), ['공통']);
    globalState(ctx.extensionSettings).items[0].text = '공통 수정';
    ctx.chatId = 'chat-a';
    ctx.chatMetadata = chatA;
    reconcile(ctx);
    assert.deepEqual(prompts(ctx).map(p => p.text), ['공통 수정', 'A 전용']);
});

test('same text with a local depth override is not injected twice', () => {
    const ctx = fixture();
    reconcile(ctx);
    ctx.chatMetadata.note_depth = 2;
    reconcile(ctx);
    assert.equal(ctx.chatMetadata[KEY].linkedDefault, false);
    assert.deepEqual(prompts(ctx), []);
});

test('group chat and no-chat states are handled', () => {
    const ctx = fixture('그룹 메모');
    ctx.characterId = undefined;
    ctx.groupId = 'group-1';
    reconcile(ctx);
    assert.equal(prompts(ctx).length, 1);
    ctx.chatId = undefined;
    assert.deepEqual(prompts(ctx), []);
});

test('default frequency retains native semantics and depths are bounded', () => {
    assert.equal(due(1, []), true);
    assert.equal(due(0, [{ is_user: true }]), false);
    assert.equal(due(2, [{ is_user: true }, { is_user: false }]), false);
    assert.equal(due(2, [{ is_user: true }, { is_user: true }]), true);
    assert.equal(integer(-1), 0);
    assert.equal(integer('bad'), 4);
    assert.equal(integer(1e9), 9999);
});
