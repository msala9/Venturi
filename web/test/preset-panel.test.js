import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presetMutationResult} from '../js/presets.js';

test('an acknowledged preset save remains successful when the follow-up read fails',async()=>{
  const receipt={command_id:'saved-preset',receipt_persisted:true};
  const failure=Error('Connection lost while reading the new preset');
  let submissions=0;
  const result=await presetMutationResult(async()=>{submissions++;return receipt;},async acknowledged=>{
    assert.equal(acknowledged,receipt);
    throw failure;
  });
  assert.equal(submissions,1);
  assert.equal(result.receipt,receipt);
  assert.equal(result.refreshError,failure);
});

test('a rejected preset mutation does not read or report a saved result',async()=>{
  const rejected=Error('Preset revision changed');
  let reads=0;
  await assert.rejects(()=>presetMutationResult(async()=>{throw rejected;},async()=>{reads++;}),error=>error===rejected);
  assert.equal(reads,0);
});

test('a successful preset refresh returns the original durable receipt',async()=>{
  const receipt={command_id:'imported-preset'};
  let reads=0;
  const result=await presetMutationResult(async()=>receipt,async acknowledged=>{
    assert.equal(acknowledged,receipt);
    reads++;
  });
  assert.equal(reads,1);
  assert.deepEqual(result,{receipt,refreshError:null});
});
