import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presetMutationResult,createPresetPanel} from '../js/presets.js';

test('an acknowledged preset save remains successful when the follow-up read fails',async()=>{
  const receipt={command_id:'saved-preset',receipt_persisted:true};
  const failure=Error('Connection lost while reading the new preset');
  let submissions=0;
  const result=await presetMutationResult(async()=>{submissions++;return receipt;},async acknowledged=>{
    assert.equal(acknowledged,receipt);
    throw failure;
  });
  assert.equal(submissions,1);
  assert.equal(result.receipt,receipt);
  assert.equal(result.refreshError,failure);
});

test('a rejected preset mutation does not read or report a saved result',async()=>{
  const rejected=Error('Preset revision changed');
  let reads=0;
  await assert.rejects(()=>presetMutationResult(async()=>{throw rejected;},async()=>{reads++;}),error=>error===rejected);
  assert.equal(reads,0);
});

test('a successful preset refresh returns the original durable receipt',async()=>{
  const receipt={command_id:'imported-preset'};
  let reads=0;
  const result=await presetMutationResult(async()=>receipt,async acknowledged=>{
    assert.equal(acknowledged,receipt);
    reads++;
  });
  assert.equal(reads,1);
  assert.deepEqual(result,{receipt,refreshError:null});
});

const nativeShortcuts={version:1,keys:['B','Plus','Slash','F35','Down','Space','ControlLeft'],modifiers:['Ctrl','Shift','Alt']};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function settle(){for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));}
function panelHarness(shortcut='Ctrl+Alt+Shift+B',options={}){
  const original={document:globalThis.document,Option:globalThis.Option},reads=[],catalogReads=[],writes=[],deactivated=[],notices=[],drags=[];let enabled=true,activated=0,writable=true,dragEnds=0,itemExists=true;
  class Element extends EventTarget{
    constructor(tag=''){super();this.tag=tag;this.children=[];this.attributes=new Map();this.value='';this.checked=false;this.disabled=false;this.open=false;this.textContent='';this.parent=null;}
    get isConnected(){return this===body || Boolean(this.parent?.isConnected);}
    append(...items){for(const item of items){this.children.push(item);if(item instanceof Element)item.parent=this;}}
    replaceChildren(...items){for(const item of this.children)if(item instanceof Element)item.parent=null;this.children=[];this.append(...items);}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}focus(){}reportValidity(){return true;}
    showModal(){this.open=true;}close(){if(!this.open)return;this.open=false;this.dispatchEvent(new Event('close'));}
  }
  const body=new Element('body'),root=new Element('root');body.append(root);globalThis.document={body,createElement:tag=>new Element(tag),querySelector:selector=>selector==='dialog[open]'?dialog():null};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  const context={epoch:'epoch',generation:'1',timeline:'timeline',revision:'revision',clip_ids:['clip'],roles:{video:true,audio:true},name:'Selected clips'};
  let item={id:'preset',revision:'r1',name:'Saved look',attributes:['zoom'],anchor:'start',append_filters:false,shortcut,video:true,audio:false,archived:false,...options.item};
  const deletionReceipt=edit=>({command_id:'deleted',status:'applied',project_epoch:context.epoch,library_durable:true,preset_library_durable:true,deleted_preset:{id:edit.id,revision:edit.revision,archived:edit.archived}});
  const mutate=async operation=>{writes.push(operation);if(operation.kind==='apply_saved_preset')return options.apply?options.apply(operation):{command_id:'applied'};if(operation.edit?.action==='delete'){const receipt=options.remove?await options.remove(operation):deletionReceipt(operation.edit);if(receipt?.status==='applied' && receipt.deleted_preset?.id===item.id)itemExists=false;return receipt;}const edits=operation.options || operation.edit.options,old=operation.kind==='save_attribute_preset'?null:item.shortcut;item={...item,...edits,id:operation.kind==='save_attribute_preset'?'created':item.id,revision:'r2',shortcut:edits.shortcut?.action==='set'?edits.shortcut.value:edits.shortcut?.action==='clear'?null:old};return {command_id:operation.kind==='save_attribute_preset'?'created':'updated'};};
  const presetDnd={type:'application/x-venturi-preset',start(snapshot,current){drags.push({snapshot,current});return options.start?options.start(snapshot,current):'opaque-native-drag';},end(){dragEnds++;}};
  const panel=createPresetPanel({root,getContext:()=>context,canCommit:()=>writable,commit:mutate,libraryCommit:mutate,presetDnd,notice:message=>notices.push(message),shortcuts:{state:()=>({enabled,label:'Ctrl+Alt+Shift+B'}),activate(){activated++;enabled=true;},deactivate(id){deactivated.push(id);enabled=false;},sync(){}},api:async(path,body,requestOptions)=>{reads.push({path,body,options:requestOptions});if(path==='/presets/shortcuts'){const pending=deferred();catalogReads.push({...pending,options:requestOptions});return pending.promise;}if(path.startsWith('/presets/pages/')){const result={page:0,pages:1,total:itemExists?1:0,items:itemExists?[structuredClone(item)]:[]};return options.pageReader?options.pageReader(result):result;}if(path.startsWith('/presets/items/')){if(!itemExists)throw Error('Deleted preset must not be fetched');return structuredClone(item);}throw Error(`Unexpected route ${path}`);}});
  const walk=node=>[node,...(node.children || []).filter(child=>child instanceof Element).flatMap(walk)];
  const dialog=()=>walk(body).find(node=>node.tag==='dialog' && node.open);
  const button=(text,parent=root)=>{const found=walk(parent).find(node=>node.tag==='button' && node.textContent===text);assert(found,`Expected button ${text}`);return found;};
  const field=(attribute,parent=dialog())=>{const found=walk(parent).find(node=>node.attributes?.has(attribute));assert(found,`Expected ${attribute}`);return found;};
  return {panel,root,context,reads,catalogReads,writes,deactivated,notices,drags,dragEnds:()=>dragEnds,setWritable:value=>{writable=value;},item:()=>item,enabled:()=>enabled,activated:()=>activated,button,dialog,field,deletionReceipt,
    list:()=>walk(root).find(node=>node.getAttribute('aria-label')==='Saved presets'),
    activate(type='keydown',patch={},node=walk(root).find(node=>node.getAttribute('aria-label')==='Saved presets')){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({key:'Enter',...patch}))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;},
    deleteKey(patch={}){const section=root.children.find(node=>node.tag==='section'),event=new Event('keydown',{cancelable:true});for(const [key,value] of Object.entries({key:'Delete',target:walk(root).find(node=>node.getAttribute('aria-label')==='Saved presets'),...patch}))Object.defineProperty(event,key,{value});section.dispatchEvent(event);return event;},
    archived(value){const input=walk(root).find(node=>node.tag==='input' && node.type==='checkbox');input.checked=value;input.dispatchEvent(new Event('change'));},
    drag(transfer={effectAllowed:'none',entries:[],setData(type,value){this.entries.push([type,value]);}},node=field('data-preset-drag',root)){const event=new Event('dragstart',{cancelable:true});Object.defineProperty(event,'dataTransfer',{value:transfer});node.dispatchEvent(event);return {event,transfer,node};},
    async open(){root.replaceChildren();await panel.open();},edit(){button('Edit preset settings').click();return dialog();},capture(){button('Save selection as preset').click();return dialog();},
    changeMode(value){const select=field('data-preset-shortcut-mode');select.value=value;select.dispatchEvent(new Event('change'));},
    selectKey(value,modifiers=[]){const select=field('data-preset-shortcut-key');select.value=value;for(const node of walk(dialog()))if(node.getAttribute?.('data-preset-shortcut-modifier'))node.checked=modifiers.includes(node.value);select.dispatchEvent(new Event('change'));},
    submit(parent=dialog()){parent.children[0].dispatchEvent(new Event('submit',{cancelable:true}));},savedRevision(value){item.revision=value;},
    destroy(){panel.hide();for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

test('cold opening a nonempty preset library selects the first item without requiring a previous selection',async()=>{
  const h=panelHarness();try{await h.open();assert.equal(h.button('Edit preset settings').disabled,false);assert.equal(h.button('Apply preset to selected clips').disabled,false);assert(h.edit());assert.equal(h.catalogReads.length,1);assert.match(h.field('data-preset-current-shortcut').textContent,/Ctrl\+Alt\+Shift\+B/);assert.equal(h.writes.length,0);}finally{h.destroy();}
});

test('editing imported unknown shortcut metadata defaults to Keep and sends unchanged legacy update options',async()=>{
  const imported={future_desktop_key:'unknown',flags:[1,2]},h=panelHarness(imported);
  try{await h.open();h.edit();assert.equal(h.field('data-preset-shortcut-mode').value,'keep');assert.match(h.field('data-preset-current-shortcut').textContent,/Imported native metadata.*preserved by Keep/);h.catalogReads[0].reject(Error('Catalog offline'));await settle();h.submit();await settle();assert.deepEqual(h.writes[0],{kind:'edit_preset_library',edit:{action:'update',id:'preset',revision:'r1',options:{name:'Saved look',attributes:['zoom'],anchor:'start',append_filters:false}}});assert.deepEqual(h.item().shortcut,imported);assert.deepEqual(h.deactivated,['preset']);assert.equal(h.activated(),0);}finally{h.destroy();}
});

test('Assign uses the entire server key catalog and saved edits deactivate browser bindings without enabling the new shortcut',async()=>{
  const h=panelHarness();try{await h.open();h.edit();h.changeMode('set');assert.equal(h.button('Save preset changes',h.dialog()).disabled,true);h.catalogReads[0].resolve(nativeShortcuts);await settle();const keys=h.field('data-preset-shortcut-key');assert.deepEqual(keys.children.slice(1).map(option=>option.value),nativeShortcuts.keys);h.selectKey('Plus',['Alt','Ctrl','Shift']);assert.equal(h.button('Save preset changes',h.dialog()).disabled,false);h.submit();await settle();assert.deepEqual(h.writes[0].edit.options.shortcut,{action:'set',value:'Ctrl+Shift+Alt+Plus'});assert.equal(h.item().shortcut,'Ctrl+Shift+Alt+Plus');assert.deepEqual(h.deactivated,['preset']);assert.equal(h.enabled(),false);assert.equal(h.activated(),0);}finally{h.destroy();}
});

test('new preset capture omits Keep so native capture retains its null shortcut default',async()=>{
  const h=panelHarness();try{await h.open();h.capture();h.submit();await settle();assert.equal(h.writes.length,1);assert.equal(h.writes[0].kind,'save_attribute_preset');assert.deepEqual(h.writes[0].clip_ids,['clip']);assert.equal(Object.hasOwn(h.writes[0].options,'shortcut'),false);assert.equal(h.item().shortcut,null);assert.equal(h.activated(),0);}finally{h.destroy();}
});

test('failed shortcut catalogs block Assign while Keep and explicit Remove stay available without implicit clearing',async()=>{
  const h=panelHarness('Imported+Unknown+Key');try{await h.open();h.edit();h.catalogReads[0].reject(Error('Native key catalog disconnected'));await settle();assert.match(h.field('data-preset-shortcut-status').textContent,/Keep and Remove remain available/);h.changeMode('set');h.selectKey('B',['Ctrl']);assert.equal(h.button('Save preset changes',h.dialog()).disabled,true);h.submit();await settle();assert.equal(h.writes.length,0);assert.equal(h.item().shortcut,'Imported+Unknown+Key');h.changeMode('keep');assert.equal(h.button('Save preset changes',h.dialog()).disabled,false);h.changeMode('clear');assert.equal(h.button('Save preset changes',h.dialog()).disabled,false);h.submit();await settle();assert.deepEqual(h.writes[0].edit.options.shortcut,{action:'clear'});assert.equal(h.item().shortcut,null);}finally{h.destroy();}
});

test('catalog replies after dialog close or panel hide cannot modify a newer shortcut draft or submit the closed form',async()=>{
  for(const hide of [false,true]){
    const h=panelHarness();try{await h.open();const old=h.edit(),oldKey=h.field('data-preset-shortcut-key'),pending=h.catalogReads[0];if(hide){h.panel.hide();await h.open();}else h.button('Cancel preset settings',old).click();h.edit();h.catalogReads[1].resolve(nativeShortcuts);await settle();h.changeMode('set');h.selectKey('F35',['Ctrl']);pending.resolve({...nativeShortcuts,keys:['ObsoleteKey']});await settle();assert.equal(oldKey.children.length,1);assert.equal(h.field('data-preset-shortcut-key').value,'F35');assert.equal(h.field('data-preset-shortcut-mode').value,'set');h.submit(old);await settle();assert.equal(h.writes.length,0);assert.equal(pending.options.signal.aborted,true);}finally{h.destroy();}
  }
});

test('Save and Edit reject stale session or selection settings even without an explicit invalidate callback',async()=>{
  for(const edit of [false,true]){
    const h=panelHarness();try{await h.open();const dialog=edit?h.edit():h.capture();h.catalogReads[0].resolve(nativeShortcuts);await settle();h.changeMode('set');h.selectKey('B',['Ctrl','Alt','Shift']);h.context.clip_ids.push('new-selection');h.submit(dialog);await settle();assert.equal(h.writes.length,0);assert.equal(h.button(edit?'Save preset changes':'Save selection as new preset',dialog).disabled,true);assert.equal(h.field('data-preset-shortcut-key').value,'B');}finally{h.destroy();}
  }
});

test('a refreshed saved preset revision prevents an old shortcut settings form from updating that preset',async()=>{
  const h=panelHarness();try{await h.open();h.edit();h.catalogReads[0].resolve(nativeShortcuts);await settle();h.changeMode('clear');h.savedRevision('changed-elsewhere');h.button('Refresh presets').click();await settle();h.submit();await settle();assert.equal(h.writes.length,0);assert.equal(h.button('Save preset changes',h.dialog()).disabled,true);}finally{h.destroy();}
});

test('preset drag needs no clip selection and transfers only the Canvas MIME without reading preset DTOs',async()=>{
  const h=panelHarness();try{
    h.context.clip_ids=[];await h.open();const reads=h.reads.length;
    assert.equal(h.button('Apply preset to selected clips').disabled,true);
    const {event,transfer,node}=h.drag();assert.equal(event.defaultPrevented,false);assert.equal(node.draggable,true);assert.equal(transfer.effectAllowed,'copy');
    assert.deepEqual(transfer.entries,[['application/x-venturi-preset','opaque-native-drag']]);
    assert.deepEqual(h.drags[0].snapshot,{id:'preset',revision:'r1',name:'Saved look',video:true,audio:false});
    assert.equal(h.drags[0].current({...h.drags[0].snapshot}),true);assert.equal(h.reads.length,reads);assert.equal(h.writes.length,0);
    node.dispatchEvent(new Event('dragend'));assert.equal(h.dragEnds(),1);assert.equal(h.drags[0].current(h.drags[0].snapshot),false);assert.equal(h.dragEnds(),1);
  }finally{h.destroy();}
});

test('preset drag ownership refuses changed document, timeline, revision or selection before drop',async()=>{
  for(const change of [h=>h.context.epoch='new',h=>h.context.generation='2',h=>h.context.timeline='other',h=>h.context.revision='r2',h=>h.context.clip_ids.push('other')]){
    const h=panelHarness();try{await h.open();h.drag();const binding=h.drags[0];change(h);assert.equal(binding.current(binding.snapshot),false);assert.equal(h.dragEnds(),1);assert.equal(h.writes.length,0);h.panel.invalidate();assert.equal(h.dragEnds(),1);}finally{h.destroy();}
  }
});

test('preset drag refuses altered source metadata and stale preset revision callbacks',async()=>{
  for(const patch of [{id:'other'},{revision:'r2'},{name:'renamed'},{video:false},{audio:true}]){
    const h=panelHarness();try{await h.open();h.drag();const binding=h.drags[0];assert.equal(binding.current({...binding.snapshot,...patch}),false);assert.equal(h.dragEnds(),1);assert.equal(h.writes.length,0);}finally{h.destroy();}
  }
  const h=panelHarness();try{await h.open();h.drag();const old=h.drags[0];h.savedRevision('r2');h.button('Refresh presets').click();await settle();assert.equal(old.current(old.snapshot),false);h.drag();assert.equal(h.drags[1].snapshot.revision,'r2');assert.equal(old.current(old.snapshot),false);assert.equal(h.drags[1].current(h.drags[1].snapshot),true);}finally{h.destroy();}
});

test('preset drag ends on reload, settings, selection changes, library writes and panel hide',async()=>{
  for(const action of [h=>h.button('Refresh presets').click(),h=>h.edit(),h=>{const list=h.root.children[0].children.find(node=>node.tag==='select');list.onchange();},h=>h.button('Archive preset').click(),h=>h.panel.hide()]){
    const h=panelHarness();try{await h.open();h.drag();const old=h.drags[0];action(h);assert.equal(h.dragEnds(),1);assert.equal(old.current(old.snapshot),false);await settle();assert.equal(h.dragEnds(),1);}finally{h.destroy();}
  }
});

test('archived, invalid, read-only and missing native timeline sources cannot begin preset drag',async()=>{
  for(const item of [{archived:true},{error:'Invalid preset'},{revision:null},{id:''},{video:undefined},{audio:'false'},{video:false,audio:false}]){
    const h=panelHarness(undefined,{item});try{await h.open();const {event,node}=h.drag();assert.equal(node.disabled,true);assert.equal(node.draggable,false);assert.equal(event.defaultPrevented,true);assert.equal(h.drags.length,0);}finally{h.destroy();}
  }
  for(const disable of [h=>h.setWritable(false),h=>h.context.timeline=undefined,h=>h.context.timeline='fixture',h=>h.context.revision=undefined]){
    const h=panelHarness();try{await h.open();disable(h);h.panel.invalidate();assert.equal(h.drag().event.defaultPrevented,true);assert.equal(h.drags.length,0);assert.equal(h.writes.length,0);}finally{h.destroy();}
  }
});

test('failed Canvas start or dataTransfer cancels preset drag without fallback data or commands',async()=>{
  for(const start of [()=>null,()=>({preset:'not serialized'}),()=>{throw Error('Source changed');}]){
    const h=panelHarness(undefined,{start});try{await h.open();const {event,transfer}=h.drag();assert.equal(event.defaultPrevented,true);assert.deepEqual(transfer.entries,[]);assert.equal(h.dragEnds(),1);assert.equal(h.writes.length,0);}finally{h.destroy();}
  }
  const h=panelHarness();try{await h.open();assert.equal(h.drag(null).event.defaultPrevented,true);assert.equal(h.drags.length,0);const transfer={setData(){throw Error('Transfer refused');}};assert.equal(h.drag(transfer).event.defaultPrevented,true);assert.equal(h.dragEnds(),1);assert.equal(h.drags[0].current(h.drags[0].snapshot),false);assert.equal(h.writes.length,0);}finally{h.destroy();}
});

test('open modal settings block a new preset drag and read-only invalidation ends an active drag',async()=>{
  const h=panelHarness();try{await h.open();h.edit();assert.equal(h.drag().event.defaultPrevented,true);assert.equal(h.drags.length,0);h.button('Cancel preset settings',h.dialog()).click();h.panel.invalidate();h.drag();assert.equal(h.drags.length,1);h.setWritable(false);h.panel.invalidate();assert.equal(h.dragEnds(),1);assert.equal(h.drags[0].current(h.drags[0].snapshot),false);assert.equal(h.writes.length,0);}finally{h.destroy();}
});

test('hidden or obsolete preset drag controls cannot take ownership after the panel reopens',async()=>{
  const h=panelHarness();try{await h.open();const old=h.drag();h.panel.hide();assert.equal(h.drags[0].current(h.drags[0].snapshot),false);assert.equal(h.drag(null,old.node).event.defaultPrevented,true);await h.open();const fresh=h.drag();assert.equal(h.drag(fresh.transfer,old.node).event.defaultPrevented,true);old.node.dispatchEvent(new Event('dragend'));assert.equal(h.drags.at(-1).current(h.drags.at(-1).snapshot),true);fresh.node.dispatchEvent(new Event('dragend'));assert.equal(h.dragEnds(),2);}finally{h.destroy();}
});

test('Apply retains the accessible button workflow and submits exactly one native selection command',async()=>{
  const h=panelHarness();try{await h.open();h.drag();h.button('Apply preset to selected clips').click();await settle();assert.deepEqual(h.writes,[{kind:'apply_saved_preset',clip_ids:['clip'],preset_id:'preset',revision:'r1'}]);assert.equal(h.dragEnds(),1);assert.equal(h.drags.length,1);assert.equal(h.button('Apply preset to selected clips').disabled,false);}finally{h.destroy();}
});

test('preset double-click and Enter share one guarded Apply command while duplicate events cannot submit twice',async()=>{
  for(const type of ['dblclick','keydown']){
    const gate=deferred(),h=panelHarness(undefined,{apply:()=>gate.promise});try{
      await h.open();const event=h.activate(type);assert.equal(event.defaultPrevented,true);h.activate('dblclick');h.activate('keydown');h.button('Apply preset to selected clips').click();
      assert.deepEqual(h.writes,[{kind:'apply_saved_preset',clip_ids:['clip'],preset_id:'preset',revision:'r1'}]);assert.equal(h.button('Apply preset to selected clips').disabled,true);
      h.context.clip_ids.push('later-selection');assert.deepEqual(h.writes[0].clip_ids,['clip']);gate.resolve({command_id:'applied'});await settle();assert.equal(h.writes.length,1);assert.equal(h.button('Apply preset to selected clips').disabled,false);
    }finally{h.destroy();}
  }
});

test('preset activation ignores text targets, modifiers, repeats, IME, modal and invalid or empty selection',async()=>{
  const h=panelHarness();try{
    await h.open();
    for(const patch of [{key:'Space'},{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{getModifierState:key=>key==='AltGraph'},{target:{tag:'input'}}]){assert.equal(h.activate('keydown',patch).defaultPrevented,false);}
    for(const patch of [{ctrlKey:true},{altKey:true},{shiftKey:true},{metaKey:true}])h.activate('dblclick',patch);
    h.setWritable(false);h.activate();h.button('Apply preset to selected clips').click();h.setWritable(true);
    h.context.clip_ids=[];h.activate();h.context.clip_ids=['clip','clip'];h.activate();h.context.clip_ids=['clip'];
    h.edit();h.activate();h.button('Apply preset to selected clips').click();assert.equal(h.writes.length,0);h.button('Cancel preset settings',h.dialog()).click();
    h.context.clip_ids=['new-current-selection'];h.activate();await settle();assert.deepEqual(h.writes[0].clip_ids,['new-current-selection']);
  }finally{h.destroy();}
  for(const item of [{archived:true},{error:'Invalid native preset'},{revision:null}]){const invalid=panelHarness(undefined,{item});try{await invalid.open();invalid.activate();invalid.activate('dblclick');assert.equal(invalid.writes.length,0);}finally{invalid.destroy();}}
});

test('preset activation refuses pending or failed reads, a changed project and obsolete detached list or Apply controls',async()=>{
  let reads=0;const gate=deferred(),h=panelHarness(undefined,{pageReader:result=>++reads===2?gate.promise:result});try{
    await h.open();const oldList=h.list(),oldApply=h.button('Apply preset to selected clips');h.button('Refresh presets').click();h.activate();assert.equal(h.button('Apply preset to selected clips').disabled,true);assert.equal(h.writes.length,0);
    h.context.epoch='other-project';gate.resolve({page:0,pages:1,total:1,items:[structuredClone(h.item())]});await settle();h.activate();assert.equal(h.writes.length,0);
    await h.open();h.activate('dblclick',{},oldList);oldApply.click();assert.equal(h.writes.length,0);h.panel.hide();h.activate();assert.equal(h.writes.length,0);
  }finally{h.destroy();}
  let fail=false;const broken=panelHarness(undefined,{pageReader:result=>{if(fail)throw Error('Preset NAS unavailable');return result;}});try{await broken.open();fail=true;broken.button('Refresh presets').click();await settle();broken.activate();broken.activate('dblclick');broken.button('Apply preset to selected clips').click();assert.equal(broken.writes.length,0);assert.equal(broken.button('Apply preset to selected clips').disabled,true);}finally{broken.destroy();}
});

test('a live preset palette refreshes once per project epoch, preserves the selected preset and latches failed reads until Refresh',async()=>{
  let reads=0;const next=deferred(),h=panelHarness(undefined,{pageReader:result=>{reads++;if(reads===2)return next.promise;if(reads===3)throw Error('NAS disconnected');return result;}});try{
    await h.open();h.context.epoch='project-two';h.context.clip_ids=['solid-14'];h.panel.invalidate();h.panel.invalidate();assert.equal(reads,2);assert.equal(h.button('Apply preset to selected clips').disabled,true);
    next.resolve({page:0,pages:1,total:2,items:[{...structuredClone(h.item()),id:'different-preset',name:'Another preset'},structuredClone(h.item())]});await settle();assert.equal(h.list().value,'1','selected native preset ID survives reordered catalog');assert.equal(h.button('Apply preset to selected clips').disabled,false);h.panel.invalidate();assert.equal(reads,2);
    h.context.epoch='project-three';h.panel.invalidate();await settle();assert.equal(reads,3);assert.equal(h.button('Apply preset to selected clips').disabled,true);assert.match(h.field('role',h.root).textContent,/NAS disconnected.*Refresh presets/);
    for(let n=0;n<5;n++)h.panel.invalidate();await settle();assert.equal(reads,3,'failed epoch read is not retried by selection refresh');
    h.button('Refresh presets').click();await settle();assert.equal(reads,4);assert.equal(h.button('Apply preset to selected clips').disabled,false);assert.deepEqual(h.writes,[]);
    assert.deepEqual(h.reads.filter(read=>read.path.startsWith('/presets/pages/')).map(read=>new URL(read.path,'http://fixture').searchParams.get('project_epoch')),['epoch','project-two','project-three','project-three']);
  }finally{h.destroy();}
});

test('project epoch refresh replaces an old pending catalog read and ignores its late acknowledgment',async()=>{
  let reads=0;const old=deferred(),fresh=deferred(),h=panelHarness(undefined,{pageReader:result=>++reads===2?old.promise:reads===3?fresh.promise:result});try{
    await h.open();h.button('Refresh presets').click();const oldRequest=h.reads.at(-1);h.context.epoch='new-project';h.panel.invalidate();h.panel.invalidate();assert.equal(reads,3);assert.equal(oldRequest.options.signal.aborted,true);
    fresh.resolve({page:0,pages:1,total:1,items:[{...structuredClone(h.item()),revision:'fresh-revision'}]});await settle();assert.equal(h.button('Apply preset to selected clips').disabled,false);
    old.resolve({page:0,pages:1,total:1,items:[{...structuredClone(h.item()),id:'obsolete-preset',revision:'obsolete-revision'}]});await settle();h.panel.invalidate();assert.equal(reads,3);h.activate();await settle();assert.deepEqual(h.writes,[{kind:'apply_saved_preset',clip_ids:['clip'],preset_id:'preset',revision:'fresh-revision'}]);
  }finally{h.destroy();}
});

test('preset Delete is collapsed, confirms the captured name and cancels without reads, writes or shortcut changes',async()=>{
  const h=panelHarness();try{
    await h.open();const remove=h.button('Permanently delete saved preset…');assert.equal(remove.parent.tag,'details');assert.equal(remove.parent.open,false);assert.equal(remove.parent.children[0].textContent,'Preset actions');const reads=h.reads.length;
    remove.click();const dialog=h.dialog();assert.equal(dialog.getAttribute('aria-label'),'Confirm permanent preset deletion');assert(dialog.children[0].children.some(node=>node.textContent==='Saved look'));assert.match(h.field('role',dialog).textContent,/permanently.*Undo cannot restore/);assert.equal(h.reads.length,reads);assert.deepEqual(h.writes,[]);assert.deepEqual(h.deactivated,[]);
    for(const patch of [{repeat:true},{isComposing:true},{ctrlKey:true},{shiftKey:true}]){const event=new Event('keydown',{cancelable:true});for(const [key,value] of Object.entries({key:'Enter',...patch}))Object.defineProperty(event,key,{value});dialog.dispatchEvent(event);assert.equal(event.defaultPrevented,true);}assert.deepEqual(h.writes,[]);
    h.button('Cancel preset deletion',dialog).click();assert.equal(h.dialog(),undefined);h.deleteKey({key:'Backspace'});const cancel=new Event('cancel',{cancelable:true});h.dialog().dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(h.dialog(),undefined);assert.deepEqual(h.writes,[]);
    for(const patch of [{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{getModifierState:key=>key==='AltGraph'},{target:{tag:'input'}}]){assert.equal(h.deleteKey(patch).defaultPrevented,false);assert.equal(h.dialog(),undefined);}
  }finally{h.destroy();}
});

test('confirmed active or archived preset Delete sends once, validates the ACK, then removes its shortcut and reloads without fetching the deleted item',async()=>{
  for(const archived of [false,true]){
    const gate=deferred(),h=panelHarness(undefined,{item:{archived},remove:()=>gate.promise});try{
      await h.open();if(archived){h.archived(true);await settle();}h.deleteKey();const dialog=h.dialog(),form=dialog.children[0],before=h.reads.length;h.submit(dialog);form.dispatchEvent(new Event('submit',{cancelable:true}));h.deleteKey();
      assert.deepEqual(h.writes,[{kind:'edit_preset_library',edit:{action:'delete',id:'preset',revision:'r1',archived}}]);assert.deepEqual(h.deactivated,[]);assert.equal(h.dialog(),undefined);assert.equal(h.reads.length,before);
      gate.resolve(h.deletionReceipt(h.writes[0].edit));await settle();assert.deepEqual(h.deactivated,['preset']);assert.equal(h.list().children.length,0);assert.equal(h.reads.length,before+1);assert(h.reads.at(-1).path.startsWith('/presets/pages/'));assert(!h.reads.some(read=>read.path.startsWith('/presets/items/')));assert.match(h.field('role',h.root).textContent,/permanently deleted.*effects unchanged.*no project Undo/);
    }finally{h.destroy();}
  }
});

test('a changed preset, session, readonly writer, pending read or hidden panel cannot confirm preset Delete',async()=>{
  for(const change of [h=>{h.context.generation='2';h.panel.invalidate();},h=>{h.context.epoch='new';h.panel.invalidate();},h=>{h.context.command_epoch='new-writer';h.panel.invalidate();},h=>{h.setWritable(false);h.panel.invalidate();},h=>h.button('Refresh presets').click(),h=>{h.savedRevision('changed');h.button('Refresh presets').click();}]){
    const h=panelHarness();try{await h.open();h.deleteKey();const dialog=h.dialog();change(h);assert.equal(h.button('Permanently delete preset',dialog).disabled,true);h.submit(dialog);await settle();assert.deepEqual(h.writes,[]);assert.deepEqual(h.deactivated,[]);}finally{h.destroy();}
  }
  const h=panelHarness();try{await h.open();h.deleteKey();const dialog=h.dialog();h.panel.hide();h.submit(dialog);assert.equal(h.dialog(),undefined);assert.deepEqual(h.writes,[]);await h.open();assert.equal(h.dialog(),undefined);}finally{h.destroy();}
});

test('preset Delete refuses an unverified or failed ACK without deactivating a shortcut, clearing the row or replaying',async()=>{
  for(const change of [receipt=>({...receipt,project_epoch:'other'}),receipt=>({...receipt,status:'unknown'}),receipt=>({...receipt,command_id:''}),receipt=>({...receipt,preset_library_durable:false}),receipt=>({...receipt,deleted_preset:{...receipt.deleted_preset,revision:'changed'}}),()=>{throw Object.assign(Error('Outcome unknown'),{code:'OUTCOME_UNKNOWN'});}]){
    const h=panelHarness(undefined,{remove:operation=>change(h.deletionReceipt(operation.edit))});try{
      await h.open();h.deleteKey();h.submit();await settle();assert.equal(h.writes.length,1);assert.deepEqual(h.deactivated,[]);assert.equal(h.list().children.length,1);assert.equal(h.button('Permanently delete saved preset…').disabled,true);assert.match(h.field('role',h.root).textContent,/check command status/);h.panel.invalidate();await settle();assert.equal(h.writes.length,1);assert.equal(h.reads.length,1);
    }finally{h.destroy();}
  }
});

test('acknowledged preset Delete remains successful when refresh fails and never repeats the deletion',async()=>{
  let reads=0;const h=panelHarness(undefined,{pageReader:result=>{if(++reads>1)throw Error('NAS refresh failed');return result;}});try{
    await h.open();h.deleteKey();h.submit();await settle();assert.equal(h.writes.length,1);assert.deepEqual(h.deactivated,['preset']);assert.match(h.field('role',h.root).textContent,/Command applied successfully.*refresh failed.*do not submit it again/);assert.equal(h.button('Apply preset to selected clips').disabled,true);assert.equal(h.button('Permanently delete saved preset…').disabled,true);h.panel.invalidate();await settle();assert.equal(reads,2);assert.equal(h.writes.length,1);assert(!h.reads.some(read=>read.path.startsWith('/presets/items/')));
  }finally{h.destroy();}
});
