export const attributeGroups=[['zoom','Zoom'],['position','Position'],['rotation','Rotation'],['anchor_point','Anchor point'],['flip','Flip'],['crop','Crop edges'],['crop_softness','Crop softness'],['blend_mode','Blend mode'],['matte','Matte'],['opacity','Opacity'],['filters','Filters / color corrections'],['masks','Masks'],['transitions','Edge transitions'],['volume','Audio volume'],['fades','Fades'],['speed','Speed / pitch correction · Ripple']];

export function attributesIdentity(context){return context?JSON.stringify([context.epoch,context.generation,context.timeline,context.revision,context.clipboard,[...context.clip_ids].sort()]):null;}
export function attributesOperation(context,attributes,keyframes){return {kind:'paste_attributes',clip_ids:[...context.clip_ids],clipboard_revision:context.clipboard,attributes,keyframes};}

export function createPasteAttributes({root,getContext,canCommit,commit,notice}){
  const form=root.querySelector('form'),groups=root.querySelector('[data-attribute-groups]'),status=root.querySelector('[data-attribute-status]'),apply=root.querySelector('[data-attribute-apply]'),close=root.querySelector('[data-attribute-close]'),mode=root.querySelector('[name="keyframes"]');
  let bound=null,busy=false;
  const checks=attributeGroups.map(([value,title])=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=value;label.append(input,document.createTextNode(title));groups.append(label);return input;});
  const chosen=()=>checks.filter(input=>input.checked).map(input=>input.value);
  function controls(){const valid=bound && attributesIdentity(bound)===attributesIdentity(getContext()) && canCommit();apply.disabled=busy || !valid || !chosen().length;for(const input of [...checks,mode])input.disabled=busy || !valid;close.disabled=busy;}
  form.addEventListener('change',controls);
  form.addEventListener('submit',async event=>{event.preventDefault();if(apply.disabled || busy || !canCommit() || attributesIdentity(bound)!==attributesIdentity(getContext()))return;busy=true;controls();status.textContent='Applying native properties…';try{await commit(attributesOperation(bound,chosen(),mode.value));root.close();}catch(error){status.textContent=`${error.message} · choices retained`;notice(status.textContent);}finally{busy=false;controls();}});
  close.addEventListener('click',()=>{if(!busy)root.close();});root.addEventListener('cancel',event=>{event.preventDefault();if(!busy)root.close();});
  return {open(){const context=getContext();if(!context?.clipboard || !context.clip_ids.length){notice('Copy source clips, then select destination clips');return;}bound={...context,clip_ids:[...context.clip_ids]};root.showModal();status.textContent=`${context.clip_ids.length} selected clip(s), including linked targets. First copied source of each track kind is used. Copied source clips are skipped.`;controls();},invalidate(){if(!root.open || busy)return;if(attributesIdentity(bound)!==attributesIdentity(getContext()))status.textContent='Timeline, selection or copied properties changed · close and reopen before applying';controls();}};
}
