import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderRetime} from '../js/inspector.js';

function harness(){
  const previousDocument=globalThis.document,previousOption=globalThis.Option,commands=[];
  class Node {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.handlers=new Map();this.isConnected=true;}
    append(...nodes){this.children.push(...nodes);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(type,handler){this.handlers.set(type,handler);}
    emit(type){this.handlers.get(type)?.({preventDefault(){}});}
    reportValidity(){return true;}
    focus(){document.activeElement=this;}
  }
  globalThis.document={createElement:tag=>new Node(tag),activeElement:null};globalThis.Option=function(text,value){const node=new Node('option');node.textContent=text;node.value=value;return node;};
  const root=new Node('div'),state=new Map([['retime',true],['retime-focus','clip']]);
  const detail={clip_id:'clip',display_colors:['Blue'],display_color:null,retime:{speed_percent:125.375,pitch_correction:true,freeze_source_frame:null}};
  let current=true;
  const render=(disabled=false)=>renderRetime(root,detail,disabled,()=>75,operation=>commands.push(operation),state,()=>current);
  const all=()=>{const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.children)visit(child);};visit(root);return nodes;};
  return {root,state,detail,commands,render,all,setCurrent:value=>{current=value;},restore(){for(const node of all())node.isConnected=false;globalThis.document=previousDocument;globalThis.Option=previousOption;}};
}

test('advanced speed opens with native Ripple, exact primary speed and pitch without applying edits',async()=>{
  const h=harness();try{
    h.render();await Promise.resolve();
    const percent=h.all().find(node=>node.tagName==='input' && node.type==='number'),fit=h.all().find(node=>node['aria-label']==='Speed duration policy');
    assert.equal(percent.value,125.375);assert.equal(fit.value,'ripple');assert.equal(h.commands.length,0);assert.equal(document.activeElement,percent);assert.equal(h.state.has('retime-focus'),false);
    percent.value=50;h.all().find(node=>node.tagName==='form').emit('submit');
    assert.deepEqual(h.commands,[{kind:'set_speed',clip_ids:['clip'],percent:50,pitch_correction:true,fit:'ripple'}]);
  }finally{h.restore();}
});

test('removed or disabled speed controls cannot edit a replacement clip or session',()=>{
  for(const disabled of [false,true]){
    const h=harness();try{
      h.render(disabled);h.setCurrent(false);h.all().find(node=>node.tagName==='form').emit('submit');
      for(const node of h.all().filter(node=>node.tagName==='button'))node.emit('click');assert.equal(h.commands.length,0);
    }finally{h.restore();}
  }
});
