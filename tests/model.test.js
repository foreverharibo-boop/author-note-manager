import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, globalState, chatState, reconcile, prompts, due, integer } from '../model.js';

function fixture(text = 'Default note') {
    return { chatId: 'chat-a', characterId: 0, groupId: null, chat: [],
        extensionSettings: { note: { default: 'Default note', defaultDepth: 4, defaultInterval: 1, defaultPosition: 1, defaultRole: 0 } },
        chatMetadata: { note_prompt: text, note_depth: 4, note_interval: 1, note_position: 1, note_role: 0 } };
}
function template(ctx, patch = {}) {
    const item = {id:'template-1',title:'Template title',text:'Template body',depth:8,position:1,role:2,scan:true,enabled:true,collapsed:true,...patch};
    globalState(ctx.extensionSettings).items.push(item);
    return item;
}
const native = ctx => Object.fromEntries(Object.entries(ctx.chatMetadata).filter(([key])=>key.startsWith('note_')));
const texts = ctx => prompts(ctx).map(p=>p.text);
const startChat = ctx => { reconcile(ctx); return reconcile(ctx,{newChat:true}); };

test('new chat copies complete templates once, without sharing objects or injecting defaults twice',()=>{
    const ctx=fixture(),source=template(ctx),before=native(ctx);
    const global=globalState(ctx.extensionSettings);global.title='Native title';global.nativeCollapsed=true;global.previousInterval=5;
    assert.equal(startChat(ctx).metadataChanged,true);
    const local=chatState(ctx.chatMetadata);
    assert.deepEqual(local.items,[source]);assert.notEqual(local.items[0],source);assert.notEqual(local.items,global.items);
    assert.equal(local.title,'Native title');assert.equal(local.nativeCollapsed,true);assert.equal(local.previousInterval,5);
    assert.deepEqual(native(ctx),before);assert.deepEqual(texts(ctx),['Template body']);
    assert(prompts(ctx).every(p=>p.key.startsWith('author-note-items:chat:')));
    assert.equal(reconcile(ctx).metadataChanged,false);assert.equal(local.items.length,1);
});
test('template edits, toggles, deletion and additions never change an initialized chat',()=>{
    const ctx=fixture();template(ctx);startChat(ctx);const saved=structuredClone(ctx.chatMetadata);
    const global=globalState(ctx.extensionSettings);global.items[0].text='New template';global.items[0].enabled=false;
    global.items.splice(0,1);template(ctx,{id:'new',text:'Future template'});global.title='Changed';global.nativeCollapsed=false;
    Object.assign(ctx.extensionSettings.note,{default:'Changed default',defaultDepth:9,defaultInterval:0,defaultPosition:0,defaultRole:2});
    reconcile(ctx);assert.deepEqual(ctx.chatMetadata,saved);assert.deepEqual(texts(ctx),['Template body']);
});
test('chat edits and removal do not change templates or another chat, including after reload',()=>{
    const a=fixture();template(a);startChat(a);
    const b={...fixture(),chatId:'b',extensionSettings:a.extensionSettings};startChat(b);
    const templateBefore=structuredClone(a.extensionSettings),bBefore=structuredClone(b.chatMetadata);
    Object.assign(chatState(a.chatMetadata).items[0],{text:'A only',title:'A title',depth:1,position:0,role:1,scan:false,enabled:false,collapsed:false});
    a.chatMetadata.note_prompt='A native';a.chatMetadata.note_interval=0;reconcile(a);
    chatState(a.chatMetadata).items.length=0;reconcile(a);
    assert.deepEqual(a.extensionSettings,templateBefore);assert.deepEqual(b.chatMetadata,bBefore);
    const restored=JSON.parse(JSON.stringify(a));reconcile(restored);assert.deepEqual(chatState(restored.chatMetadata).items,[]);
    assert.equal(restored.chatMetadata.note_prompt,'A native');assert.equal(restored.chatMetadata.note_interval,0);
});
test('future chats receive latest defaults while returning chats keep their own snapshots',()=>{
    const ctx=fixture();template(ctx);startChat(ctx);const a=structuredClone(ctx.chatMetadata);
    globalState(ctx.extensionSettings).items[0].text='Future';
    ctx.chatId='b';ctx.chatMetadata=fixture().chatMetadata;startChat(ctx);assert.deepEqual(texts(ctx),['Future']);
    ctx.chatId='a';ctx.chatMetadata=a;reconcile(ctx);assert.deepEqual(texts(ctx),['Template body']);
});
test('empty snapshots remain empty after templates are later added',()=>{
    const ctx=fixture();startChat(ctx);template(ctx);startChat(ctx);assert.deepEqual(texts(ctx),[]);
    const restored=JSON.parse(JSON.stringify(ctx));reconcile(restored);assert.deepEqual(texts(restored),[]);
});
for(const text of ['', 'Custom note', 'Default note'])test(`native note content and settings are never rewritten, even when blank: ${text}`,()=>{
    const ctx=fixture(text);ctx.chatMetadata.note_interval=0;ctx.chatMetadata.note_depth=0;const before=native(ctx);
    reconcile(ctx);ctx.extensionSettings.note.default='Different default';reconcile(ctx);assert.deepEqual(native(ctx),before);assert.deepEqual(prompts(ctx),[]);
});
test('native fields missing at extension initialization are left to SillyTavern',()=>{
    const ctx=fixture();ctx.chatMetadata={};reconcile(ctx);assert.deepEqual(native(ctx),{});
});
test('existing conversations without extension metadata are not backfilled with current defaults',()=>{
    const ctx=fixture('Existing native');ctx.chat=[{is_user:true,mes:'Old conversation'}];template(ctx);reconcile(ctx);
    assert.deepEqual(texts(ctx),[]);assert.equal(ctx.chatMetadata.note_prompt,'Existing native');
    ctx.chat=[];reconcile(ctx);assert.deepEqual(texts(ctx),[]);
});
test('new group chats with greetings initialize independently; home screen does not create chat state',()=>{
    const ctx=fixture();ctx.characterId=undefined;ctx.groupId='group';ctx.chat=[{is_user:false,mes:'Hello'},{is_user:false,mes:'Hi'}];template(ctx);startChat(ctx);assert.equal(texts(ctx).length,1);
    ctx.chatId=undefined;ctx.chatMetadata={};reconcile(ctx);assert.deepEqual(ctx.chatMetadata,{});assert.deepEqual(prompts(ctx),[]);
});
test('branches preserve inherited metadata and deletions instead of reapplying templates',()=>{
    const ctx=fixture();template(ctx);startChat(ctx);chatState(ctx.chatMetadata).items=[];
    const branch={...ctx,chatId:'branch',chatMetadata:structuredClone(ctx.chatMetadata)};reconcile(branch);assert.deepEqual(texts(branch),[]);
});
test('placement, role, scan, disabled and blank templates survive copying and reloading',()=>{
    const ctx=fixture();template(ctx,{position:2,role:0,scan:false});template(ctx,{id:'off',enabled:false});template(ctx,{id:'blank',text:' '});
    startChat(ctx);chatState(ctx.chatMetadata).items.push({id:'local',text:'Local',enabled:true,depth:0,position:0,role:1,scan:true});
    const expected=[[2,8,0,false],[0,0,1,true]],settings=c=>prompts(c).map(p=>[p.position,p.depth,p.role,p.scan]);
    assert.deepEqual(settings(ctx),expected);ctx.extensionSettings.note.allowWIScan=true;
    const restored=JSON.parse(JSON.stringify(ctx));reconcile(restored);assert.deepEqual(settings(restored),expected);assert.equal(chatState(restored.chatMetadata).items.length,4);
});
test('legacy shared items become independent once; native/local content and disabled items are preserved',()=>{
    const ctx=fixture('Saved native');ctx.chat=[{is_user:true,mes:'Old chat'}];ctx.extensionSettings.note.allowWIScan=true;
    ctx.extensionSettings[KEY]={items:[{id:'shared',text:'Shared at upgrade',depth:6,enabled:true},{id:'off',text:'Disabled',enabled:false}],defaultHistory:[],title:'Old default'};
    ctx.chatMetadata[KEY]={items:[{id:'private',text:'Private',enabled:true,depth:0}],title:'Private title',linkedDefault:true,lastMirrored:'old'};
    const before=native(ctx),result=reconcile(ctx),local=chatState(ctx.chatMetadata);
    assert(result.settingsChanged&&result.metadataChanged);assert.deepEqual(native(ctx),before);assert.equal(local.title,'Private title');
    assert.deepEqual(texts(ctx),['Shared at upgrade','Private']);assert.equal(local.items.length,3);assert(local.items.every(x=>x.scan===true));
    assert.equal(local.linkedDefault,undefined);assert.equal(local.lastMirrored,undefined);
    globalState(ctx.extensionSettings).items[0].text='Later template';reconcile(ctx);assert.deepEqual(texts(ctx),['Shared at upgrade','Private']);
    assert.equal(local.items.length,3);assert.notEqual(local.items[0],globalState(ctx.extensionSettings).legacySharedItems[0]);
});
test('unopened legacy chats migrate the frozen upgrade snapshot, not later template edits',()=>{
    const ctx=fixture();ctx.chatId=undefined;ctx.chatMetadata={};ctx.extensionSettings[KEY]={items:[{id:'old',text:'At upgrade',enabled:true,depth:2}],defaultHistory:[]};
    reconcile(ctx);globalState(ctx.extensionSettings).items[0].text='Changed later';
    ctx.chatId='old';ctx.chat=[{is_user:true}];ctx.chatMetadata={...fixture().chatMetadata,[KEY]:{items:[]}};reconcile(ctx);assert.deepEqual(texts(ctx),['At upgrade']);
    ctx.chatId='new';ctx.chat=[];ctx.chatMetadata=fixture().chatMetadata;startChat(ctx);assert.deepEqual(texts(ctx),['Changed later']);
});
test('legacy scan defaults remain stable after the native scan checkbox changes',()=>{
    const ctx=fixture();ctx.extensionSettings.note.allowWIScan=true;
    ctx.extensionSettings[KEY]={items:[],defaultHistory:[]};ctx.chatMetadata[KEY]={items:[{text:'Legacy',enabled:true,depth:1}]};reconcile(ctx);
    ctx.extensionSettings.note.allowWIScan=false;assert.equal(prompts(ctx)[0].scan,true);
    chatState(ctx.chatMetadata).items[0].scan=false;assert.equal(prompts(ctx)[0].scan,false);
});
test('native frequency helper and depth bounds retain existing semantics',()=>{
    assert.equal(due(1,[]),true);assert.equal(due(0,[{is_user:true}]),false);assert.equal(due(2,[{is_user:true}]),false);assert.equal(due(2,[{is_user:true},{is_user:true}]),true);
    assert.equal(integer(-1),0);assert.equal(integer('bad'),4);assert.equal(integer(1e9),9999);
});

test('greeting-only and empty existing chats do not inherit templates without a creation event',()=>{
    for(const chat of [[],[{is_user:false,mes:'Greeting'}]]){
        const ctx=fixture();ctx.chat=chat;template(ctx);reconcile(ctx);assert.deepEqual(texts(ctx),[]);
        reconcile(ctx);assert.deepEqual(texts(ctx),[]);
        reconcile(ctx,{newChat:true});assert.deepEqual(texts(ctx),['Template body']);
        chatState(ctx.chatMetadata).items=[];reconcile(ctx,{newChat:true});assert.deepEqual(texts(ctx),[]);
    }
});
