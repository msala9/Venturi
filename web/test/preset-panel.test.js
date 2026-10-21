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
function panelHarness(shortcut='Ctrl+Alt+Shift+B'){
  const original={document:globalThis.document,Option:globalThis.Option},reads=[],catalogReads=[],writes=[],deactivated=[],notices=[];let enabled=true,activated=0;
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
  const body=new Element('body'),root=new Element('root');body.append(root);globalThis.document={body,createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  const context={epoch:'epoch',generation:'1',timeline:'timeline',revision:'revision',clip_ids:['clip'],roles:{video:true,audio:true},name:'Selected clips'};
  let item={id:'preset',revision:'r1',name:'Saved look',attributes:['zoom'],anchor:'start',append_filters:false,shortcut,video:true,audio:false,archived:false};
  const mutate=async operation=>{writes.push(operation);const options=operation.options || operation.edit.options,old=operation.kind==='save_attribute_preset'?null:item.shortcut;item={...item,...options,id:operation.kind==='save_attribute_preset'?'created':item.id,revision:'r2',shortcut:options.shortcut?.action==='set'?options.shortcut.value:options.shortcut?.action==='clear'?null:old};return {command_id:operation.kind==='save_attribute_preset'?'created':'updated'};};
  const panel=createPresetPanel({root,getContext:()=>context,canCommit:()=>true,commit:mutate,libraryCommit:mutate,notice:message=>notices.push(message),shortcuts:{state:()=>({enabled,label:'Ctrl+Alt+Shift+B'}),activate(){activated++;enabled=true;},deactivate(id){deactivated.push(id);enabled=false;},sync(){}},api:async(path,body,options)=>{reads.push({path,body,options});if(path==='/presets/shortcuts'){const pending=deferred();catalogReads.push({...pending,options});return pending.promise;}if(path.startsWith('/presets/pages/'))return {page:0,pages:1,total:1,items:[structuredClone(item)]};if(path.startsWith('/presets/items/'))return structuredClone(item);throw Error(`Unexpected route ${path}`);}});
  const walk=node=>[node,...(node.children || []).filter(child=>child instanceof Element).flatMap(walk)];
  const dialog=()=>walk(body).find(node=>node.tag==='dialog' && node.open);
  const button=(text,parent=root)=>{const found=walk(parent).find(node=>node.tag==='button' && node.textContent===text);assert(found,`Expected button ${text}`);return found;};
  const field=(attribute,parent=dialog())=>{const found=walk(parent).find(node=>node.attributes?.has(attribute));assert(found,`Expected ${attribute}`);return found;};
  return {panel,root,context,reads,catalogReads,writes,deactivated,notices,item:()=>item,enabled:()=>enabled,activated:()=>activated,button,dialog,field,
    async open(){await panel.open();},edit(){button('Edit preset settings').click();return dialog();},capture(){button('Save selection as preset').click();return dialog();},
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
