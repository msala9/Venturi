export function createProgramSeek({getContext,getFrame,isPlaying,pause,onSeek,onError}) {
  let draft=null,pending=null;
  function cancel() {
    const active=Boolean(draft || pending);
    draft=pending=null;
    if(active)pause();
    return active;
  }
  function begin() {
    const scope=getContext();
    if(!scope){cancel();return false;}
    if(draft?.scope===scope)return true;
    const resume=isPlaying();
    if(draft || pending)cancel();
    draft={scope,resume};pause();return true;
  }
  async function finish() {
    const owner=draft;draft=null;
    if(!owner || owner.scope!==getContext())return false;
    const frame=getFrame();
    if(!Number.isSafeInteger(frame) || frame<0)return false;
    pending=owner;
    try {
      const result=await onSeek(frame,{resume:owner.resume});
      return result!==false && pending===owner && owner.scope===getContext();
    } catch(error) {
      if(pending===owner && owner.scope===getContext())onError?.(error.message || String(error));
      return false;
    } finally {if(pending===owner)pending=null;}
  }
  return {begin,finish,cancel};
}
