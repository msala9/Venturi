import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaRelinkPanel} from '../js/media-relink.js';
import {createMediaImportPanel} from '../js/media-import.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=async()=>{for(let index=0;index<24;index++)await Promise.resolve();};
function harness(t,{importPanel=false}={}){
  const previous={document:globalThis.document,Option:globalThis.Option};
  class Node extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.attributes=new Map();this.disabled=false;this.value='';this.hidden=false;this.open=false;this.textContent='';}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
    setAttribute(key,value){this.attributes.set(key,String(value));}
    get isConnected(){return this===body || Boolean(this.parent?.isConnected);}
    get options(){return this.children;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
    focus(){globalThis.document.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;this.dispatchEvent(new Event('close'));}
    querySelector(){return close;}
  }
  const body=new Node('body'),dialog=new Node('dialog'),root=new Node('div'),status=new Node('p'),close=new Node('button');body.append(dialog);dialog.append(close,root,status);
  globalThis.document={body,activeElement:body,createElement:tag=>new Node(tag)};globalThis.Option=class extends Node{constructor(name,value){super('option');this.textContent=name;this.value=value;}};
  t.after(()=>{globalThis.document=previous.document;globalThis.Option=previous.Option;});
  const prepare=deferred(),calls=[],writes=[],applied=[],deletes=[];let valid=true,writable=true,context={project_epoch:'epoch',generation:'7',folders:[{id:'9',name:'Destination',parent:null}],media:[{id:'1',name:'old.wav'},{id:'2',name:'other.wav'}]};
  const api=async(path,body,options)=>{calls.push({path,body,options});if(options?.method==='DELETE'){deletes.push(path);return {};}
    if(path.startsWith('/media/sources?')){const directory=new URL(path,'http://fixture').searchParams.get('directory_token');return {project_epoch:'epoch',directory_token:directory,parent_token:directory?'':null,page:0,pages:1,entries:directory?[{kind:'media',name:'Renamed.wav',path_token:'Replacement/Renamed.wav'}]:[{kind:'directory',name:'Replacement',path_token:'Replacement'},{kind:'media',name:'Loose.wav',path_token:'Loose.wav'}]};}
    return prepare.promise;
  };
  const receipt=importPanel?{command_id:'command',project_epoch:'epoch',generation:'8',media_ids:['1'],folder_ids:[],errors:[],changed:true}:{command_id:'command',project_epoch:'epoch',generation:'8',relinked_media_ids:['1'],not_found:['2'],skipped:[],errors:[],ambiguous_count:1,changed:true};
  const options={dialog,root,status,getContext:()=>context,canCommit:()=>writable,api,commit:async operation=>{writes.push(operation);context={...context,generation:'8'};return receipt;},onRelinked:(ids,result)=>applied.push({ids,result}),onImported:(ids,result)=>applied.push({ids,result})};
  const panel=importPanel?createMediaImportPanel(options):createMediaRelinkPanel(options),walk=node=>[node,...node.children.flatMap(walk)],button=text=>{const node=walk(root).find(node=>node.tagName==='BUTTON' && node.textContent===text);assert.ok(node,text);return node;};
  const ready=(result)=>({id:'job',project_epoch:'epoch',generation:'7',kind:importPanel?'project_import':'project_relink',state:'ready',progress:{completed:importPanel?1:2,total:importPanel?1:2},result});
  return {panel,dialog,root,status,prepare,calls,writes,applied,deletes,receipt,button,walk,ready,setValid:value=>valid=value,current:()=>valid,setWritable:value=>writable=value};
}

test('selected-media Relink uses an approved folder and native counts with one prepared command and an ID-first completion callback',async t=>{
  const h=harness(t);await h.panel.open({kind:'selected',media_ids:['1','2']},h.current);await settle();h.button('Open folder Replacement').click();await settle();h.button('Search this folder and subfolders').click();await settle();
  const request=h.calls.find(call=>call.path==='/media/relinks/prepare');assert.deepEqual(request.body,{project_epoch:'epoch',if_generation:'7',action:{kind:'by_name',directory_token:'Replacement',scope:{kind:'selected',media_ids:['1','2']}}});assert.deepEqual(h.writes,[]);
  h.prepare.resolve(h.ready({mode:'by_name',directory_token:'Replacement',items:[{media_id:'1',name:'old.wav',path_token:'Replacement/Renamed.wav',state:'ready'}],errors:[],not_found:['2'],skipped:[],ambiguous_count:1}));await settle();assert.deepEqual(h.writes,[{kind:'relink_prepared_media',job_id:'job'}]);assert.deepEqual(h.applied,[{ids:['1'],result:h.receipt}]);assert.ok(h.walk(h.root).some(node=>node.textContent.includes('1 ambiguous')));
  const title=h.walk(h.root).find(node=>node.tagName==='SUMMARY' && node.textContent.startsWith('Relink results'));title.parent.open=true;
  await h.panel.open({kind:'selected',media_ids:['2']},h.current);await settle();assert.equal(title.textContent,'Relink results');assert.equal(title.parent.open,false);assert.equal(title.parent.children[1].children.length,0);assert.equal(h.writes.length,1);h.panel.hide();
});

test('explicit replacement chooses a nested file without matching its name and waits for Apply before preparing',async t=>{
  const h=harness(t);await h.panel.open({kind:'selected',media_ids:['1']},h.current);await settle();h.button('Choose replacement for old.wav').click();await settle();assert.equal(h.button('Choose this source folder').hidden,true);
  h.button('Open folder Replacement').click();await settle();h.button('Select source file Renamed.wav').click();h.button('Use replacement for old.wav').click();await settle();assert.equal(h.calls.some(call=>call.path==='/media/relinks/prepare'),false);assert.deepEqual(h.writes,[]);
  h.button('Apply chosen replacements').click();await settle();assert.deepEqual(h.calls.at(-1).body.action,{kind:'chosen',items:[{media_id:'1',path_token:'Replacement/Renamed.wav'}]});
  h.receipt.not_found=[];h.receipt.ambiguous_count=0;h.prepare.resolve({...h.ready({mode:'chosen',directory_token:null,items:[{media_id:'1',name:'old.wav',path_token:'Replacement/Renamed.wav',state:'ready'}],errors:[],not_found:[],skipped:[],ambiguous_count:0}),progress:{completed:1,total:1}});await settle();assert.equal(h.writes.length,1);h.panel.hide();
});

test('closing Relink while native preparation is pending cancels only the late exact job and never applies',async t=>{
  const h=harness(t);await h.panel.open({kind:'folder',folder_id:'9'},h.current);await settle();h.button('Open folder Replacement').click();await settle();h.button('Search this folder and subfolders').click();await settle();h.dialog.close();
  h.prepare.resolve(h.ready({mode:'by_name',directory_token:'Replacement',items:[{media_id:'1',name:'old.wav',path_token:'Replacement/Renamed.wav',state:'ready'}],errors:[],not_found:['2'],skipped:[],ambiguous_count:0}));await settle();assert.deepEqual(h.writes,[]);assert.deepEqual(h.applied,[]);assert.deepEqual(h.deletes,['/media/jobs/job?project_epoch=epoch']);h.panel.hide();
});

test('project import panel uses nested approved file choices and its captured native destination folder',async t=>{
  const h=harness(t,{importPanel:true});await h.panel.open({parent:'9'});h.button('Open folder Replacement').click();await settle();h.button('Select source file Renamed.wav').click();h.button('Import selected files').click();await settle();
  const request=h.calls.find(call=>call.path==='/media/project-imports/prepare');assert.deepEqual(request.body,{project_epoch:'epoch',if_generation:'7',path_tokens:['Replacement/Renamed.wav'],parent:'9'});
  h.prepare.resolve(h.ready({mode:'files',parent:'9',directory_token:null,folders:[],items:[{path_token:'Replacement/Renamed.wav',name:'Renamed.wav',state:'ready',folder_index:null}],errors:[]}));await settle();assert.deepEqual(h.writes,[{kind:'import_prepared_project_media',job_id:'job'}]);assert.deepEqual(h.applied[0].ids,['1']);h.panel.hide();
});
