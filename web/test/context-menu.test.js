import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineContextMenu} from '../js/timeline/context-menu.js';

const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture(){
  const doc=new EventTarget(),win=new EventTarget(),writes=[],notices=[];win.innerWidth=640;win.innerHeight=480;doc.defaultView=win;doc.hidden=false;
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.properties={};this.isConnected=true;this.style={setProperty:(key,value)=>{this.properties[key]=value;}};this.rect={left:450,top:300,width:220,height:140,right:670,bottom:440};}
    append(...children){for(const child of children){this.children.push(child);child.parentNode=this;}}
    removeChild(child){this.children=this.children.filter(value=>value!==child);child.parentNode=null;child.isConnected=false;}
    remove(){this.parentNode?.removeChild(this);}setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}
    contains(target){return target===this || this.children.some(child=>child.contains?.(target));}getBoundingClientRect(){return {...this.rect};}focus(){doc.activeElement=this;this.dispatchEvent(new Event('focus'));}
    showPopover(){this.popoverOpen=true;}hidePopover(){this.popoverOpen=false;}
  }
  doc.createElement=tag=>new Element(tag);doc.body=new Element('body');const returnFocus=new Element('canvas');doc.body.append(returnFocus);
  const target={kind:'clip',clip_id:'clip',track_id:'track',frame:24,clientX:630,clientY:470,returnFocus};let context={identity:'epoch:timeline:revision:selection:frame',clip_id:'clip',frame:24},items=[{id:'disabled',label:'Locked action',enabled:false},{id:'copy',label:'Copy'},{separator:true},{id:'speed',label:'Speed',children:[{id:'normal',label:'Normal speed',checked:true},{id:'slow',label:'Half speed',checked:false}]},{id:'color',label:'Label color',children:[{id:'red',label:'Red'}]}],action=null;
  const widget=createTimelineContextMenu({document:doc,getContext:received=>received?.clip_id===target.clip_id?context:null,getItems:()=>items,onAction:(id,captured)=>{writes.push({id,context:captured,menuClosed:!widget.active()});return action?.(id,captured);},notice:message=>notices.push(message)});
  const all=(node=doc.body)=>[node,...node.children.flatMap(all)],menus=()=>all().filter(node=>node.attributes.role==='menu'),field=label=>all().find(node=>node.attributes['aria-label']===label);
  const send=(node,type,values={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(values))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;};
  return {doc,win,widget,target,returnFocus,writes,notices,all,menus,field,send,open:()=>widget.open(target),key:key=>send(menus().at(-1),'keydown',{key}),setContext:value=>{context=value;},setItems:value=>{items=value;},setAction:value=>{action=value;},dispose:()=>widget.dispose()};
}

test('context menu is transient, viewport clamped and exposes disabled and checked native menu semantics',()=>{
  const f=fixture();try{
    assert.equal(f.widget.active(),false);assert.equal(f.open(),true);const menu=f.menus()[0];assert.equal(f.widget.active(),true);assert.equal(menu.parentNode.popoverOpen,true);assert.equal(menu.properties.left,'412px');assert.equal(menu.properties.top,'332px');
    assert.equal(f.field('Locked action').attributes['aria-disabled'],'true');assert.equal(f.doc.activeElement,f.field('Copy'));
    f.send(f.field('Speed'),'click');assert.equal(f.field('Normal speed').attributes.role,'menuitemcheckbox');assert.equal(f.field('Normal speed').attributes['aria-checked'],'true');assert.equal(f.field('Half speed').attributes['aria-checked'],'false');assert.equal(f.menus().length,2);assert.ok(parseFloat(f.menus()[1].properties.left)>=8);assert.ok(parseFloat(f.menus()[1].properties.top)>=8);
    f.widget.close();assert.equal(f.widget.active(),false);assert.equal(f.menus().length,0);assert.equal(f.doc.activeElement,f.returnFocus);assert.deepEqual(f.writes,[]);
  }finally{f.dispose();}
});

test('arrows Home End submenu Escape and one-shot activation remain keyboard accessible and close before native action',()=>{
  const f=fixture();try{
    f.open();f.key('End');assert.equal(f.doc.activeElement,f.field('Label color'));f.key('Home');assert.equal(f.doc.activeElement,f.field('Copy'));f.key('ArrowDown');assert.equal(f.doc.activeElement,f.field('Speed'));
    f.key('ArrowRight');assert.equal(f.doc.activeElement,f.field('Normal speed'));f.key('ArrowDown');assert.equal(f.doc.activeElement,f.field('Half speed'));f.key('ArrowLeft');assert.equal(f.menus().length,1);assert.equal(f.doc.activeElement,f.field('Speed'));
    f.key('ArrowRight');f.key('End');const button=f.field('Half speed');f.key('Enter');f.send(button,'click');assert.deepEqual(f.writes,[{id:'slow',context:{identity:'epoch:timeline:revision:selection:frame',clip_id:'clip',frame:24},menuClosed:true}]);assert.equal(f.widget.active(),false);
    f.open();assert.equal(f.key('Escape').defaultPrevented,true);assert.equal(f.doc.activeElement,f.returnFocus);assert.equal(f.writes.length,1);
  }finally{f.dispose();}
});

test('stale ownership and newly disabled actions cannot dispatch or restore focus to an obsolete target',()=>{
  const f=fixture();try{
    f.open();const copy=f.field('Copy');f.setContext({identity:'new project',clip_id:'clip'});f.send(copy,'click');assert.equal(f.widget.active(),false);assert.deepEqual(f.writes,[]);assert.notEqual(f.doc.activeElement,f.returnFocus);
    f.open();f.setItems([{id:'copy',label:'Copy',enabled:false}]);f.send(f.field('Copy'),'click');assert.deepEqual(f.writes,[]);f.setContext(null);f.widget.invalidate();assert.equal(f.widget.active(),false);assert.deepEqual(f.writes,[]);
  }finally{f.dispose();}
});

test('internal menu scrolling retains ownership while external scroll focus pointer blur resize and visibility cancel',async t=>{
  for(const action of ['scroll','focus','pointer','blur','resize','hidden','tab'])await t.test(action,()=>{
    const f=fixture();try{
      f.open();const menu=f.menus()[0],internal=new Event('scroll');Object.defineProperty(internal,'target',{value:menu});f.win.dispatchEvent(internal);assert.equal(f.widget.active(),true);
      if(action==='scroll')f.win.dispatchEvent(new Event('scroll'));if(action==='focus')f.send(f.doc,'focusin',{target:f.returnFocus});if(action==='pointer')f.send(f.doc,'pointerdown',{target:f.returnFocus});if(action==='blur')f.win.dispatchEvent(new Event('blur'));if(action==='resize')f.win.dispatchEvent(new Event('resize'));if(action==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}if(action==='tab')f.key('Tab');
      assert.equal(f.widget.active(),false);assert.deepEqual(f.writes,[]);
    }finally{f.dispose();}
  });
});

test('disposing an open menu removes callbacks and prevents old buttons from changing a newly focused editor',()=>{
  const f=fixture();f.open();const copy=f.field('Copy'),focus={};f.doc.activeElement=focus;f.dispose();f.send(copy,'click');assert.deepEqual(f.writes,[]);assert.equal(f.doc.activeElement,focus);assert.equal(f.widget.active(),false);assert.equal(f.open(),false);f.win.dispatchEvent(new Event('scroll'));assert.equal(f.menus().length,0);
});

test('action failures are reported once after close and a native dialog can acquire focus without menu restoration',async()=>{
  const f=fixture();try{
    const dialogFocus={};f.setAction(()=>{f.doc.activeElement=dialogFocus;return Promise.reject(Error('Native action rejected'));});f.open();f.send(f.field('Copy'),'click');await settle();assert.equal(f.widget.active(),false);assert.deepEqual(f.notices,['Native action rejected']);assert.equal(f.doc.activeElement,dialogFocus);assert.equal(f.writes.length,1);
  }finally{f.dispose();}
});

test('native clip color submenu uses accessible checked swatches and six-column keyboard navigation with full-width Clear',()=>{
  const f=fixture();try{
    f.setItems([{id:'color',label:'Clip color',layout:'swatches',children:[...Array.from({length:12},(_,index)=>({id:`color:${index}`,label:`Native color ${index}`,swatch:[index*20,40,80],checked:index===0})),{separator:true},{id:'clear',label:'Clear clip color'}]}]);
    f.open();f.key('ArrowRight');const grid=f.menus()[1],first=f.field('Native color 0');assert.match(grid.className,/timeline-context-menu-swatches/);assert.equal(first.attributes.role,'menuitemcheckbox');assert.equal(first.attributes['aria-checked'],'true');assert.equal(first.title,'Native color 0');assert.equal(first.children.at(-1).properties['--swatch'],'rgb(0,40,80)');assert.equal(f.doc.activeElement,first);
    f.key('ArrowRight');assert.equal(f.doc.activeElement,f.field('Native color 1'));f.key('ArrowDown');assert.equal(f.doc.activeElement,f.field('Native color 7'));f.key('ArrowLeft');assert.equal(f.doc.activeElement,f.field('Native color 6'));f.key('ArrowUp');assert.equal(f.doc.activeElement,first);
    f.key('End');assert.equal(f.doc.activeElement,f.field('Clear clip color'));assert.equal(f.field('Clear clip color').className,'timeline-context-menu-item');assert.equal(grid.children.find(node=>node.attributes.role==='separator').className,'timeline-context-menu-separator');f.key('ArrowUp');assert.equal(f.doc.activeElement,f.field('Native color 6'));f.key('Home');assert.equal(f.doc.activeElement,first);
    f.key('ArrowRight');f.key('Enter');assert.equal(f.writes[0].id,'color:1');assert.equal(f.writes[0].menuClosed,true);
  }finally{f.dispose();}
});
