import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraw,recordingWaveformColumns} from '../js/timeline/draw.js';

test('live waveform uses the native maximum across bins and repeats bins when zoomed beyond 100 pixels per second',()=>{
  const peaks=new Float32Array([.1,.7,.2,.4,.3,1.2]);
  assert.deepEqual(recordingWaveformColumns(peaks,10,13,50,0,100),[[10,peaks[1]],[11,peaks[3]],[12,1]]);
  assert.deepEqual(recordingWaveformColumns(peaks,10,12,200,0,100),[[10,peaks[0]],[11,peaks[0]]]);
  assert.deepEqual(recordingWaveformColumns(peaks,10,10,100,0,100),[]);
  assert.deepEqual(recordingWaveformColumns(new Float32Array(),10,12,100,0,100),[]);
});

test('a scrolled recording retains its origin pixel grid and aggregates only the visible time window',()=>{
  const peaks=new Float32Array(30000);peaks[20002]=.9;peaks[0]=1;
  const visible=recordingWaveformColumns(peaks,-10000.25,5000,50,0,3);
  assert.deepEqual(visible,[[.75,peaks[20002]],[1.75,0],[2.75,0]]);
  const all=recordingWaveformColumns(new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8]),-1.25,3,200,-2,4);
  assert.deepEqual(recordingWaveformColumns(new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8]),-1.25,3,200,0,2),all.filter(([x])=>x>=0&&x<2));
  assert.equal(visible.length,3);
});

test('the timeline shows recording only for its captured revision and audio lanes, and removes it when cleared',t=>{
  const names=['document','getComputedStyle','devicePixelRatio','requestAnimationFrame','ResizeObserver'],previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const [name,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  const labels=[],frames=[],ctx=new Proxy({fillText:text=>labels.push(text)},{get:(target,key)=>target[key] ?? (()=>{})});
  globalThis.document={documentElement:{}};globalThis.getComputedStyle=()=>({getPropertyValue:()=> '#fff'});globalThis.devicePixelRatio=1;
  globalThis.requestAnimationFrame=callback=>frames.push(callback);globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  const timeline={id:'1',revision:'rev',fps:{num:24,den:1},markers:[],tracks:[{id:'video',kind:'video',clips:[]},{id:'audio',kind:'audio',clips:[]},{id:'other',kind:'audio',clips:[]}]};
  const recording={timeline_id:'1',revision:'rev',tracks:['video','audio'],start_frame:0,length_frames:24,seconds:1,peaks:new Float32Array(100).fill(.5)};
  const view={origin:0,scale:100,selection:[],playhead:0,retimeVisible:new Set(),recording};
  const draw=createDraw({clientWidth:450,clientHeight:240,getContext:()=>ctx},()=>timeline,view);
  const paint=()=>{labels.length=0;for(const callback of frames.splice(0))callback();return labels.filter(text=>text==='REC').length;};
  assert.equal(paint(),1);
  for(const patch of [{timeline_id:'2'},{revision:'old'},{seconds:0}]){view.recording={...recording,...patch};draw.invalidate();assert.equal(paint(),0);}
  view.recording=null;draw.invalidate();assert.equal(paint(),0);draw.destroy();
});
