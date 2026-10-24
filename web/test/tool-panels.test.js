import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolPanels} from '../js/tool-panels.js';

function fixture(){
  const document={createElement:tag=>new Node(tag)};
  class Node{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.ownerDocument=document;this.isConnected=true;this.open=false;}
    append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    insertBefore(node,before){node.remove();node.parentNode=this;this.children.splice(this.children.indexOf(before),0,node);}
    remove(){if(this.parentNode){const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
    replaceChildren(...nodes){for(const child of [...this.children])child.remove();this.append(...nodes);}
  }
  const window=()=>({opened:false,element:new Node(),content:new Node(),isOpen(){return this.opened;}}),mixer=window(),color=window(),state={hidden:false,fullscreen:false};
  const panels=createToolPanels({mixer,color,getState:()=>state});
  return {Node,mixer,color,state,panels};
}

test('independent Color docking retains the one grade card and drafts, restoring closed Inspector ancestors on close',()=>{
  const h=fixture(),outer=new h.Node('details'),filters=new h.Node('details'),card=new h.Node('details'),host=new h.Node(),input=new h.Node('input');
  input.value='.375';outer.append(filters);filters.append(card);card.append(input);let canceled=0;
  h.panels.setGrade(card,host,()=>canceled++);assert.equal(card.parentNode,filters);assert.equal(outer.open,false);
  h.mixer.opened=true;h.color.opened=true;assert.deepEqual(h.panels.sync(),{mixer:true,color:true});
  assert.equal(card.parentNode,host);assert.equal(card.open,true);assert.equal(outer.open,true);assert.equal(filters.open,true);assert.equal(host.children.length,1);
  h.color.opened=false;h.panels.sync();assert.equal(h.panels.visible('mixer'),true);assert.equal(card.parentNode,filters);assert.equal(input.value,'.375');assert.equal(card.open,false);assert.equal(outer.open,false);assert.equal(filters.open,false);assert.ok(canceled>0);
  h.color.opened=true;h.panels.sync();assert.equal(host.children[0],card);assert.equal(card.children[0],input);
  h.panels.clearGrade();assert.equal(card.parentNode,filters);assert.equal(host.children.length,0);assert.deepEqual(filters.children,[card]);
});

test('hidden and fullscreen tools cancel owned gestures once and resume existing Mixer visibility without duplication',()=>{
  const h=fixture(),node=new h.Node();let canceled=0,synced=0;node.cancelGestures=()=>canceled++;node.syncVisibility=()=>synced++;
  h.panels.setMixer(node);assert.equal(synced,0);h.mixer.opened=true;h.panels.sync();assert.equal(synced,1);
  h.state.fullscreen=true;assert.equal(h.panels.sync().mixer,false);assert.equal(canceled,1);h.panels.sync();assert.equal(canceled,1);
  h.state.fullscreen=false;h.panels.sync();assert.equal(synced,2);assert.deepEqual(h.mixer.content.children,[node]);
  h.state.hidden=true;h.panels.sync();assert.equal(canceled,2);h.state.hidden=false;h.panels.sync();assert.equal(synced,3);
  h.panels.clearMixer();assert.equal(canceled,3);assert.equal(h.mixer.content.children.length,0);
  const replacement=new h.Node();let fresh=0;replacement.syncVisibility=()=>fresh++;h.panels.setMixer(replacement);assert.equal(fresh,1);assert.deepEqual(h.mixer.content.children,[replacement]);
});

test('a rebuilt Color selection removes the old docking slot and never resurrects the old card on reopen',()=>{
  const h=fixture(),inspector=new h.Node('details'),old=new h.Node('details'),fresh=new h.Node('details'),host=new h.Node();inspector.append(old);h.color.opened=true;
  h.panels.setGrade(old,host,()=>{});h.panels.clearGrade();inspector.replaceChildren(fresh);h.panels.setGrade(fresh,host,()=>{});
  assert.deepEqual(host.children,[fresh]);h.color.opened=false;h.panels.sync();h.color.opened=true;h.panels.sync();assert.deepEqual(host.children,[fresh]);assert.equal(old.parentNode,null);
});
