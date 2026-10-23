import test from 'node:test';
import assert from 'node:assert/strict';
import {createFontCatalogReader,validateFontCatalog,fontFamilyChoices,fontFaceChoices,selectableFontFamily,createTitleFontChooser} from '../js/fonts.js';

const catalog=()=>({families:[{family:'',name:'Sans-serif',faces:[]},{family:'Native Serif',name:'Native Serif',faces:[{weight:400,italic:false,name:'Regular'},{weight:400,italic:true,name:'Italic'},{weight:1000,italic:false,name:'Black'}]}]});

test('font reader shares one validated immutable read while aborting only its own consumer',async()=>{
  let resolve,calls=0;const read=createFontCatalogReader(()=>{calls++;return new Promise(done=>{resolve=done;});}),a=new AbortController(),b=new AbortController();
  const first=read({signal:a.signal}),second=read({signal:b.signal}),canceled=assert.rejects(first,{name:'AbortError'});a.abort();await canceled;assert.equal(calls,1);
  resolve(catalog());const value=await second;assert.equal(await read(),value);assert.equal(calls,1);assert.equal(Object.isFrozen(value.families[1].faces[0]),true);
  assert.throws(()=>value.families.push({}));assert.equal(b.signal.aborted,false);
});

test('failed or malformed font reads require an explicit new call and never poison the successful cache',async()=>{
  for(const malformed of [false,true]){
    let calls=0;const read=createFontCatalogReader(()=>{calls++;if(calls===1){if(malformed)return {families:[]};throw Error('Fonts unavailable');}return catalog();});
    await assert.rejects(read());assert.equal(calls,1);const value=await read();assert.equal(calls,2);assert.equal(await read(),value);assert.equal(calls,2);
  }
  let calls=0;const read=createFontCatalogReader(()=>{calls++;return catalog();}),controller=new AbortController();controller.abort();await assert.rejects(read({signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});

test('font choices retain unknown saved values and unsupported long families without selecting an invented replacement',()=>{
  const data=catalog(),long='é'.repeat(65);data.families.push({family:long,name:long,faces:[]});const checked=validateFontCatalog(data);
  const unknown=fontFamilyChoices(checked,'Missing family');assert.equal(unknown.at(-1).value,'Missing family');assert.equal(unknown.at(-1).disabled,true);assert.match(unknown.at(-1).label,/not installed/);
  assert.equal(fontFamilyChoices(checked,long).find(choice=>choice.value===long).disabled,true);assert.equal(selectableFontFamily('é'.repeat(64)),true);assert.equal(selectableFontFamily(long),false);assert.equal(selectableFontFamily('bad\nfont'),false);
  const installed=fontFaceChoices(checked,'Native Serif',{weight:1000,italic:false});assert.equal(installed.find(choice=>choice.value==='1000:0').disabled,false);
  const fallback=fontFaceChoices(checked,'Missing family',{weight:650,italic:true});assert.deepEqual(fallback.slice(0,4).map(choice=>[choice.face.weight,choice.face.italic]),[[400,false],[700,false],[400,true],[700,true]]);assert.equal(fallback.at(-1).value,'650:1');assert.equal(fallback.at(-1).disabled,true);
});

test('catalog validation refuses ambiguous families/styles and malformed native metadata',()=>{
  const duplicate=catalog();duplicate.families.push(duplicate.families[1]);assert.throws(()=>validateFontCatalog(duplicate));
  const styles=catalog();styles.families[1].faces.push(styles.families[1].faces[0]);assert.throws(()=>validateFontCatalog(styles));
  const bad=catalog();bad.families[1].faces[0].italic='false';assert.throws(()=>validateFontCatalog(bad));assert.throws(()=>validateFontCatalog({families:[catalog().families[1]]}));
});

async function settle(){for(let n=0;n<8;n++)await Promise.resolve();}
function chooserHarness(options={}){
  class Surface extends EventTarget{
    constructor(){super();this.listeners=new Map();}
    addEventListener(type,handler,settings){super.addEventListener(type,handler,settings);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
    removeEventListener(type,handler,settings){super.removeEventListener(type,handler,settings);this.listeners.get(type)?.delete(handler);}
    count(){return [...this.listeners.values()].reduce((total,handlers)=>total+handlers.size,0);}
  }
  class Element extends Surface{
    constructor(tag){super();this.tag=tag;this.children=[];this.parent=null;this.attributes=new Map();this.style={setProperty:(name,value)=>this.attributes.set(`style:${name}`,value)};this.disabled=false;this.textContent='';this.open=false;this.ownerDocument=doc;}
    get isConnected(){return this===doc.body || Boolean(this.parent?.isConnected);}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
    contains(target){return this===target || this.children.some(child=>child.contains(target));}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}removeAttribute(name){this.attributes.delete(name);}
    getBoundingClientRect(){return {left:100,bottom:450,width:240};}showPopover(){this.showing=true;}hidePopover(){this.showing=false;}scrollIntoView(){}
    focus(){doc.activeElement=this;}click(){if(!this.disabled)fire(this,'click');}
  }
  const doc=new Surface(),view=new Surface();doc.defaultView=view;view.innerWidth=800;view.innerHeight=600;doc.createElement=tag=>new Element(tag);doc.body=doc.createElement('body');
  const group=doc.createElement('details'),root=doc.createElement('div');doc.body.append(group);group.append(root);group.open=Boolean(options.open);
  let current=true,writable=true,reads=0,now=0,timerId=0;const timers=new Map(),registered=[],previews=[],commits=[],title={font_family:'',font_weight:400,italic:false,...options.title};
  function fire(target,type,properties={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});target.dispatchEvent(event);return event;}
  const chooser=createTitleFontChooser({root,group,title,readFonts:({signal})=>{reads++;return options.read?options.read({signal}):catalog();},isCurrent:()=>current,canInteract:()=>writable,register:(node,available)=>{registered.push({node,available});return node;},sync:()=>{for(const {node,available} of registered)node.disabled=!available();},onPreview:value=>{previews.push(value);return options.preview?.(value);},onFamily:value=>{const patch={font_family:value};commits.push(patch);return options.commit?.(patch);},onFace:value=>{const patch={font_weight:value.weight,italic:value.italic};commits.push(patch);return options.commit?.(patch);},schedule:(callback,ms)=>{const id=++timerId;timers.set(id,{at:now+ms,callback});return id;},unschedule:id=>timers.delete(id)});
  const all=(node=doc.body)=>[node,...node.children.flatMap(all)];
  const button=label=>{const node=all().find(node=>node.getAttribute('aria-label')===label);assert(node,label);return node;};
  const popup=()=>all().find(node=>node.getAttribute('role')==='listbox');
  return {chooser,doc,view,group,root,title,previews,commits,button,popup,fire,reads:()=>reads,timers,all,
    open:async()=>{group.open=true;fire(group,'toggle');await settle();},
    key:(kind,key,properties={})=>fire(button(`Server font ${kind}`),'keydown',{key,...properties}),
    hover:index=>fire(popup().children[index],'pointerenter'),choose:index=>popup().children[index].click(),
    wheel:(kind,deltaY)=>fire(button(`Server font ${kind}`),'wheel',{deltaY}),
    advance(ms){const until=now+ms;for(;;){const next=[...timers.entries()].filter(([,entry])=>entry.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();}now=until;},
    readonly:()=>{writable=false;},stale:()=>{current=false;},dispose:()=>chooser.dispose(),
  };
}

test('font popup previews only a stable hovered native choice and Escape restores without an edit',async()=>{
  const h=chooserHarness();try{
    await h.open();h.button('Server font family').click();assert.equal(h.button('Server font family').getAttribute('role'),'combobox');assert.equal(h.button('Server font family').getAttribute('aria-expanded'),'true');assert.equal(h.popup().getAttribute('aria-label'),'Server font family choices');assert.deepEqual(h.previews,[]);
    h.hover(1);h.advance(129);assert.deepEqual(h.previews,[]);h.advance(1);assert.deepEqual(h.previews,[{font_family:'Native Serif'}]);assert.deepEqual(h.commits,[]);
    h.key('family','Escape');assert.equal(h.popup(),undefined);assert.equal(h.button('Server font family').value,'');assert.equal(h.previews.at(-1),null);assert.deepEqual(h.commits,[]);assert.equal(h.key('family','n').defaultPrevented,true);h.advance(130);assert.deepEqual(h.previews.at(-1),{font_family:'Native Serif'});h.key('family','Tab');assert.equal(h.popup(),undefined);assert.deepEqual(h.commits,[]);
  }finally{h.dispose();}
});

test('font keyboard navigation previews and Enter or an explicit option click commits exactly one native callback',async()=>{
  let resolve;const h=chooserHarness({title:{font_family:'Native Serif'},commit:()=>new Promise(done=>{resolve=done;})});try{
    await h.open();const down=h.key('style','ArrowDown');assert.equal(down.defaultPrevented,true);assert.equal(h.popup().children[1].getAttribute('aria-selected'),'true');h.advance(130);assert.deepEqual(h.previews.at(-1),{font_weight:400,italic:true});h.key('style','Enter');h.key('style','Enter');assert.deepEqual(h.commits,[{font_weight:400,italic:true}]);assert.equal(h.previews.at(-1),null);assert.equal(h.popup(),undefined);resolve();await settle();
    h.button('Server font family').click();h.choose(0);resolve();await settle();assert.deepEqual(h.commits[1],{font_family:''});
  }finally{h.dispose();}
});

test('font closed-wheel bursts step enabled choices without wrapping and commit once after idle',async()=>{
  const h=chooserHarness({title:{font_family:'Native Serif'}});try{
    await h.open();assert.equal(h.wheel('style',1).defaultPrevented,true);h.advance(80);h.wheel('style',1);h.advance(80);h.wheel('style',1);h.advance(149);assert.deepEqual(h.commits,[]);h.advance(1);await settle();assert.deepEqual(h.commits,[{font_weight:1000,italic:false}]);assert.equal(h.timers.size,0);
    const boundary=chooserHarness({title:{font_family:'Native Serif',font_weight:1000}});try{await boundary.open();boundary.wheel('style',1);boundary.advance(300);assert.deepEqual(boundary.commits,[]);assert.equal(boundary.timers.size,0);}finally{boundary.dispose();}
  }finally{h.dispose();}
});

test('font Tab, outside focus/click, external scroll and collapse cancel while internal list scrolling keeps the draft',async()=>{
  const h=chooserHarness();try{
    await h.open();for(const cancel of [()=>h.key('family','Tab'),()=>h.fire(h.doc,'pointerdown',{target:h.doc.body}),()=>h.fire(h.doc,'focusin',{target:h.doc.body}),()=>h.fire(h.doc,'scroll',{target:h.doc}),()=>{h.group.open=false;h.fire(h.group,'toggle');}]){
      if(!h.group.open)await h.open();h.button('Server font family').click();h.hover(1);h.advance(130);h.fire(h.doc,'scroll',{target:h.popup()});assert(h.popup());cancel();assert.equal(h.popup(),undefined);assert.equal(h.previews.at(-1),null);assert.deepEqual(h.commits,[]);assert.equal(h.timers.size,0);
    }
  }finally{h.dispose();}
});

test('font disabled families and unknown current styles remain visible; stale, readonly and disposed drafts cannot preview or commit',async()=>{
  const data=catalog(),long='é'.repeat(65);data.families.push({family:long,name:'Too long',faces:[]});
  const disabled=chooserHarness({read:()=>data,title:{font_family:'Missing',font_weight:650,italic:true}});try{await disabled.open();disabled.button('Server font family').click();assert.match(disabled.button('Server font family').textContent,/not installed/);assert.equal(disabled.popup().children[2].getAttribute('aria-disabled'),'true');disabled.hover(2);disabled.choose(2);disabled.advance(200);assert.deepEqual(disabled.commits,[]);assert.deepEqual(disabled.previews,[]);disabled.key('family','Escape');disabled.button('Server font style').click();assert.match(disabled.button('Server font style').textContent,/650 italic/);disabled.key('style','Escape');disabled.wheel('style',1);disabled.advance(150);await settle();assert.deepEqual(disabled.commits,[{font_weight:700,italic:false}],'Native unknown-current wheel starts at item0 before stepping');}finally{disabled.dispose();}
  for(const invalidate of [h=>h.stale(),h=>h.readonly(),h=>h.dispose()]){const h=chooserHarness();try{await h.open();h.button('Server font family').click();h.hover(1);invalidate(h);h.advance(300);assert.deepEqual(h.commits,[]);assert(!h.previews.some(value=>value!==null));assert.equal(h.popup(),undefined);assert.equal(h.timers.size,0);}finally{h.dispose();}}
  const h=chooserHarness();await h.open();h.wheel('family',1);h.dispose();h.advance(400);assert.deepEqual(h.commits,[]);assert.equal(h.timers.size,0);assert.equal(h.doc.count(),0);assert.equal(h.view.count(),0);assert.equal(h.group.count(),0);
});

test('font catalog failure keeps manual fallback and retries only explicitly; canceled old reads cannot reopen a chooser',async()=>{
  let fail=true;const h=chooserHarness({read:()=>{if(fail)throw Error('Fonts unavailable');return catalog();}});try{await h.open();assert.equal(h.button('Server font family').disabled,true);assert.equal(h.button('Retry server fonts').hidden,false);h.group.open=false;h.fire(h.group,'toggle');await h.open();assert.equal(h.reads(),1);fail=false;h.button('Retry server fonts').click();await settle();assert.equal(h.reads(),2);assert.equal(h.button('Server font family').disabled,false);assert.deepEqual(h.commits,[]);}finally{h.dispose();}
  let resolve,signal;const old=chooserHarness({read:options=>{signal=options.signal;return new Promise(done=>{resolve=done;});}});await old.open();old.dispose();assert.equal(signal.aborted,true);resolve(catalog());await settle();assert.equal(old.popup(),undefined);assert.deepEqual(old.previews,[]);assert.deepEqual(old.commits,[]);
});
