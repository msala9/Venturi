import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maskFocusAfterEdit,maskPathKeyDestination,maskPathKeyOperation,renderMasks} from '../js/masks.js';

function fixture(onKey=false){
  const path={points:[[0,0],[100,0],[0,100]].map(point=>({point,in_handle:[0,0],out_handle:[0,0]}))};
  const mask={index:0,shape:'Path',enabled:true,invert:false,mode:'Add',parameters:[],path:structuredClone(path),evaluated_path:structuredClone(path),path_keyframes:100,path_keys:[],path_navigation:{on_keyframe:onKey,previous:{source_frame:185,timeline_frame:42},next:{source_frame:205,timeline_frame:47}}};
  return {project_epoch:'epoch',generation:'7',timeline_id:'12',revision:'9',clip_id:'9007199254740993',timeline_frame:45,source_frame:197,masks:{shapes:['Path'],modes:['Add','Subtract'],items:[mask]}};
}
const emit=(target,type,properties={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});let stopped=false;event.stopPropagation=()=>{stopped=true;};target.dispatchEvent(event);return {event,stopped};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('mask focus follows native add, move and remove indices without selecting a different mask',()=>{
  assert.equal(maskFocusAfterEdit(null,{action:'add',shape:'Path'},3),3);
  assert.equal(maskFocusAfterEdit(0,{action:'add',shape:'Rectangle'},3),3);
  assert.deepEqual([0,1,2,3].map(index=>maskFocusAfterEdit(index,{action:'move',index:0,to_index:2},4)),[2,0,1,3]);
  assert.deepEqual([0,1,2,3].map(index=>maskFocusAfterEdit(index,{action:'move',index:3,to_index:1},4)),[0,2,3,1]);
  assert.deepEqual([0,1,2,3].map(index=>maskFocusAfterEdit(index,{action:'remove',index:1},4)),[0,null,1,2]);
  assert.equal(maskFocusAfterEdit(null,{action:'move',index:1,to_index:0},3),null);
});

test('Inspector mask edits retain valid focus except reset-all, and invalid structural bounds clear it',()=>{
  for(const kind of ['set','set_path','toggle_key','toggle_path_key','reset_parameter','reset_path','reset_mode','reset_mask'])assert.equal(maskFocusAfterEdit(1,{action:'inspector',timeline_frame:45,edit:{kind,index:0}},3),1,kind);
  assert.equal(maskFocusAfterEdit(1,{action:'set',index:0,patch:{mode:'Subtract'}},3),1);
  assert.equal(maskFocusAfterEdit(1,{action:'inspector',timeline_frame:45,edit:{kind:'reset_all'}},3),null);
  for(const index of [-1,3,1.5,null])assert.equal(maskFocusAfterEdit(index,{action:'set',index:0,patch:{enabled:false}},3),null);
  for(const edit of [{action:'move',index:0,to_index:3},{action:'move',index:-1,to_index:0},{action:'remove',index:3}])assert.equal(maskFocusAfterEdit(1,edit,3),null);
  assert.equal(maskFocusAfterEdit(1,{action:'add',shape:'Path'},8),null);assert.equal(maskFocusAfterEdit(1,{action:'set'},9),null);
});

function harness(t,{detail=fixture(),disabled=false,seekEnabled=true,openState=new Map([['masks',true]]),commit,drawPath}={}){
  const priorDocument=globalThis.document,priorOption=globalThis.Option,commands=[],frames=[],notices=[];
  let frame=detail.timeline_frame,allowed=true,dialog=false;
  const document={activeElement:null,querySelector:()=>dialog?{}:null};
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.dataset={};this.children=[];this.attributes=new Map();this.disabled=false;this.textContent='';this.value='';this.open=false;}
    append(...children){for(const child of children){if(typeof child==='string')continue;child.parent=this;this.children.push(child);}}
    replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}
    get isConnected(){return this===document.body || Boolean(this.parent?.isConnected);}
    reportValidity(){return true;}focus(){document.activeElement=this;}
  }
  document.createElement=tag=>new Element(tag);document.body=new Element('body');document.activeElement=document.body;
  globalThis.document=document;globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  t.after(()=>{globalThis.document=priorDocument;globalThis.Option=priorOption;});
  const root=new Element('div');document.body.append(root);
  const options={disabled,getFrame:()=>frame,canInteract:()=>allowed,seek:seekEnabled?value=>{frames.push(value);frame=value;}:undefined,drawPath,commit:async operation=>{commands.push(operation);return commit?.(operation);},notice:value=>notices.push(value),openState};
  const control=renderMasks(root,detail,options);
  const all=(node=root)=>[node,...node.children.flatMap(child=>all(child))];
  const button=action=>all().find(element=>element.dataset.pathKeyAction===action);
  const named=label=>all().find(element=>element.getAttribute('aria-label')===label);
  return {detail,root,document,commands,frames,notices,openState,options,control,all,button,named,setFrame:value=>frame=value,setAllowed:value=>allowed=value,setDialog:value=>dialog=value,click:action=>emit(button(action),'click'),clickNamed:label=>emit(named(label),'click')};
}

test('path navigation uses native full-track timeline destinations and strict source neighbours',()=>{
  const detail=fixture(),mask=detail.masks.items[0];
  assert.equal(maskPathKeyDestination(detail,mask,45,'previous'),42);assert.equal(maskPathKeyDestination(detail,mask,45,'next'),47);
  mask.path_navigation.previous=null;assert.equal(maskPathKeyDestination(detail,mask,45,'previous'),null);
  for(const direction of ['previous','next']){
    mask.path_navigation[direction]={source_frame:197,timeline_frame:45};assert.throws(()=>maskPathKeyDestination(detail,mask,45,direction),/valid native/);
  }
  assert.throws(()=>maskPathKeyDestination(detail,mask,46,'next'),/current playhead/);
});

test('path diamond clones the evaluated path and removes only a native exact current key',()=>{
  const detail=fixture(),mask=detail.masks.items[0];mask.path.points[0].point=[999,999];
  const operation=maskPathKeyOperation(detail,mask,45);
  assert.deepEqual(operation,{kind:'edit_mask',clip_id:detail.clip_id,edit:{action:'path_key',index:0,timeline_frame:45,path:mask.evaluated_path}});
  operation.edit.path.points[0].point[0]=50;assert.equal(mask.evaluated_path.points[0].point[0],0);
  mask.path_navigation.on_keyframe=true;assert.equal(maskPathKeyOperation(detail,mask,45).edit.path,null);
  assert.throws(()=>maskPathKeyOperation(detail,mask,44),/current playhead/);
  delete mask.path_navigation;assert.throws(()=>maskPathKeyOperation(detail,mask,45),/native path-key navigation/);
});

test('path arrows navigate beyond summarized keys without mutation and suppress global viewer shortcuts',t=>{
  const h=harness(t);assert.equal(h.detail.masks.items[0].path_keys.length,0);assert.equal(h.button('next').disabled,false);
  for(const key of [' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])assert.equal(emit(h.button('next'),'keydown',{key}).stopped,true,key);
  h.click('next');assert.deepEqual(h.frames,[47]);assert.deepEqual(h.commands,[]);
  h.click('previous');assert.deepEqual(h.frames,[47]);assert.match(h.notices[0],/current playhead/);assert.equal(h.button('previous').disabled,true);
});

test('path diamond sends one native Inspector toggle and then awaits refreshed detail',async t=>{
  let release;const h=harness(t,{commit:()=>new Promise(resolve=>{release=resolve;})});
  h.click('toggle');h.click('toggle');await settle();assert.deepEqual(h.commands,[{kind:'edit_mask',clip_id:h.detail.clip_id,edit:{action:'inspector',timeline_frame:45,edit:{kind:'toggle_path_key',index:0}}}]);
  assert.ok(['previous','toggle','next'].every(action=>h.button(action).disabled));release();await settle();assert.equal(h.button('toggle').disabled,true);
});

test('path controls reject read-only, modal, stale and live permission changes',async t=>{
  for(const mode of ['readonly','dialog','stale','permission']){
    await t.test(mode,async child=>{
      const h=harness(child,{disabled:mode==='readonly'});
      if(mode==='dialog')h.setDialog(true);if(mode==='stale')h.setFrame(46);if(mode==='permission')h.setAllowed(false);
      h.click('next');h.click('toggle');await settle();assert.deepEqual(h.commands,[],mode);assert.deepEqual(h.frames,[],mode);
    });
  }
});

test('unavailable native neighbours and absent seek glue stay disabled while default path editing remains',t=>{
  const detail=fixture();detail.masks.items[0].path_navigation.previous=null;
  const h=harness(t,{detail,seekEnabled:false});assert.equal(h.button('previous').disabled,true);assert.equal(h.button('next').disabled,true);assert.equal(h.button('toggle').disabled,false);
  assert.ok(h.all().some(element=>element.textContent==='Apply path'));assert.ok(h.all().some(element=>element.textContent==='Append vertex'));
});

test('native exact-key diamond removes rather than rewriting evaluated path and a rejected request permits retry',async t=>{
  let count=0;const h=harness(t,{detail:fixture(true),commit:()=>{if(++count===1)throw Error('Native revision changed');}});
  assert.equal(h.button('toggle').getAttribute('aria-pressed'),'true');h.click('toggle');await settle();assert.deepEqual(h.commands[0].edit,{action:'inspector',timeline_frame:45,edit:{kind:'toggle_path_key',index:0}});assert.equal(h.button('toggle').disabled,false);assert.deepEqual(h.notices,['Native revision changed']);
  h.click('toggle');await settle();assert.equal(h.commands.length,2);assert.deepEqual(h.commands[1],h.commands[0]);
});

test('path navigation restores its focused native control after a refreshed inspector without stealing dialog focus',async t=>{
  const h=harness(t);h.button('next').focus();h.click('next');assert.equal(h.openState.get(`mask-path-key-focus:${h.detail.clip_id}:0`),'next');
  h.document.activeElement=h.document.body;const fresh=structuredClone(h.detail);fresh.timeline_frame=47;fresh.source_frame=205;fresh.masks.items[0].path_navigation={on_keyframe:true,previous:{source_frame:197,timeline_frame:45},next:{source_frame:220,timeline_frame:51}};
  h.root.replaceChildren();renderMasks(h.root,fresh,h.options);await settle();assert.equal(h.document.activeElement.dataset.pathKeyAction,'next');
  h.openState.set(`mask-path-key-focus:${h.detail.clip_id}:0`,'previous');h.document.activeElement=h.document.body;h.setDialog(true);h.root.replaceChildren();renderMasks(h.root,fresh,h.options);await settle();assert.equal(h.document.activeElement,h.document.body);
});

function scalarFixture(){
  const detail=fixture();detail.masks.items[0].parameters=[{param:'Opacity',value:75,default:100,min:0,max:100,keyframes:[],key_count:100,keyframe_info:{on_keyframe:true,previous_frame:4,next_frame:89}}];return detail;
}
const inspectorOperation=(detail,edit)=>({kind:'edit_mask',clip_id:detail.clip_id,edit:{action:'inspector',timeline_frame:detail.timeline_frame,edit}});

test('scalar change and Enter share one native auto-key write at the captured raw timeline playhead',async t=>{
  const detail=scalarFixture();detail.timeline_frame=500;const h=harness(t,{detail}),input=h.named('Mask 1 Opacity'),form=input.parent.parent;
  for(const value of ['','NaN','101','75']){input.value=value;emit(input,'change');emit(form,'submit');}
  await settle();assert.deepEqual(h.commands,[]);
  input.value='42';emit(input,'change');emit(form,'submit');await settle();
  assert.deepEqual(h.commands,[inspectorOperation(detail,{kind:'set',index:0,param:'Opacity',value:42})]);
  assert.equal(input.disabled,true);assert.equal(detail.source_frame,197);
});

test('scalar diamonds and neighbours use full native metadata independently of the summarized keys',async t=>{
  const h=harness(t,{detail:scalarFixture()}),diamond=h.named('Mask 1 Toggle Opacity keyframe at playhead');
  assert.equal(diamond.getAttribute('aria-pressed'),'true');assert.equal(h.detail.masks.items[0].parameters[0].keyframes.length,0);
  h.clickNamed('Mask 1 Next Opacity keyframe');assert.deepEqual(h.frames,[89]);assert.deepEqual(h.commands,[]);
  h.setFrame(45);h.clickNamed('Mask 1 Previous Opacity keyframe');assert.deepEqual(h.frames,[89,4]);
  h.setFrame(45);h.clickNamed('Mask 1 Toggle Opacity keyframe at playhead');await settle();
  assert.deepEqual(h.commands,[inspectorOperation(h.detail,{kind:'toggle_key',index:0,param:'Opacity'})]);
});

test('absent scalar full-track metadata leaves navigation and diamond disabled without inventing neighbours',t=>{
  const detail=scalarFixture();delete detail.masks.items[0].parameters[0].keyframe_info;
  const h=harness(t,{detail});for(const label of ['Previous Opacity keyframe','Next Opacity keyframe','Toggle Opacity keyframe at playhead'])assert.equal(h.named(`Mask 1 ${label}`).disabled,true);
  assert.equal(h.named('Mask 1 Opacity').disabled,false);
});

test('compact reset actions preserve exact native Inspector kinds and never send browser defaults',async t=>{
  for(const [label,edit] of [
    ['Reset mask 1 Opacity',{kind:'reset_parameter',index:0,param:'Opacity'}],
    ['Reset mask 1 path',{kind:'reset_path',index:0}],
    ['Reset mask 1 combination',{kind:'reset_mode',index:0}],
    ['Reset mask 1',{kind:'reset_mask',index:0}],
    ['Reset all masks',{kind:'reset_all'}],
  ])await t.test(label,async child=>{const h=harness(child,{detail:scalarFixture()});h.clickNamed(label);await settle();assert.deepEqual(h.commands,[inspectorOperation(h.detail,edit)]);});
});

test('path drafts start from evaluated geometry, cancel locally and apply once through native auto-key',async t=>{
  const detail=fixture();detail.masks.items[0].path.points[0].point=[999,999];detail.masks.items[0].evaluated_path.points[0].point=[20,30];
  const h=harness(t,{detail});let input=h.named('Mask 1 vertex 1 point X'),form=input.parent.parent.parent.parent;
  assert.equal(input.value,20);input.value='25';emit(form,'keydown',{key:'Escape'});assert.equal(h.named('Mask 1 vertex 1 point X').value,20);assert.deepEqual(h.commands,[]);
  input=h.named('Mask 1 vertex 1 point X');form=input.parent.parent.parent.parent;input.value='25';emit(form,'submit');emit(form,'submit');await settle();
  const path=structuredClone(detail.masks.items[0].evaluated_path);path.points[0].point[0]=25;
  assert.deepEqual(h.commands,[inspectorOperation(detail,{kind:'set_path',index:0,path})]);assert.deepEqual(path.points[0].point,[25,30]);
});

test('queued mask writes refuse changed frame, native identity, modal, permission, detached and disposed owners',async t=>{
  for(const mode of ['frame','epoch','generation','revision','source','modal','permission','detached','disposed'])await t.test(mode,async child=>{
    const h=harness(child,{detail:scalarFixture()});h.clickNamed('Reset mask 1 Opacity');
    if(mode==='frame')h.setFrame(46);if(mode==='epoch')h.detail.project_epoch='other';if(mode==='generation')h.detail.generation='8';if(mode==='revision')h.detail.revision='10';if(mode==='source')h.detail.source_frame=198;
    if(mode==='modal')h.setDialog(true);if(mode==='permission')h.setAllowed(false);if(mode==='detached')h.root.replaceChildren();if(mode==='disposed')h.control.cancel();
    await settle();assert.deepEqual(h.commands,[]);if(mode!=='detached')assert.equal(h.named('Reset mask 1 Opacity').disabled,true);
  });
});

test('unknown mask outcomes remain blocked with their useful message and late disposal never re-enables controls',async t=>{
  const error=Object.assign(Error('The native mask command outcome is unknown'),{code:'OUTCOME_UNKNOWN'}),h=harness(t,{commit:()=>{throw error;}});
  h.click('toggle');await settle();h.click('toggle');h.clickNamed('Reset all masks');await settle();
  assert.equal(h.commands.length,1);assert.deepEqual(h.notices,[error.message]);assert.equal(h.button('toggle').disabled,true);
  h.control.cancel();assert.equal(h.button('toggle').disabled,true);
});

test('a late mask failure after disposal cannot notify, replay or re-enable the detached owner',async t=>{
  let reject;const h=harness(t,{commit:()=>new Promise((resolve,failure)=>{reject=failure;})}),button=h.button('toggle');
  h.click('toggle');await settle();assert.equal(h.commands.length,1);h.control.cancel();h.root.replaceChildren();
  reject(Error('Late native failure'));await settle();emit(button,'click');await settle();
  assert.equal(h.commands.length,1);assert.deepEqual(h.notices,[]);assert.equal(button.disabled,true);assert.equal(button.isConnected,false);
});

test('legacy mask toggles keep their wire shape and viewer routing cannot escape a stale owner',async t=>{
  const h=harness(t),viewer=h.named('Edit mask 1 in viewer');assert.equal(viewer.dataset.viewerMaskIndex,'0');assert.equal(viewer.dataset.clipId,h.detail.clip_id);
  h.setAllowed(false);assert.equal(emit(viewer,'click').stopped,true);assert.deepEqual(h.commands,[]);h.setAllowed(true);
  const enabled=h.named('Mask 1 enabled');enabled.checked=false;emit(enabled,'change');await settle();
  assert.deepEqual(h.commands,[{kind:'edit_mask',clip_id:h.detail.clip_id,edit:{action:'set',index:0,patch:{enabled:false}}}]);
});

test('Add Path starts the existing viewer pen without inserting a default shape while Rectangle still commits',async t=>{
  let drawings=0;const detail=fixture();detail.masks.shapes.push('Rectangle');const h=harness(t,{detail,drawPath:()=>drawings++});
  h.clickNamed('Add mask');await settle();assert.equal(drawings,1);assert.deepEqual(h.commands,[]);
  const shape=h.named('New mask shape');shape.value='Rectangle';emit(shape,'change');h.clickNamed('Add mask');await settle();
  assert.equal(drawings,1);assert.deepEqual(h.commands,[{kind:'edit_mask',clip_id:detail.clip_id,edit:{action:'add',shape:'Rectangle'}}]);
});

test('Path drawing stays unavailable without a pen callback and rejects stale, modal and unknown owners',async t=>{
  for(const mode of ['absent','stale','modal','permission','disposed','unknown'])await t.test(mode,async child=>{
    let drawings=0;const h=harness(child,{drawPath:mode==='absent'?undefined:()=>drawings++,commit:()=>{throw Object.assign(Error('Mask outcome unknown'),{code:'OUTCOME_UNKNOWN'});}});
    if(mode==='stale')h.setFrame(46);if(mode==='modal')h.setDialog(true);if(mode==='permission')h.setAllowed(false);if(mode==='disposed')h.control.cancel();
    if(mode==='unknown'){h.click('toggle');await settle();}
    h.clickNamed('Add mask');await settle();assert.equal(drawings,0);assert.equal(h.commands.length,mode==='unknown'?1:0);
    if(mode==='absent')assert.equal(h.named('Add mask').disabled,true);if(mode==='unknown')assert.deepEqual(h.notices,['Mask outcome unknown']);
  });
});
