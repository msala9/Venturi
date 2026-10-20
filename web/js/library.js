import {request} from "./api.js";

export function libraryDocument(state) {
  return state?.project_name ? JSON.stringify([state.project_epoch,state.generation]) : null;
}
function size(bytes) {return bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(1)} MiB`;}
export function libraryMatches(item,query,kind) {
  const text=[item.id,item.model,item.prompt,item.tool,item.seed || ""].join(" ").toLowerCase();
  return (kind==="all" || item.kind===kind) && text.includes(query.toLowerCase());
}
export function sharedItemId(media) {
  return media?.shared_origin?.item?.id || /^ds4-([a-f0-9]{16})-[a-f0-9]{16}\.(?:png|jpg|webp|mp4|webm|mp3|wav)$/.exec(media?.name || "")?.[1] || null;
}
export function missingSharedUses(state,id) {
  return (state?.media || []).filter((media)=>media.offline && sharedItemId(media)===id).map((media)=>media.id);
}
export function createLibraryPanel({root,getState,canCommit,commit,notice,api=request,fetcher=fetch}) {
  let sequence=0,controller=null,jobPath=null;
  const button=(label,action)=>{const node=document.createElement("button");node.type="button";node.textContent=label;node.addEventListener("click",action);return node;};
  async function cancel() {
    sequence++;controller?.abort();controller=null;
    const path=jobPath;jobPath=null;
    if(path)await fetcher(`/api/v1${path}`,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
  async function open() {
    await cancel();const seq=sequence;
    root.replaceChildren();
    const title=document.createElement("h3");title.textContent="Shared media library";
    const status=document.createElement("p");status.setAttribute("role","status");status.textContent="Reading ds4-appliance catalog…";
    const refresh=button("Refresh shared library",open),stop=button("Cancel library transfer",async()=>{stop.disabled=true;await cancel();await open();notice("Library transfer cancellation requested; project edits are unchanged");});stop.disabled=true;
    const query=document.createElement("input");query.type="search";query.setAttribute("aria-label","Search shared library");query.placeholder="Prompt, model, seed or ID";
    const kind=document.createElement("select");kind.setAttribute("aria-label","Shared library type");for(const [value,label] of [["all","All shared media"],["video","Video"],["image","Images"],["audio","Audio"]])kind.append(new Option(label,value));
    const list=document.createElement("div");list.className="shared-library-list";
    root.append(title,status,refresh,stop,query,kind,list);
    try {
      const catalog=await api("/library");if(seq!==sequence || !root.isConnected)return;
      if(!catalog.configured){status.textContent="Shared library is not configured on this server";return;}
      const archive=catalog.archive;
      const summary=`${catalog.items.length} shared assets · archive ${archive.reachable?"reachable":archive.configured?"offline":"not configured"} · SSD retention ${archive.retention_days} days`;
      status.textContent=summary;
      const render=()=>{
        list.replaceChildren();let shown=0;
        for(const item of catalog.items) {
          if(!libraryMatches(item,query.value,kind.value))continue;
          shown++;if(shown>100)continue;
          const card=document.createElement("article"),heading=document.createElement("strong"),info=document.createElement("p"),prompt=document.createElement("p");
          heading.textContent=`${item.kind} · ${item.model}`;info.textContent=`${item.id} · ${size(item.bytes)} · ${item.archived?"Archive":"SSD"}${item.keep?" · pinned":""}${item.seed?` · seed ${item.seed}`:""}`;prompt.textContent=item.prompt || "No prompt metadata";
          const insert=button("Import project copy",()=>transfer(item,insert));insert.disabled=!canCommit() || !libraryDocument(getState());
          card.append(heading,info,prompt,insert);list.append(card);
          const missing=missingSharedUses(getState(),item.id);
          if(missing.length){const relink=button(`Relink ${missing.length} missing project uses`,()=>transfer(item,relink,missing));relink.disabled=!canCommit() || missing.length>64;card.append(relink);}
        }
        const count=document.createElement("p");count.textContent=shown?`${Math.min(shown,100)} of ${shown} matches shown; narrow the search for more`:"No shared assets match this filter";list.prepend(count);
      };
      query.addEventListener("input",render);kind.addEventListener("change",render);render();
      async function transfer(item,insert,relinkIds=null) {
        if(controller || !canCommit())return;
        const documentKey=libraryDocument(getState()),epoch=getState()?.project_epoch;if(!documentKey)return;
        insert.disabled=true;refresh.disabled=true;stop.disabled=false;query.disabled=true;kind.disabled=true;for(const control of list.querySelectorAll("button"))control.disabled=true;controller=new AbortController();const signal=controller.signal;
        try {
          let job=await api(`/library/items/${encodeURIComponent(item.id)}/prepare`,{project_epoch:epoch});
          const path=`/library/jobs/${encodeURIComponent(job.id)}?${new URLSearchParams({project_epoch:epoch})}`;
          if(seq!==sequence){await fetcher(`/api/v1${path}`,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});return;}
          jobPath=path;
          while(["queued","running"].includes(job.state)) {
            status.textContent=`${item.id} · ${job.state} · ${size(job.bytes)} / ${size(job.total_bytes)}`;
            await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException("Canceled","AbortError"));};const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},300);signal.addEventListener("abort",abort,{once:true});});
            job=await api(path);if(seq!==sequence)return;
          }
          if(job.state!=="ready")throw new Error(job.error || `Library transfer ${job.state}`);
          if(libraryDocument(getState())!==documentKey || !canCommit())throw new Error("Project changed during transfer. The prepared project copy is preserved; import it from the server media picker when ready.");
          await commit(relinkIds?{kind:"edit_catalog",edit:{kind:"relink",items:relinkIds.map((media_id)=>({media_id,path_token:job.result.path_token}))}}:{kind:"import_media",path_token:job.result.path_token});
          status.textContent=`${relinkIds?"Relinked":"Imported"} ${item.id} · native project media · original shared asset preserved`;notice(status.textContent);
        }catch(error){if(seq===sequence && error.name!=="AbortError"){status.textContent=error.message;notice(error.message);}}
        finally{if(seq===sequence){controller=null;jobPath=null;stop.disabled=true;refresh.disabled=false;query.disabled=false;kind.disabled=false;render();}}
      }
    }catch(error){if(seq===sequence)status.textContent=error.message;}
  }
  return {open,cancel};
}
