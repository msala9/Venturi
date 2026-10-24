export function createToolPanels({mixer,color,getState}){
  let grade=null,mixerRoot=null,colorVisible=false,mixerVisible=false;
  const visible=name=>{
    const state=getState(),tool=name==='color'?color:mixer;
    return tool.isOpen() && !state.hidden && !state.fullscreen && tool.element.isConnected!==false;
  };
  function restoreGrade(){
    if(!grade?.docked)return;
    grade.cancel?.();
    if(grade.placeholder.parentNode)grade.placeholder.parentNode.insertBefore(grade.card,grade.placeholder);
    else grade.card.remove();
    grade.card.open=grade.open;for(const entry of grade.ancestors)entry.node.open=entry.open;grade.docked=false;
  }
  function clearGrade(){
    restoreGrade();grade?.placeholder.remove();grade=null;
  }
  function sync(){
    const nextColor=visible('color'),nextMixer=visible('mixer');
    if(colorVisible && !nextColor)grade?.cancel?.();
    if(mixerVisible && !nextMixer)mixerRoot?.cancelGestures?.();
    if(!mixerVisible && nextMixer)mixerRoot?.syncVisibility?.();
    colorVisible=nextColor;mixerVisible=nextMixer;
    if(grade){
      if(color.isOpen() && !grade.docked){for(const entry of grade.ancestors)entry.node.open=true;grade.card.open=true;grade.host.append(grade.card);grade.docked=true;}
      else if(!color.isOpen())restoreGrade();
    }
    return {color:nextColor,mixer:nextMixer};
  }
  return {
    visible,sync,clearGrade,
    setGrade(card,host,cancel){
      clearGrade();if(!card?.parentNode)return;
      const placeholder=card.ownerDocument.createElement('span');placeholder.hidden=true;card.parentNode.insertBefore(placeholder,card);
      const ancestors=[];for(let node=card.parentNode;node;node=node.parentNode)if(node.tagName==='DETAILS')ancestors.push({node,open:node.open});
      grade={card,host,cancel,placeholder,ancestors,open:card.open,docked:false};sync();
    },
    clearMixer(){mixerRoot?.cancelGestures?.();mixerRoot=null;mixer.content.replaceChildren();},
    setMixer(node){const wasVisible=mixerVisible;mixerRoot=node;node.dataset.mixerRoot='true';mixer.content.replaceChildren(node);sync();if(wasVisible && mixerVisible)node.syncVisibility?.();},
    cancelColor(){grade?.cancel?.();},
  };
}
