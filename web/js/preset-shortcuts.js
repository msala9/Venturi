import {isTextTarget} from './ui.js';

const limit = 64;
const symbols={Colon:':',Comma:',',Minus:'-',Period:'.',Plus:'+',Equals:'=',Semicolon:';',Backslash:'\\',Slash:'/',Pipe:'|',Questionmark:'?',Exclamationmark:'!',OpenBracket:'[',CloseBracket:']',OpenCurlyBracket:'{',CloseCurlyBracket:'}',Backtick:'`',Quote:"'"};
const aliases=new Map([...Object.entries(symbols).map(([key,value])=>[value,key]),...Object.entries({ArrowDown:'Down','⏷':'Down',ArrowLeft:'Left','⏴':'Left',ArrowRight:'Right','⏵':'Right',ArrowUp:'Up','⏶':'Up',Esc:'Escape',Return:'Enter',NumpadEnter:'Enter',Help:'Insert',' ':'Space',NumpadComma:'Comma','−':'Minus',NumpadSubtract:'Minus',NumpadDecimal:'Period',NumpadAdd:'Plus',Equal:'Equals',NumpadEqual:'Equals',NumpadDivide:'Slash',BracketLeft:'OpenBracket',BracketRight:'CloseBracket',Backquote:'Backtick',Grave:'Backtick'}),...Array.from({length:10},(_,index)=>[[`Digit${index}`,String(index)],[`Numpad${index}`,String(index)]]).flat(),...Array.from({length:26},(_,index)=>{const key=String.fromCharCode(65+index);return [[key.toLowerCase(),key],[`Key${key}`,key]];}).flat()]);
const canonicalKey=key=>aliases.get(key) || key;
const namedKeys=new Set(['Down','Left','Right','Up','Escape','Tab','Backspace','Enter','Insert','Delete','Home','End','PageUp','PageDown','Space','IntlBackslash']);
const nativeActions=new Map(Object.entries({Space:'Play / pause',A:'Fast playback',Left:'Previous frame',Right:'Next frame',I:'Mark In',O:'Mark Out',Z:'Viewer fit','Shift+Alt+Z':'Viewer actual size','Ctrl+F':'Viewer fullscreen','Ctrl+Z':'Undo','Ctrl+Shift+Z':'Redo','Ctrl+C':'Copy','Ctrl+X':'Cut','Ctrl+V':'Paste','Alt+V':'Paste attributes',Delete:'Delete',Backspace:'Delete',IntlBackslash:'Ripple delete',T:'Split',D:'Toggle disabled','Ctrl+R':'Speed handles','Ctrl+A':'Select all','Alt+Y':'Select from playhead',F2:'Rename','Ctrl+N':'New project','Ctrl+O':'Open project','Ctrl+S':'Save','Ctrl+Shift+S':'Save as','Ctrl+I':'Import media','Ctrl+Shift+E':'Export','Ctrl+Comma':'Settings','Ctrl+Plus':'Timeline zoom in','Ctrl+Equals':'Timeline zoom in','Ctrl+Minus':'Timeline zoom out',M:'Add marker',V:'Select tool',B:'Slip tool',Enter:'Open compound','Alt+Left':'Exit compound'}));
const chord=binding=>[binding.ctrl?'Ctrl':null,binding.shift?'Shift':null,binding.alt?'Alt':null,binding.key].filter(Boolean).join('+');
const symbolKey=value=>Object.hasOwn(symbols,value);
function conflict(binding){
  const {key,ctrl,alt,shift}=binding,id=chord(binding),native=nativeActions.get(id) || (symbolKey(key) && shift?nativeActions.get(chord({...binding,shift:false})):null);
  if(native)return `Reserved by the native editor: ${native}`;
  if(ctrl && ['K','O','S','Z'].includes(key))return `Reserved by the editor ${key==='K'?'command palette':key==='O'?'Open project':key==='S'?'Save / Save as':'Undo / Redo'} handler, including Alt and Shift`;
  if(ctrl && (key==='E' && shift || key==='I' && !shift))return `Reserved by the editor ${key==='E'?'Export':'Import media'} handler, including Alt`;
  if(!ctrl && key==='T')return 'Reserved by the editor Split handler, including Alt and Shift';
  if(!ctrl && alt && key==='V')return 'Reserved by the editor Paste attributes handler, including Shift';
  if(['Left','Right'].includes(key))return 'Reserved by editor frame stepping / clip movement and browser history navigation';
  if(key==='Escape' && !ctrl && !alt && !shift)return 'Reserved for canceling editor gestures and popups';
  if(key==='Tab')return 'Reserved for browser or system focus / tab navigation';
  const functionCommand=({F1:'Help',F4:'address-bar history',F7:'caret browsing',F9:'reader mode',F11:'fullscreen',F12:'developer tools'})[key];
  if(!ctrl && !alt && (functionCommand && !shift || ['F3','F6','F10'].includes(key)))return `Reserved by browser ${functionCommand || ({F3:'Find next / previous',F6:'focus navigation',F10:'menu / context menu'})[key]} (${id})`;
  if(!alt && key==='F5')return 'Reserved by browser reload';
  if(alt && !ctrl && !shift && ['F4','Space','Home','D','E','F'].includes(key))return `Reserved by browser/system ${({F4:'Close window',Space:'window menu',Home:'Home page',D:'address bar',E:'browser menu',F:'browser menu'})[key]} (${id})`;
  if(ctrl && alt && key==='Delete' || ctrl && !alt && key==='Escape')return 'Reserved by system security or task controls';
  if(ctrl && !alt){
    const browser=key==='W' || key==='F4'?'Close tab / window':key==='PageUp' || key==='PageDown' || /^[1-9]$/.test(key)?'tab navigation':({D:shift?'Bookmark all tabs':'Bookmark page',G:'Find next / previous',J:shift?'developer tools':'Downloads',N:shift?'private window':'New window',P:'Print',Q:'Quit window',R:'Reload',T:shift?'Reopen closed tab':'New tab',U:shift?'Read aloud':'View source'})[key] || (!shift?({E:'Search / address bar',H:'History',L:'address bar'})[key]:({A:'tab search',B:'bookmarks bar',C:'Inspect element',M:'profile / developer controls',V:'Paste plain text',Delete:'Clear browsing data'})[key]);
    if(browser)return `Reserved by browser ${browser} (${id})`;
  }
  return null;
}

export function presetShortcutBinding(shortcut){
  if(typeof shortcut!=='string' || !shortcut || new TextEncoder().encode(shortcut).length>128 || /[\u0000-\u001f\u007f-\u009f]/.test(shortcut))return {reason:'This preset has no supported desktop shortcut'};
  let parts,key;if(shortcut==='+'){parts=[];key='Plus';}else if(shortcut.endsWith('++')){parts=shortcut.slice(0,-2).split('+');key='Plus';}else{parts=shortcut.split('+');key=parts.pop();}
  key=canonicalKey(key);
  const modifiers=new Set(parts);
  if(modifiers.size!==parts.length || parts.some(part=>!['Ctrl','Alt','Shift'].includes(part)))return {reason:'The native shortcut has unsupported or repeated modifiers; its desktop value is preserved'};
  if(/^(Shift|Control|Alt|Super)(Left|Right)$/.test(key || ''))return {reason:'A modifier key alone cannot activate a preset'};
  if(['Copy','Cut','Paste'].includes(key))return {reason:'Dedicated clipboard keys belong to browser/editor clipboard commands'};
  if(key==='BrowserBack')return {reason:'BrowserBack belongs to browser history navigation'};
  if(!(/^[A-Z0-9]$/.test(key || '') || namedKeys.has(key) || symbolKey(key) || /^F([1-9]|1\d|2[0-4])$/.test(key || '')))return {reason:'This native key is not exposed as a supported browser keyboard key (F1–F24, letters, digits, symbols or navigation)'};
  const binding={key,ctrl:modifiers.has('Ctrl'),alt:modifiers.has('Alt'),shift:modifiers.has('Shift')};binding.label=chord(binding);
  const reason=conflict(binding);return reason?{...binding,reason:`${reason}; the desktop shortcut is preserved`}:binding;
}

export function presetShortcutMatches(event,binding){
  const browserKey=event.code==='IntlBackslash'?'IntlBackslash':event.key==='Spacebar'?'Space':canonicalKey(event.key);
  return Boolean(binding.key && !binding.reason && !event.repeat && !event.isComposing && event.keyCode!==229 && !event.getModifierState?.('AltGraph') &&
    (binding.ctrl?Boolean(event.ctrlKey)!==Boolean(event.metaKey):!event.ctrlKey && !event.metaKey) && Boolean(event.altKey)===binding.alt && (symbolKey(binding.key) && !binding.shift || Boolean(event.shiftKey)===binding.shift) && browserKey===binding.key);
}

export function createPresetShortcuts({getContext,canCommit,commit,notice,document:documentRef=globalThis.document}){
  const entries=new Map();let epoch=null,busy=false,disposed=false;
  function sync(){const next=getContext()?.epoch ?? null;if(next!==epoch){entries.clear();epoch=next;}}
  function state(item){
    sync();const binding=presetShortcutBinding(item?.shortcut),entry=entries.get(item?.id);
    if(!item || item.error || item.archived || typeof item.id!=='string' || typeof item.revision!=='string'){entries.delete(item?.id);return {enabled:false,reason:'Choose a valid active saved preset'};}
    if(binding.reason){entries.delete(item.id);return {enabled:false,...binding};}
    if(entry && entry.revision!==item.revision){entries.delete(item.id);return {enabled:false,...binding,reason:'Preset settings changed; enable the shortcut again'};}
    return {enabled:Boolean(entry),...binding};
  }
  function activate(item){
    const info=state(item);if(disposed)throw Error('Preset shortcuts are closed');if(info.reason)throw Error(info.reason);
    if(!epoch)throw Error('Connect to a native session before enabling a shortcut');
    if(!canCommit())throw Error('A writable idle session is required to enable a preset shortcut');
    const duplicate=[...entries.values()].find(entry=>entry.id!==item.id && entry.key===info.key && entry.ctrl===info.ctrl && entry.alt===info.alt && (entry.shift===info.shift || symbolKey(info.key)));
    if(duplicate)throw Error(`This shortcut is already enabled for ${duplicate.name}${duplicate.shift!==info.shift?' (native symbols can consume Shift to produce the key)':''}; disable it first`);
    if(!entries.has(item.id) && entries.size>=limit)throw Error(`At most ${limit} preset shortcuts can be enabled in this browser session`);
    entries.set(item.id,{...info,id:item.id,revision:item.revision,name:item.name || item.id});
    return state(item);
  }
  function keydown(event){
    sync();if(disposed || busy || event.defaultPrevented || event.cancelable===false || event.target?.isContentEditable || isTextTarget(event.target) || documentRef.hidden || documentRef.querySelector?.('dialog[open],[role="menu"],[role="listbox"],.app-menu[open]') || !canCommit())return;
    const context=getContext();if(!context?.clip_ids?.length)return;
    const entry=[...entries.values()].find(candidate=>presetShortcutMatches(event,candidate));if(!entry)return;
    if(event.target?.closest?.('[role="combobox"],[role="listbox"],[role="menu"]') || ['Enter','Space','Escape','Up','Down','Home','End','PageUp','PageDown','Delete','Backspace','F2'].includes(entry.key) && event.target?.closest?.('button,summary,a,[data-key-editor-window],.curve-window,[data-keyframe-editor]'))return;
    event.preventDefault();event.stopImmediatePropagation();busy=true;
    const operation={kind:'apply_saved_preset',clip_ids:[...context.clip_ids],preset_id:entry.id,revision:entry.revision};
    const rejected=error=>{
      if(epoch===context.epoch && entries.get(entry.id)===entry)entries.delete(entry.id);
      notice(`${error.message} · preset shortcut disabled; refresh the preset before enabling it again`);
    };
    try{Promise.resolve(commit(operation)).catch(rejected).finally(()=>{busy=false;});}
    catch(error){rejected(error);busy=false;}
  }
  documentRef.addEventListener('keydown',keydown,true);
  return {state,activate,sync,deactivate(id){entries.delete(id);},dispose(){disposed=true;entries.clear();documentRef.removeEventListener('keydown',keydown,true);}};
}
