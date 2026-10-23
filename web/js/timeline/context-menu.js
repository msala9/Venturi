export function createTimelineContextMenu({getContext,getItems,onAction,notice=()=>{},document:doc=globalThis.document}){
  const win=doc?.defaultView ?? globalThis.window,listeners=[];let owner=null,disposed=false;
  const listen=(node,type,callback,options)=>{node?.addEventListener?.(type,callback,options);listeners.push(()=>node?.removeEventListener?.(type,callback,options));};
  const create=(tag,className)=>{const node=doc.createElement(tag);if(className)node.className=className;return node;};
  const property=(node,key,value)=>node.style?.setProperty?.(key,value);
  const swatch=value=>Array.isArray(value) && value.length===3 && value.every(channel=>Number.isInteger(channel) && channel>=0 && channel<=255);
  function read(target){try{const context=getContext(target);return context && typeof context.identity==='string' && context.identity?context:null;}catch{return null;}}
  const current=bound=>!disposed && owner===bound && !doc.hidden && read(bound.target)?.identity===bound.context.identity;
  function restore(bound){if(!disposed && !doc.hidden && bound.target.returnFocus?.isConnected!==false && read(bound.target)?.identity===bound.context.identity)bound.target.returnFocus?.focus?.();}
  function close(restoreFocus=true){const bound=owner;if(!bound)return;owner=null;for(const menu of bound.menus)menu.removeListeners();try{bound.layer.hidePopover?.();}catch{}bound.layer.remove?.();if(bound.layer.parentNode)bound.layer.parentNode.removeChild?.(bound.layer);if(restoreFocus)restore(bound);}
  function invalidate(){if(owner && !current(owner))close(false);}
  function size(){return {width:win?.innerWidth ?? doc.documentElement?.clientWidth ?? 1024,height:win?.innerHeight ?? doc.documentElement?.clientHeight ?? 768};}
  function position(menu){
    const viewport=size(),rect=menu.element.getBoundingClientRect?.() ?? {width:220,height:200},width=Math.min(rect.width || 220,viewport.width-16),height=Math.min(rect.height || 200,viewport.height-16);
    let x=menu.point[0],y=menu.point[1];
    if(menu.parent){const anchor=menu.parent.button.getBoundingClientRect?.();if(anchor){x=anchor.right ?? anchor.left+anchor.width;y=anchor.top;if(x+width>viewport.width-8)x=anchor.left-width;}}
    property(menu.element,'left',`${Math.max(8,Math.min(x,viewport.width-width-8))}px`);property(menu.element,'top',`${Math.max(8,Math.min(y,viewport.height-height-8))}px`);property(menu.element,'max-height',`${Math.max(28,viewport.height-16)}px`);property(menu.element,'max-width',`${Math.max(80,viewport.width-16)}px`);
  }
  function closeChildren(bound,depth){while(bound.menus.length>depth+1){const menu=bound.menus.pop();menu.parent?.button.setAttribute('aria-expanded','false');menu.removeListeners();menu.element.remove?.();if(menu.element.parentNode)menu.element.parentNode.removeChild?.(menu.element);}}
  function focus(menu,index){const enabled=menu.rows.filter(row=>row.enabled);if(!enabled.length){menu.element.focus?.();return;}const row=enabled[(index+enabled.length)%enabled.length];menu.index=menu.rows.indexOf(row);row.button.focus?.();}
  function focused(menu){return menu.rows.find(row=>row.button===doc.activeElement) ?? menu.rows[menu.index] ?? menu.rows.find(row=>row.enabled);}
  function freshItem(bound,path){let items=getItems(read(bound.target));let item;for(const id of path){if(!Array.isArray(items))return null;item=items.find(candidate=>candidate?.id===id && !candidate.separator);if(!item || item.enabled===false)return null;items=item.children;}return item;}
  function activate(bound,menu,row){
    if(!current(bound)){close(false);return;}let item;try{item=freshItem(bound,row.path);}catch(error){close(false);notice(error.message);return;}if(!row.enabled || !item)return;
    if(row.children?.length){openChildren(bound,menu,row);return;}if(bound.dispatched)return;bound.dispatched=true;
    const context=structuredClone(bound.context);close(false);if(disposed || doc.hidden || read(bound.target)?.identity!==context.identity)return;
    try{Promise.resolve(onAction(row.id,context)).catch(error=>notice(error.message));}catch(error){notice(error.message);}
  }
  function openChildren(bound,menu,row){
    if(!current(bound) || !row.enabled || !row.children?.length)return;
    const existing=bound.menus[menu.depth+1];if(existing?.parent===row){focus(existing,0);return;}closeChildren(bound,menu.depth);row.button.setAttribute('aria-expanded','true');const child=build(bound,row.children,menu.depth+1,row,row.path);bound.menus.push(child);position(child);focus(child,0);
  }
  function build(bound,items,depth,parent=null,path=[]){
    const grid=parent?.layout==='swatches' && items.some(item=>swatch(item?.swatch)),element=create('div',`timeline-context-menu${grid?' timeline-context-menu-swatches':''}`);element.setAttribute('role','menu');element.setAttribute('aria-label',parent?parent.label:`${bound.target.kind} context menu`);element.tabIndex=-1;bound.layer.append(element);
    const removers=[],menu={element,depth,parent,grid,rows:[],index:-1,point:[bound.target.clientX,bound.target.clientY],removeListeners(){for(const remove of removers)remove();}};
    const on=(node,type,callback)=>{node.addEventListener(type,callback);removers.push(()=>node.removeEventListener(type,callback));};
    for(const item of items){
      if(item?.separator){const separator=create('div','timeline-context-menu-separator');separator.setAttribute('role','separator');element.append(separator);continue;}
      if(typeof item?.id!=='string' || !item.id || typeof item.label!=='string')continue;
      const colored=grid && swatch(item.swatch),button=create('button',`timeline-context-menu-item${colored?' timeline-context-menu-color':''}`),checked=typeof item.checked==='boolean',children=Array.isArray(item.children)?item.children:null,row={id:item.id,label:item.label,enabled:item.enabled!==false,children,layout:item.layout,swatch:colored,button,path:[...path,item.id]};
      button.type='button';button.tabIndex=-1;button.disabled=!row.enabled;button.setAttribute('role',checked?'menuitemcheckbox':'menuitem');button.setAttribute('aria-label',item.label);button.setAttribute('aria-disabled',String(!row.enabled));if(checked)button.setAttribute('aria-checked',String(item.checked));
      const mark=create('span','timeline-context-menu-mark'),label=create('span','timeline-context-menu-label');mark.textContent=checked && item.checked?'✓':'';mark.setAttribute('aria-hidden','true');label.textContent=item.label;button.append(mark,label);
      if(colored){const chip=create('span','timeline-context-menu-color-chip');chip.setAttribute('aria-hidden','true');property(chip,'--swatch',`rgb(${item.swatch.join(',')})`);button.title=item.label;button.append(chip);}
      if(children?.length){const arrow=create('span','timeline-context-menu-arrow');arrow.textContent='›';arrow.setAttribute('aria-hidden','true');button.append(arrow);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');}
      menu.rows.push(row);element.append(button);on(button,'focus',()=>{menu.index=menu.rows.indexOf(row);});on(button,'click',event=>{event.preventDefault();event.stopPropagation();activate(bound,menu,row);});
      on(button,'pointerenter',()=>{if(!current(bound))return;if(!row.enabled){closeChildren(bound,depth);return;}menu.index=menu.rows.indexOf(row);if(children?.length)openChildren(bound,menu,row);else closeChildren(bound,depth);});
    }
    on(element,'keydown',event=>{
      event.stopPropagation();if(!current(bound)){close(false);return;}const row=focused(menu),enabled=menu.rows.filter(row=>row.enabled),index=enabled.indexOf(row);
      if(event.key==='Tab'){close(false);return;}
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(grid && row?.swatch && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        event.preventDefault();const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-6,ArrowDown:6}[event.key],step=Math.sign(delta),start=menu.rows.indexOf(row);let next=Math.max(0,Math.min(menu.rows.length-1,start+delta));
        while(next>=0 && next<menu.rows.length && !menu.rows[next].enabled)next+=step;if(menu.rows[next]?.enabled)menu.rows[next].button.focus?.();return;
      }
      if(grid && !row?.swatch && event.key==='ArrowUp'){event.preventDefault();const colors=menu.rows.filter(row=>row.swatch && row.enabled),next=colors[Math.floor(Math.max(0,colors.length-1)/6)*6];next?.button.focus?.();return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();closeChildren(bound,depth);focus(menu,event.key==='Home'?0:event.key==='End'?enabled.length-1:index+(event.key==='ArrowDown'?1:-1));return;}
      if(event.key==='ArrowRight'){event.preventDefault();if(row?.children?.length)openChildren(bound,menu,row);return;}
      if(event.key==='ArrowLeft'){event.preventDefault();if(parent){closeChildren(bound,depth-1);parent.button.focus?.();}return;}
      if(event.key==='Enter' || event.key===' '){event.preventDefault();if(row)activate(bound,menu,row);}
    });
    on(element,'contextmenu',event=>{event.preventDefault();event.stopPropagation();});
    return menu;
  }
  function open(target){
    if(disposed || !doc?.createElement || !doc.body || !target || !['clip','track','ruler','background','marker'].includes(target.kind) || !Number.isFinite(target.clientX) || !Number.isFinite(target.clientY))return false;
    close(false);const context=read(target);if(!context || doc.hidden)return false;let items;try{items=getItems(context);if(!Array.isArray(items))return false;}catch(error){notice(error.message);return false;}
    const layer=create('div','timeline-context-menu-layer');layer.setAttribute('popover','manual');const bound={target:{...target},context:structuredClone(context),layer,menus:[],dispatched:false};owner=bound;doc.body.append(layer);
    const menu=build(bound,items,0);bound.menus.push(menu);try{layer.showPopover?.();}catch{layer.removeAttribute?.('popover');}position(menu);focus(menu,0);if(!current(bound)){close(false);return false;}return true;
  }
  listen(doc,'pointerdown',event=>{if(owner && owner.layer.contains?.(event.target)===false)close(false);},true);
  listen(doc,'focusin',event=>{if(owner && owner.layer.contains?.(event.target)===false)close(false);});
  listen(doc,'visibilitychange',()=>{if(doc.hidden)close(false);});listen(win,'blur',()=>close(false));listen(win,'resize',()=>close(false));
  listen(win,'scroll',event=>{if(!owner)return;if(owner.layer.contains?.(event.target)===true){for(const menu of owner.menus.slice(1))position(menu);}else close(false);},true);
  return {open,close,invalidate,active:()=>Boolean(owner),dispose(){if(disposed)return;close(false);disposed=true;for(const remove of listeners)remove();}};
}
