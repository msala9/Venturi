import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presetShortcutBinding,presetShortcutMatches,createPresetShortcuts} from '../js/preset-shortcuts.js';

const item=(id='preset-a',shortcut='Ctrl+Alt+Shift+G',revision='sha-a')=>({id,shortcut,revision,name:id});
const event=(key='g',extra={})=>({key,ctrlKey:true,altKey:true,shiftKey:true,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
function setup(commit){
  let handler,context={epoch:'e1',clip_ids:['9007199254740993']},writable=true,modal=false;
  const calls=[],messages=[],document={addEventListener(type,listener,capture){assert.equal(type,'keydown');assert.equal(capture,true);handler=listener;},removeEventListener(){handler=null;},querySelector(){return modal;}};
  const shortcuts=createPresetShortcuts({getContext:()=>context,canCommit:()=>writable,commit:commit || (async operation=>calls.push(operation)),notice:text=>messages.push(text),document});
  return {shortcuts,calls,messages,dispatch:e=>handler?.(e),context:value=>context=value,writable:value=>writable=value,modal:value=>modal=value};
}

test('native shortcut strings have an explicit safe web activation subset',()=>{
  assert.deepEqual(presetShortcutBinding('Shift+Ctrl+Alt+G'),{key:'G',label:'Ctrl+Alt+Shift+G'});
  for(const shortcut of [null,{},'Ctrl++','Ctrl+G','G','Ctrl+Alt+Shift+F1','Ctrl+Ctrl+Alt+Shift+G','Ctrl+Alt+Shift+g','Meta+Alt+Shift+G'])assert.ok(presetShortcutBinding(shortcut).reason);
  for(const key of ['C','K','Q','S','V','Z'])assert.ok(presetShortcutBinding(`Ctrl+Alt+Shift+${key}`).reason);
  const binding=presetShortcutBinding('Ctrl+Alt+Shift+G');
  assert.equal(presetShortcutMatches(event(),binding),true);
  assert.equal(presetShortcutMatches(event('G',{ctrlKey:false,metaKey:true}),binding),true);
  for(const extra of [{repeat:true},{isComposing:true},{keyCode:229},{altKey:false},{shiftKey:false},{metaKey:true},{ctrlKey:false},{getModifierState:()=>true}])assert.equal(presetShortcutMatches(event('g',extra),binding),false);
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
