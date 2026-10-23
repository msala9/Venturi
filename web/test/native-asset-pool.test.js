import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePoolItem,nativePoolInfo,nativePoolQuery,NATIVE_POOL_DRAG_TYPE} from '../js/native-asset-pool.js';
import {CATALOG_DRAG_TYPE} from '../js/catalog-interactions.js';
import {mediaRowInfo} from '../js/catalog.js';

test('native pool adapter preserves UUID identity and authoritative first-root metadata without making a project media path',()=>{
  const asset={id:'native-asset-uuid',name:'Still',effective_folder:'folder-id',missing_count:1,presentation:{kind:'image',width:1920,height:1080,fps:{num:24,den:1},duration_frames:1_000_000_000,is_image:true,has_video:true,has_audio:false,sample_rate:0,channels:0,audio_streams:0}},item=nativePoolItem(asset);
  assert.equal(item.id,asset.id);assert.equal(item.folder,'folder-id');assert.equal(item.offline,true);assert.equal(mediaRowInfo(item).duration,'Still');assert.equal(Object.hasOwn(item,'path_token'),false);assert.equal(Object.hasOwn(item,'thumbnailURL'),false);
  assert.equal(mediaRowInfo(nativePoolItem({...asset,presentation:{...asset.presentation,kind:'timeline',is_image:false}})).glyph,'▤');assert.notEqual(NATIVE_POOL_DRAG_TYPE,CATALOG_DRAG_TYPE);
  const generic=nativePoolInfo({id:'unknown',name:'Unknown',media_count:1,file_count:1,presentation:{kind:'media',has_video:false,has_audio:false}});assert.equal(generic.glyph,'◇');assert.doesNotMatch(generic.metadata,/Audio/);
});

test('native pool queries use server sort and direct Grid folders while search in Grid stays global',()=>{
  assert.deepEqual(nativePoolQuery(),{sort:'name',descending:'false'});assert.deepEqual(nativePoolQuery({sort:'duration',descending:true}),{sort:'duration',descending:'true'});
  assert.deepEqual(nativePoolQuery({layout:'grid'}),{sort:'name',descending:'false',folder:''});assert.deepEqual(nativePoolQuery({layout:'grid',folder:'shots'}),{sort:'name',descending:'false',folder:'shots'});
  assert.deepEqual(nativePoolQuery({layout:'grid',folder:'shots',query:'River'}),{sort:'name',descending:'false'});assert.deepEqual(nativePoolQuery({folder:'shots'}),{sort:'name',descending:'false',folder:'shots'});
});
