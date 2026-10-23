import test from 'node:test';
import assert from 'node:assert/strict';
import {createFontCatalogReader,validateFontCatalog,fontFamilyChoices,fontFaceChoices,selectableFontFamily} from '../js/fonts.js';

const catalog=()=>({families:[{family:'',name:'Sans-serif',faces:[]},{family:'Native Serif',name:'Native Serif',faces:[{weight:400,italic:false,name:'Regular'},{weight:400,italic:true,name:'Italic'},{weight:1000,italic:false,name:'Black'}]}]});

test('font reader shares one validated immutable read while aborting only its own consumer',async()=>{
  let resolve,calls=0;const read=createFontCatalogReader(()=>{calls++;return new Promise(done=>{resolve=done;});}),a=new AbortController(),b=new AbortController();
  const first=read({signal:a.signal}),second=read({signal:b.signal}),canceled=assert.rejects(first,{name:'AbortError'});a.abort();await canceled;assert.equal(calls,1);
  resolve(catalog());const value=await second;assert.equal(await read(),value);assert.equal(calls,1);assert.equal(Object.isFrozen(value.families[1].faces[0]),true);
  assert.throws(()=>value.families.push({}));assert.equal(b.signal.aborted,false);
});

test('failed or malformed font reads require an explicit new call and never poison the successful cache',async()=>{
  for(const malformed of [false,true]){
    let calls=0;const read=createFontCatalogReader(()=>{calls++;if(calls===1){if(malformed)return {families:[]};throw Error('Fonts unavailable');}return catalog();});
    await assert.rejects(read());assert.equal(calls,1);const value=await read();assert.equal(calls,2);assert.equal(await read(),value);assert.equal(calls,2);
  }
  let calls=0;const read=createFontCatalogReader(()=>{calls++;return catalog();}),controller=new AbortController();controller.abort();await assert.rejects(read({signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});

test('font choices retain unknown saved values and unsupported long families without selecting an invented replacement',()=>{
  const data=catalog(),long='é'.repeat(65);data.families.push({family:long,name:long,faces:[]});const checked=validateFontCatalog(data);
  const unknown=fontFamilyChoices(checked,'Missing family');assert.equal(unknown.at(-1).value,'Missing family');assert.equal(unknown.at(-1).disabled,true);assert.match(unknown.at(-1).label,/not installed/);
  assert.equal(fontFamilyChoices(checked,long).find(choice=>choice.value===long).disabled,true);assert.equal(selectableFontFamily('é'.repeat(64)),true);assert.equal(selectableFontFamily(long),false);assert.equal(selectableFontFamily('bad\nfont'),false);
  const installed=fontFaceChoices(checked,'Native Serif',{weight:1000,italic:false});assert.equal(installed.find(choice=>choice.value==='1000:0').disabled,false);
  const fallback=fontFaceChoices(checked,'Missing family',{weight:650,italic:true});assert.deepEqual(fallback.slice(0,4).map(choice=>[choice.face.weight,choice.face.italic]),[[400,false],[700,false],[400,true],[700,true]]);assert.equal(fallback.at(-1).value,'650:1');assert.equal(fallback.at(-1).disabled,true);
});

test('catalog validation refuses ambiguous families/styles and malformed native metadata',()=>{
  const duplicate=catalog();duplicate.families.push(duplicate.families[1]);assert.throws(()=>validateFontCatalog(duplicate));
  const styles=catalog();styles.families[1].faces.push(styles.families[1].faces[0]);assert.throws(()=>validateFontCatalog(styles));
  const bad=catalog();bad.families[1].faces[0].italic='false';assert.throws(()=>validateFontCatalog(bad));assert.throws(()=>validateFontCatalog({families:[catalog().families[1]]}));
});
