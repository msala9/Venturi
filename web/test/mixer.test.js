import test from "node:test";
import assert from "node:assert/strict";
import { effectName,chainOperation } from "../js/mixer.js";
test("audio insert names and ordered native values pass through without browser DSP",()=>{
  const mono={enabled:true,kind:"Mono"},eq={enabled:false,kind:{Equalizer:{bands:[{freq_hz:120,gain_db:-3,q:0.7}]}}};
  assert.equal(effectName(mono),"Mono");assert.equal(effectName(eq),"Equalizer");
  const command=chainOperation("master",[eq,mono]);assert.equal(command.effects[0],eq);assert.equal(command.effects[1],mono);assert.equal(command.channel,"master");assert.equal(command.kind,"set_audio_effects");
});
