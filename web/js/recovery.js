import {request} from './api.js';
export function recoveryName(token){return `${String(token || 'Project').replace(/\.vvproj$/i,'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,54)}_recovered`;}
export function recoveryOperation(info,values){
  if(!info?.pending || !/^[a-f0-9]{64}$/.test(info.revision || ''))throw Error('Refresh the available recovery snapshot first');
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(values.name || '') || typeof values.open!=='boolean')throw Error('Choose a valid new project name and recovery option');
  return {kind:'recover_autosave',revision:info.revision,name:values.name,open:values.open};
}
export function createRecoveryPanel({root,status,button,canCommit,commit,openProjects,onOpened,notice,api=request}){
  const form=root.querySelector('form'),name=root.querySelector('[name="recovery_name"]'),open=root.querySelector('[name="open_recovery"]'),apply=root.querySelector('[data-recovery-apply]'),detail=root.querySelector('[data-recovery-detail]'),refresh=root.querySelector('[data-recovery-refresh]');
  let info=null,busy=false,loading=false,sequence=0,bound=null,failure=null;
  function controls(){const available=info?.pending && /^[a-f0-9]{64}$/.test(info.revision || '');apply.disabled=busy || !canCommit() || !available;name.disabled=open.disabled=busy || !available;refresh.disabled=busy;button.disabled=busy;}
  function update(next){info=next || {state:'empty',pending:false};button.hidden=!info.pending && info.state!=='blocked';root.hidden=!info.pending && info.state!=='blocked';
    const time=info.created_unix_ms?new Date(info.created_unix_ms).toLocaleString():'';
    const text=info.state==='blocked'?`Recovery unavailable · ${info.error || 'Existing snapshot was preserved'}`:info.pending?`Unsaved recovery available · ${info.project_token} · ${time}. Keep a recovery copy to enable new snapshots.`:info.state==='ready'?`Recovery snapshot saved · ${time}`:info.state==='saved'?'Recovery snapshot protected by a saved project':'';
    status.textContent=text;status.title=text;detail.textContent=failure || (info.pending?`${text}${info.base_changed?' The saved file changed since this snapshot.':''}`:text);
    if(bound!==info.project_token){if(!name.value || name.value===recoveryName(bound))name.value=recoveryName(info.project_token);bound=info.project_token;}controls();
  }
  async function load(){if(busy || loading)return;loading=true;const seq=++sequence;try{const result=await api('/recovery');if(seq===sequence && !busy)update(result);}catch(error){if(seq===sequence){status.textContent=`Recovery status unavailable · ${error.message}`;}}finally{loading=false;}}
  form.addEventListener('submit',async event=>{event.preventDefault();if(apply.disabled || !canCommit() || busy || !form.reportValidity())return;let operation;try{operation=recoveryOperation(info,{name:name.value,open:open.checked});}catch(error){detail.textContent=error.message;return;}
    sequence++;busy=true;failure=null;controls();detail.textContent='Saving a new recovery project…';try{await commit(operation);notice(`Recovery copy saved as ${operation.name}.vvproj`);if(operation.open)onOpened();else openProjects();}catch(error){failure=`${error.message} · recovery choices retained`;detail.textContent=failure;notice(failure);}finally{busy=false;controls();load();}});
  refresh.addEventListener('click',()=>{failure=null;load();});button.addEventListener('click',openProjects);
  return {update,refresh:load,invalidate:controls};
}
