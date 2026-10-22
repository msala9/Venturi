import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSampleAtFrame,sourceAudioQuery} from '../js/source-clock.js';

test('Source sample positions round native rational frame boundaries without changing the segment origin',()=>{
  assert.equal(sourceSampleAtFrame(589,{num:1,den:1}),28_272_000);
  assert.equal(sourceSampleAtFrame(1,{num:30_000,den:1001}),1602);
  assert.equal(sourceSampleAtFrame(2,{num:30_000,den:1001}),3203);
  const boundary=1798,rate={num:30_000,den:1001};
  assert.equal(sourceSampleAtFrame(boundary,rate),2_879_677);
  assert.equal(sourceSampleAtFrame(1,{num:96_000,den:1}),1);
  assert.equal(sourceSampleAtFrame(0,rate),0);
});

test('Source audio positions reject malformed and unsafe clocks before requesting native audio',()=>{
  for(const frame of [-1,0.5,NaN,Infinity,'1'])assert.throws(()=>sourceSampleAtFrame(frame,{num:24,den:1}));
  for(const fps of [null,{num:0,den:1},{num:24,den:0},{num:1.5,den:1},{num:24,den:2_147_483_648}])assert.throws(()=>sourceSampleAtFrame(1,fps));
  assert.throws(()=>sourceSampleAtFrame(Number.MAX_SAFE_INTEGER,{num:1,den:1}),/safe range/);
});

test('native Source audio identity is forwarded unchanged to scrub and fast audio requests',()=>{
  assert.deepEqual(sourceAudioQuery({audio_mode:'all',audio_stream_index:null}),{audio_mode:'all',audio_stream_index:0});
  assert.deepEqual(sourceAudioQuery({audio_mode:'selected',audio_stream_index:1}),{audio_mode:'selected',audio_stream_index:1});
  assert.deepEqual(sourceAudioQuery({audio_stream_index:0}),{audio_mode:'selected',audio_stream_index:0});
  for(const position of [null,{audio_mode:'all',audio_stream_index:0},{audio_mode:'all'},{audio_mode:'selected',audio_stream_index:null},{audio_mode:'unknown',audio_stream_index:0},{audio_mode:null,audio_stream_index:0},{audio_stream_index:-1},{audio_stream_index:'1'}])assert.throws(()=>sourceAudioQuery(position),/not verified/);
});
