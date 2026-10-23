import test from 'node:test';
import assert from 'node:assert/strict';
import {linearToGamma,gammaToLinear,colorToPicker,pickerToColor,colorToHex,hexToColor,colorEdit,renderColorPicker} from '../js/color-picker.js';

const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const value={r:.20000000298023224,g:.4000000059604645,b:.800000011920929,a:.7312345504760742};
function fixture(initial=value,{collapsed=false,apply}={}){
  const win=new EventTarget(),doc=new EventTarget(),frames=new Map();let frame=0,allowed=true,unknown=false,disposed=false,canvasReads=0;
  win.innerWidth=1280;win.innerHeight=720;win.requestAnimationFrame=callback=>{frames.set(++frame,callback);return frame;};win.cancelAnimationFrame=id=>frames.delete(id);doc.defaultView=win;doc.hidden=false;doc.querySelector=()=>null;
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.properties={};this.isConnected=true;this.value='';this.hidden=false;this.open=false;this.captured=new Set();this.rect={left:100,top:120,width:200,height:160};this.style={setProperty:(key,value)=>{this.properties[key]=value;}};}
    append(...children){for(const child of children){this.children.push(child);if(typeof child==='object')child.parentElement=this;}}
    setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}reportValidity(){return true;}
    getBoundingClientRect(){return {...this.rect,bottom:this.rect.top+this.rect.height};}focus(){doc.activeElement=this;}
    closest(){for(let node=this;node;node=node.parentElement)if(node.hidden || node.tagName==='details' && !node.open)return node;return null;}
    contains(target){return this===target || this.children.some(child=>typeof child==='object' && child.contains(target));}
    setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}
    showPopover(){this.popoverOpen=true;}hidePopover(){this.popoverOpen=false;}getContext(){canvasReads++;return {};}
  }
  doc.createElement=tag=>new Element(tag);const group=new Element('details');group.open=!collapsed;const root=new Element('div');group.append(root);const writes=[],registered=[];
  const controls={current:()=>allowed && !disposed,available:()=>allowed && !unknown && !disposed,register(node,available=()=>true){registered.push([node,available]);node.disabled=!this.available() || !available();return node;},sync(){for(const [node,available] of registered)node.disabled=!this.available() || !available();}};
  const widget=renderColorPicker(root,{label:'Test color',value:initial,controls,apply:next=>{writes.push(next);return apply?apply(next):Promise.resolve({applied:true});}}),all=(node=root)=>[node,...node.children.flatMap(child=>typeof child==='object'?all(child):[])],field=label=>all().find(node=>node.attributes['aria-label']===label),popup=()=>field('Test color color editor');
  const send=(node,type,properties={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:200,clientY:200,...properties}))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;};
  return {widget,root,group,win,doc,writes,frames,field,popup,send,all,controls,canvasReads:()=>canvasReads,open(){send(field('Choose Test color'),'click');},setAllowed(next){allowed=next;},setUnknown(next){unknown=next;controls.sync();},detach(){root.isConnected=false;},dispose(){widget.dispose();disposed=true;}};
}

test('native picker uses linear RGB hue/saturation with gamma only on value and sRGB only on byte display',()=>{
  const picker=colorToPicker(value);assert.ok(Math.abs(picker.h*360-220)<.0001);assert.ok(Math.abs(picker.s-.75)<.000001);assert.ok(Math.abs(picker.v-.90633175)<.000001);
  const roundtrip=pickerToColor(picker,value.a);for(const axis of ['r','g','b'])assert.ok(Math.abs(roundtrip[axis]-value[axis])<.000001);assert.equal(roundtrip.a,value.a);
  assert.ok(Math.abs(gammaToLinear(linearToGamma(.2))-.2)<.000001);assert.equal(colorToHex({r:1,g:0,b:0,a:1}),'#FF0000FF');
  const hex=hexToColor('#808080',value.a);assert.ok(Math.abs(hex.r-.2158605)<.000001);assert.equal(hex.a,value.a);assert.equal(hexToColor('#FF000000').a,0);assert.throws(()=>hexToColor('#12345'));
});

test('unchanged native values retain exact floats and hidden zero-alpha RGB; explicit changed alpha0 follows native normalization',()=>{
  assert.equal(colorEdit(value,{...value,r:value.r+1e-10}),null);const next=colorEdit(value,{...value,a:.5});assert.deepEqual(next,{...value,a:.5});
  const transparent={r:.123456789,g:.234567891,b:.345678912,a:0};assert.equal(colorEdit(transparent,transparent),null);assert.deepEqual(colorEdit(value,{...value,a:0}),{r:0,g:0,b:0,a:0});
});

test('opening, unchanged hex/precise Apply and cancel do not quantize or commit the authoritative color',async()=>{
  const f=fixture();try{
    assert.equal(f.canvasReads(),0);f.open();assert.equal(f.popup().popoverOpen,true);assert.equal(f.frames.size,1);
    for(const axis of ['r','g','b','a'])assert.equal(f.field(`Test color ${axis.toUpperCase()}`).value,String(value[axis]));
    f.send(f.field('Test color sRGB hex').parentElement.parentElement,'submit');await settle();assert.deepEqual(f.writes,[]);
    f.send(f.field('Test color R').parentElement.parentElement,'submit');await settle();assert.deepEqual(f.writes,[]);
    f.field('Test color R').value='.123456789';f.send(f.field('Test color R'),'input');f.send(f.popup(),'keydown',{key:'Escape'});await settle();assert.deepEqual(f.writes,[]);assert.equal(f.field('Test color R').value,String(value.r));assert.equal(f.frames.size,0);assert.deepEqual(value,{r:.20000000298023224,g:.4000000059604645,b:.800000011920929,a:.7312345504760742});
  }finally{f.dispose();}
});

test('owned release commits final alpha once without changing RGB, ignoring other pointer and duplicate release',async()=>{
  const f=fixture();try{
    f.open();const alpha=f.field('Test color alpha');f.send(alpha,'pointerdown',{clientX:160});f.send(alpha,'pointermove',{clientX:180});assert.deepEqual(f.writes,[]);
    f.send(alpha,'pointerup',{pointerId:2,clientX:110});assert.deepEqual(f.writes,[]);assert.equal(alpha.hasPointerCapture(1),true);
    f.send(alpha,'pointerup',{clientX:200});await settle();assert.deepEqual(f.writes,[{...value,a:.5}]);assert.equal(alpha.hasPointerCapture(1),false);assert.equal(f.popup().hidden,true);f.send(alpha,'pointerup',{clientX:110});await settle();assert.equal(f.writes.length,1);
  }finally{f.dispose();}
});

test('cancel, capture loss, blur, hidden, resize, detached or stale owners never send the draft',async t=>{
  for(const action of ['cancel','escape','capture','blur','hidden','resize','detached','stale'])await t.test(action,async()=>{
    const f=fixture();try{f.open();const square=f.field('Test color saturation and value');f.send(square,'pointerdown');f.send(square,'pointermove',{clientX:250,clientY:150});
      if(action==='cancel')f.send(square,'pointercancel');if(action==='escape')f.send(f.popup(),'keydown',{key:'Escape'});if(action==='capture')f.send(square,'lostpointercapture');if(action==='blur')f.win.dispatchEvent(new Event('blur'));if(action==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}if(action==='resize')f.win.dispatchEvent(new Event('resize'));if(action==='detached')f.detach();if(action==='stale')f.setAllowed(false);
      f.send(square,'pointerup');await settle();assert.deepEqual(f.writes,[]);assert.equal(square.captured.size,0);assert.equal(f.frames.size,0);
    }finally{f.dispose();}
  });
});

test('native precision fallback validates all axes and only quantizes the explicitly edited native channel',async()=>{
  const f=fixture();try{
    const r=f.field('Test color R'),form=r.parentElement.parentElement;r.value='';f.send(form,'submit');await settle();assert.deepEqual(f.writes,[]);r.value='.123456789';f.send(form,'submit');await settle();assert.deepEqual(f.writes,[{...value,r:Math.fround(.123456789)}]);
  }finally{f.dispose();}
});

test('canceling a queued color confirmation prevents dispatch while a fresh edit remains usable',async()=>{
  for(const kind of ['numeric','visual']){
    const f=fixture();try{
      f.open();const r=f.field('Test color R'),alpha=f.field('Test color alpha');
      if(kind==='numeric'){r.value='.123456789';f.send(r.parentElement.parentElement,'submit');}
      else{f.send(alpha,'pointerdown',{clientX:200});f.send(alpha,'pointerup',{clientX:200});}
      f.widget.cancel();await settle();assert.deepEqual(f.writes,[],kind);assert.equal(f.popup().hidden,true);assert.equal(f.frames.size,0);assert.equal(r.value,String(value.r));
      f.open();assert.equal(f.popup().hidden,false);
      if(kind==='numeric'){r.value='.3';f.send(r.parentElement.parentElement,'submit');}
      else{f.send(alpha,'pointerdown',{clientX:200});f.send(alpha,'pointerup',{clientX:200});}
      await settle();assert.deepEqual(f.writes,[kind==='numeric'?{...value,r:Math.fround(.3)}:{...value,a:.5}],kind);
    }finally{f.dispose();}
  }
});

test('pending and unknown native outcome block repeats and disposal cannot reopen or steal focus',async()=>{
  let reject;const f=fixture(value,{apply:()=>new Promise((resolve,fail)=>{reject=fail;})});try{
    f.open();const alpha=f.field('Test color alpha');f.send(alpha,'keydown',{key:'ArrowLeft'});await settle();assert.equal(f.writes.length,1);f.open();f.send(alpha,'keydown',{key:'ArrowLeft'});await settle();assert.equal(f.writes.length,1);
    f.setUnknown(true);reject(Object.assign(Error('Command outcome unknown'),{code:'OUTCOME_UNKNOWN'}));await settle();f.open();assert.equal(f.popup().hidden,true);assert.equal(f.writes.length,1);
    const nextFocus={};f.doc.activeElement=nextFocus;f.dispose();f.send(f.field('Choose Test color'),'click');assert.equal(f.doc.activeElement,nextFocus);assert.equal(f.frames.size,0);
  }finally{f.dispose();}
});

test('confirmed visual alpha0 caches native latent RGB for a new transparent component and positive alpha restores it',async()=>{
  const first=fixture();try{first.open();const alpha=first.field('Test color alpha');first.send(alpha,'pointerdown',{clientX:100});first.send(alpha,'pointerup',{clientX:100});await settle();assert.deepEqual(first.writes,[{r:0,g:0,b:0,a:0}]);}finally{first.dispose();}
  const next=fixture({r:0,g:0,b:0,a:0});try{next.open();const alpha=next.field('Test color alpha');next.send(alpha,'pointerdown',{clientX:200});next.send(alpha,'pointerup',{clientX:200});await settle();assert.deepEqual(next.writes,[{...value,a:.5}]);}finally{next.dispose();}
});

test('a stale owner between release and dispatch cannot write or replace the confirmed transparent hue cache',async()=>{
  const seed=fixture();try{seed.open();const alpha=seed.field('Test color alpha');seed.send(alpha,'pointerdown',{clientX:100});seed.send(alpha,'pointerup',{clientX:100});await settle();assert.equal(seed.writes.length,1);}finally{seed.dispose();}
  const stale=fixture({r:.83,g:.52,b:.39,a:1});try{stale.open();const alpha=stale.field('Test color alpha');stale.send(alpha,'pointerdown',{clientX:100});stale.send(alpha,'pointerup',{clientX:100});stale.setAllowed(false);await settle();assert.deepEqual(stale.writes,[]);}finally{stale.dispose();}
  const next=fixture({r:0,g:0,b:0,a:0});try{next.open();const alpha=next.field('Test color alpha');next.send(alpha,'pointerdown',{clientX:200});next.send(alpha,'pointerup',{clientX:200});await settle();assert.deepEqual(next.writes,[{...value,a:.5}]);}finally{next.dispose();}
});

test('collapsed Inspector groups re-enable their chooser only when opened and closing cancels local motion',async()=>{
  const f=fixture(value,{collapsed:true});try{
    assert.equal(f.field('Choose Test color').disabled,true);f.open();assert.equal(f.popup().hidden,true);f.group.open=true;f.group.dispatchEvent(new Event('toggle'));assert.equal(f.field('Choose Test color').disabled,false);
    f.open();const alpha=f.field('Test color alpha');f.send(alpha,'pointerdown');f.group.open=false;f.group.dispatchEvent(new Event('toggle'));f.send(alpha,'pointerup');await settle();assert.deepEqual(f.writes,[]);assert.equal(f.popup().hidden,true);assert.equal(f.frames.size,0);
  }finally{f.dispose();}
});

test('precision popup internal scroll retains its local draft while Inspector or window scroll cancels',()=>{
  const f=fixture();try{
    const r=f.field('Test color R');
    for(const outside of [f.group,f.win]){
      f.open();r.value='.123456789';f.send(r,'input');
      for(const target of [f.popup(),r.parentElement.parentElement]){const event=new Event('scroll');Object.defineProperty(event,'target',{value:target});f.win.dispatchEvent(event);assert.equal(f.popup().hidden,false);assert.equal(r.value,'.123456789');assert.deepEqual(f.writes,[]);}
      const event=new Event('scroll');Object.defineProperty(event,'target',{value:outside});f.win.dispatchEvent(event);assert.equal(f.popup().hidden,true);assert.equal(r.value,String(value.r));assert.deepEqual(f.writes,[]);
    }
  }finally{f.dispose();}
});
