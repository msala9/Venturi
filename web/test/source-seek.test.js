import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceSeek} from '../js/source-seek.js';

class Element extends EventTarget {
  value = ''; disabled = false; textContent = ''; validity = '';
  setCustomValidity(value) {this.validity = value;}
}
const emit = (element, type, properties = {}) => {
  const event = new Event(type, {cancelable: true});
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, {value});
  element.dispatchEvent(event);
  return event;
};
const flush = async () => {await Promise.resolve(); await Promise.resolve();};
function fixture() {
  const range = new Element(), frame = new Element(), seek = new Element(), status = new Element(), calls = [], errors = [];
  let media = {epoch:'project:1',id:'9007199254740993',content_hash:'18446744073709551615',duration_frames:1000,is_image:false};
  let position = {epoch:media.epoch,media_id:media.id,frame:10};
  const binder = createSourceSeek({range,frame,seek,status,getMedia:()=>media,getPosition:()=>position,onError:message=>errors.push(message),onSeek:value=>new Promise((resolve,reject)=>calls.push({frame:value,resolve,reject}))});
  return {range,frame,seek,status,calls,errors,binder,media:()=>media,setMedia:value=>media=value,setPosition:value=>position=value,position:()=>position};
}
function slide(f, value) {f.range.value=String(value); emit(f.range,'input');}
function number(f, value) {f.frame.value=String(value); emit(f.frame,'input');}

test('slider drafting stays local and commits once at release while verified clock updates remain separate',async()=>{
  const f=fixture();assert.equal(f.range.value,'10');assert.equal(f.range.max,'999');
  f.setPosition({...f.position(),frame:20});f.binder.sync();assert.equal(f.frame.value,'20');
  slide(f,300);f.setPosition({...f.position(),frame:21});f.binder.sync();assert.equal(f.range.value,'300');assert.equal(f.frame.value,'300');assert.equal(f.calls.length,0);
  emit(f.range,'change');assert.deepEqual(f.calls.map(call=>call.frame),[300]);emit(f.range,'change');assert.equal(f.calls.length,1);
  f.setPosition({...f.position(),frame:300});f.calls[0].resolve();await flush();assert.equal(f.range.value,'300');assert.doesNotMatch(f.status.textContent,/seeking/);f.binder.dispose();
});

test('number edits require Enter or the explicit button and repeated pending targets are suppressed',async()=>{
  const f=fixture();number(f,123);emit(f.frame,'change');assert.equal(f.calls.length,0);
  const enter=emit(f.frame,'keydown',{key:'Enter',repeat:false});assert.equal(enter.defaultPrevented,true);assert.equal(f.calls.length,1);
  emit(f.frame,'keydown',{key:'Enter',repeat:true});emit(f.seek,'click');assert.equal(f.calls.length,1);
  f.setPosition({...f.position(),frame:123});f.calls[0].resolve();await flush();number(f,124);emit(f.seek,'click');assert.equal(f.calls[1].frame,124);f.binder.dispose();f.calls[1].resolve();await flush();
});

test('Escape and pointer cancellation restore the verified position and ignore a trailing range change',()=>{
  const f=fixture();
  for(const cancel of [()=>emit(f.range,'keydown',{key:'Escape'}),()=>emit(f.range,'pointercancel'),()=>emit(f.frame,'keydown',{key:'Escape'})]){
    slide(f,700);cancel();assert.equal(f.range.value,'10');assert.equal(f.frame.value,'10');emit(f.range,'change');assert.equal(f.calls.length,0);
  }
  slide(f,701);emit(f.range,'change');assert.equal(f.calls.length,1);assert.equal(f.calls[0].frame,701);f.binder.dispose();f.calls[0].resolve();
});

test('invalid full-media frame values never dispatch and verified positions require exact string media identity',()=>{
  const f=fixture();
  for(const value of ['',-1,1.5,1000,'9007199254740993','not a frame']){
    number(f,value);emit(f.seek,'click');assert.equal(f.calls.length,0);assert.match(f.status.textContent,/integer inside/);
  }
  f.setPosition({epoch:f.media().epoch,media_id:9007199254740992,frame:44});f.binder.reset();f.binder.sync();assert.equal(f.range.value,'0');
  f.setPosition({epoch:f.media().epoch,media_id:f.media().id,frame:999});f.binder.sync();assert.equal(f.range.value,'999');assert.equal(f.calls.length,0);f.binder.dispose();
});

test('a draft cannot cross project, media or content-version changes',()=>{
  for(const patch of [{epoch:'project:2'},{id:'9007199254740995'},{content_hash:'18446744073709551614'}]){
    const f=fixture();slide(f,700);const next={...f.media(),...patch};f.setMedia(next);f.setPosition({epoch:next.epoch,media_id:next.id,frame:80});emit(f.range,'change');
    assert.equal(f.calls.length,0);assert.equal(f.range.value,'80');f.binder.dispose();
  }
});

test('old seek errors and completions cannot change a replacement media or a newer seek',async()=>{
  const f=fixture();slide(f,100);emit(f.range,'change');slide(f,200);emit(f.range,'change');
  f.setPosition({...f.position(),frame:200});f.calls[1].resolve();await flush();const latest=f.status.textContent;
  f.calls[0].reject(Error('obsolete seek failed'));await flush();assert.equal(f.status.textContent,latest);assert.equal(f.range.value,'200');assert.deepEqual(f.errors,[]);
  number(f,300);emit(f.seek,'click');const next={...f.media(),epoch:'project:2'};f.setMedia(next);f.setPosition({epoch:next.epoch,media_id:next.id,frame:40});f.binder.reset(40);const replacement=f.status.textContent;
  f.calls[2].reject(Error('old project failed'));await flush();assert.equal(f.status.textContent,replacement);assert.equal(f.range.value,'40');assert.deepEqual(f.errors,[]);f.binder.dispose();
});

test('preparation retains the requested absolute frame and a resolved unavailable seek remains retryable',async()=>{
  const f=fixture();slide(f,900);emit(f.range,'change');f.setPosition(null);f.binder.sync();assert.equal(f.frame.value,'900');assert.match(f.status.textContent,/seeking/);
  f.calls[0].resolve();await flush();assert.equal(f.frame.value,'900');assert.match(f.status.textContent,/position unavailable.*reopen/);f.binder.sync();assert.match(f.status.textContent,/position unavailable/);
  emit(f.seek,'click');assert.equal(f.calls.length,2);assert.equal(f.calls[1].frame,900);f.setPosition({epoch:f.media().epoch,media_id:f.media().id,frame:900});f.calls[1].resolve();await flush();assert.doesNotMatch(f.status.textContent,/unavailable|seeking/);f.binder.dispose();
});

test('missing or still media disable controls, reset binds a new opening and dispose removes every action',async()=>{
  const f=fixture();f.setMedia({...f.media(),is_image:true});f.binder.sync();assert.equal(f.range.disabled,true);assert.equal(f.frame.disabled,true);assert.equal(f.seek.disabled,true);emit(f.seek,'click');assert.equal(f.calls.length,0);
  f.setMedia(null);f.binder.sync();assert.equal(f.range.value,'0');
  f.setMedia({epoch:'new:1',id:'2',content_hash:'9',duration_frames:150,is_image:false});f.setPosition(null);f.binder.reset(120);f.binder.sync();assert.equal(f.range.value,'120');assert.equal(f.range.max,'149');assert.equal(f.seek.disabled,false);
  emit(f.seek,'click');assert.equal(f.calls[0].frame,120);f.binder.dispose();const status=f.status.textContent;f.calls[0].reject(Error('disposed seek'));await flush();
  number(f,100);emit(f.seek,'click');emit(f.range,'change');f.binder.sync();assert.equal(f.calls.length,1);assert.equal(f.status.textContent,status);assert.deepEqual(f.errors,[]);assert.equal(f.seek.disabled,true);
});
