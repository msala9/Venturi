import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presetShortcutBinding,presetShortcutMatches,createPresetShortcuts} from '../js/preset-shortcuts.js';

const item=(id='preset-a',shortcut='Ctrl+Alt+Shift+G',revision='sha-a')=>({id,shortcut,revision,name:id});
const event=(key='g',extra={})=>({key,ctrlKey:true,altKey:true,shiftKey:true,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
function setup(commit){
  let handler,context={epoch:'e1',clip_ids:['9007199254740993']},writable=true,modal=false,menu=false;
  const calls=[],messages=[],document={hidden:false,addEventListener(type,listener,capture){assert.equal(type,'keydown');assert.equal(capture,true);handler=listener;},removeEventListener(){handler=null;},querySelector(selector){return modal && selector.includes('dialog') || menu && selector.includes('[role="menu"]');}};
  const shortcuts=createPresetShortcuts({getContext:()=>context,canCommit:()=>writable,commit:commit || (async operation=>calls.push(operation)),notice:text=>messages.push(text),document});
  return {shortcuts,calls,messages,dispatch:e=>handler?.(e),context:value=>context=value,writable:value=>writable=value,modal:value=>modal=value,menu:value=>menu=value,hidden:value=>document.hidden=value};
}

test('native shortcut strings retain complete modifiers and support browser-receivable letters, symbols and function keys',()=>{
  assert.deepEqual(presetShortcutBinding('Shift+Ctrl+Alt+G'),{key:'G',ctrl:true,alt:true,shift:true,label:'Ctrl+Shift+Alt+G'});
  for(const shortcut of ['G','Shift+G','Alt+G','Ctrl+Alt+G','F8','Ctrl+Alt+Shift+F8','F24','Shift+Down','Ctrl+Alt+Plus','Ctrl+Alt+Shift+C','Ctrl+Alt+Shift+V','Ctrl+Alt+Shift+g'])assert.equal(presetShortcutBinding(shortcut).reason,undefined,shortcut);
  for(const shortcut of [null,{},'Ctrl+Ctrl+Alt+Shift+G','Meta+Alt+Shift+G','F35','ControlLeft','Copy','BrowserBack'])assert.ok(presetShortcutBinding(shortcut).reason,shortcut);
  assert.match(presetShortcutBinding('F35').reason,/not exposed/);assert.match(presetShortcutBinding('ControlLeft').reason,/modifier key alone/);
  for(const shortcut of ['Ctrl++','Ctrl+G','Ctrl+Alt+Shift+K','Ctrl+Alt+Shift+O','Ctrl+Alt+Shift+S','Ctrl+Alt+Shift+Z','Ctrl+Alt+Shift+E','Ctrl+Alt+I','Alt+Shift+T','Alt+Shift+V','Ctrl+Shift+F5','Alt+F4','F2','Shift+F10','Ctrl+Shift+J'])assert.ok(presetShortcutBinding(shortcut).reason,shortcut);
  const binding=presetShortcutBinding('Ctrl+Alt+Shift+G');
  assert.equal(presetShortcutMatches(event(),binding),true);
  assert.equal(presetShortcutMatches(event('G',{ctrlKey:false,metaKey:true}),binding),true);
  for(const extra of [{repeat:true},{isComposing:true},{keyCode:229},{altKey:false},{shiftKey:false},{metaKey:true},{ctrlKey:false},{getModifierState:()=>true}])assert.equal(presetShortcutMatches(event('g',extra),binding),false);
});

test('symbol matching follows native logical Shift and exact command/Alt ownership; physical ISO key remains distinct',()=>{
  const plus=presetShortcutBinding('Ctrl+Alt+Plus');assert.equal(presetShortcutMatches(event('+',{shiftKey:false}),plus),true);assert.equal(presetShortcutMatches(event('+',{shiftKey:true}),plus),true);assert.equal(presetShortcutMatches(event('+',{altKey:false}),plus),false);
  assert.equal(presetShortcutMatches(event('ArrowDown',{ctrlKey:false,altKey:false,shiftKey:true}),presetShortcutBinding('Shift+Down')),true);
  assert.equal(presetShortcutMatches(event('<',{code:'IntlBackslash',shiftKey:false}),presetShortcutBinding('Ctrl+Alt+IntlBackslash')),true);
  assert.equal(presetShortcutMatches(event('F8'),presetShortcutBinding('Ctrl+Alt+Shift+F8')),true);assert.equal(presetShortcutMatches(event('F8',{ctrlKey:false,metaKey:true}),presetShortcutBinding('Ctrl+Alt+Shift+F8')),true);
});

test('native imported aliases normalize only for matching and duplicate ownership without rewriting preset metadata',()=>{
  for(const [alias,native]of [['Ctrl+Alt+ArrowUp','Ctrl+Alt+Up'],['Ctrl+Alt+NumpadAdd','Ctrl+Alt+Plus'],['Ctrl+Alt+Return','Ctrl+Alt+Enter'],['Ctrl+Alt+Backquote','Ctrl+Alt+Backtick'],['Ctrl+Alt+Digit8','Ctrl+Alt+8'],['Ctrl+Alt+KeyG','Ctrl+Alt+G']])assert.deepEqual(presetShortcutBinding(alias),presetShortcutBinding(native),alias);
  assert.match(presetShortcutBinding('Esc').reason,/canceling/);const preset=item('alias','Ctrl+Alt+KeyG'),s=setup();s.shortcuts.activate(preset);assert.equal(preset.shortcut,'Ctrl+Alt+KeyG');assert.throws(()=>s.shortcuts.activate(item('same','Alt+Ctrl+g')),/already enabled/);s.shortcuts.dispose();
});

test('same key with distinct full chords can coexist and each dispatches only its exact native preset once',async()=>{
  const s=setup();for(const [id,shortcut]of [['plain','F8'],['shift','Shift+F8'],['alt','Alt+F8'],['full','Ctrl+Alt+Shift+F8']])s.shortcuts.activate(item(id,shortcut));
  for(const [id,extra]of [['plain',{ctrlKey:false,altKey:false,shiftKey:false}],['shift',{ctrlKey:false,altKey:false}],['alt',{ctrlKey:false,shiftKey:false}],['full',{}]]){const pressed=event('F8',extra);s.dispatch(pressed);s.dispatch(event('F8',extra));await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.at(-1).preset_id,id);assert.equal(pressed.prevented,true);}
  assert.equal(s.calls.length,4);assert.throws(()=>s.shortcuts.activate(item('duplicate','Shift+Alt+Ctrl+F8')),/already enabled/);
  s.shortcuts.activate(item('symbol','Ctrl+Alt+Plus'));assert.throws(()=>s.shortcuts.activate(item('overlap','Ctrl+Alt+Shift+Plus')),/native symbols can consume Shift/);s.shortcuts.dispose();
});

test('capture shortcuts leave native button navigation, key-editor Delete and open menus to their owner',async()=>{
  const s=setup(),button={closest:selector=>selector.includes('button,summary')?{}:null},keys={closest:selector=>selector.includes('.curve-window')?{}:null};s.shortcuts.activate(item('enter','Shift+Enter'));s.shortcuts.activate(item('delete','Shift+Delete'));s.shortcuts.activate(item('plain','G'));
  s.dispatch(event('Enter',{ctrlKey:false,altKey:false,target:button}));s.dispatch(event('Delete',{ctrlKey:false,altKey:false,target:keys}));s.menu(true);s.dispatch(event('g',{ctrlKey:false,altKey:false,shiftKey:false}));s.menu(false);s.hidden(true);s.dispatch(event('g',{ctrlKey:false,altKey:false,shiftKey:false}));s.hidden(false);s.dispatch(event('g',{ctrlKey:false,altKey:false,shiftKey:false,cancelable:false}));await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.length,0);
  s.dispatch(event('g',{ctrlKey:false,altKey:false,shiftKey:false}));await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls[0].preset_id,'plain');s.shortcuts.dispose();
});

test('explicit activation preserves native IDs and SHA and consumes one guarded edit',async()=>{
  const s=setup();assert.equal(s.shortcuts.state(item()).enabled,false);s.shortcuts.activate(item());
  const pressed=event();s.dispatch(pressed);s.dispatch(event());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pressed.prevented,true);assert.equal(pressed.stopped,true);
  assert.deepEqual(s.calls,[{kind:'apply_saved_preset',clip_ids:['9007199254740993'],preset_id:'preset-a',revision:'sha-a'}]);
  s.shortcuts.deactivate('preset-a');s.dispatch(event());await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.length,1);
});

test('shortcuts stay out of editable controls, dialogs, composition and read-only sessions',async()=>{
  const s=setup();s.shortcuts.activate(item());
  s.dispatch(event('g',{target:{closest:()=>true}}));s.dispatch(event('g',{target:{isContentEditable:true}}));s.dispatch(event('g',{defaultPrevented:true}));s.dispatch(event('g',{repeat:true}));
  s.modal(true);s.dispatch(event());s.modal(false);s.writable(false);s.dispatch(event());s.writable(true);
  s.context({epoch:'e1',clip_ids:[]});s.dispatch(event());await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.length,0);
});

test('duplicate chords are rejected and epochs and revised metadata revoke activation',()=>{
  const s=setup();s.shortcuts.activate(item());assert.throws(()=>s.shortcuts.activate(item('preset-b')),/already enabled/);
  assert.equal(s.shortcuts.state(item('preset-a','Ctrl+Alt+Shift+G','sha-b')).enabled,false);
  s.shortcuts.activate(item('preset-b'));s.context({epoch:'e2',clip_ids:['1']});s.shortcuts.sync();assert.equal(s.shortcuts.state(item('preset-b')).enabled,false);
  assert.throws(()=>s.shortcuts.activate({...item(),archived:true}),/valid active/);
  s.shortcuts.dispose();assert.throws(()=>s.shortcuts.activate(item()),/closed/);
});

test('a rejected guarded edit revokes activation without replaying an older preset',async()=>{
  let attempts=0;
  const s=setup(async()=>{attempts++;throw Error('Preset revision changed');});s.shortcuts.activate(item());s.dispatch(event());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,1);assert.equal(s.shortcuts.state(item()).enabled,false);assert.match(s.messages[0],/shortcut disabled/);
  s.dispatch(event());await new Promise(resolve=>setImmediate(resolve));assert.equal(attempts,1);
});
