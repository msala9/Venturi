export function isTextTarget(target) {
  return !!target?.closest?.(
    'input,textarea,select,video,audio,[contenteditable="true"],dialog',
  );
}

export function installClipListDismissal(menu, {documentRef=globalThis.document}={}) {
  const close=()=>{if(menu)menu.open=false;};
  const outside=event=>{if(menu?.open && !menu.contains(event.target))close();};
  const escape=event=>{
    if(event.key!=='Escape' || event.defaultPrevented || !menu?.open)return;
    const owned=menu.contains(event.target) && !isTextTarget(event.target);
    close();
    if(owned){event.preventDefault();event.stopPropagation();menu.querySelector('summary')?.focus();}
  };
  const dialog=event=>{if(event.target?.matches?.('dialog') && event.target.open)close();};
  const listeners=[['pointerdown',outside],['focusin',outside],['keydown',escape],['toggle',dialog]];
  for(const [name,callback] of listeners)documentRef.addEventListener(name,callback,true);
  return {close,dispose(){for(const [name,callback] of listeners)documentRef.removeEventListener(name,callback,true);}};
}

export function installSplitter(
  element,
  editor,
  property,
  initial,
  direction = 1,
  {storageKey=property} = {},
) {
  let value = initial;
  try {
    value = Number(localStorage.getItem(storageKey)) || initial;
  } catch {}
  const min = Number(element.getAttribute("aria-valuemin"));
  const max = Number(element.getAttribute("aria-valuemax"));
  const set = (next) => {
    value = Math.min(max, Math.max(min, next));
    editor.style.setProperty(property, `${value}px`);
    element.setAttribute("aria-valuenow", value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {}
  };
  set(value);
  element.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    set(
      value +
        (["ArrowRight", "ArrowDown"].includes(event.key) ? 16 : -16) *
          direction,
    );
  });
  element.addEventListener("pointerdown", (event) => {
    const horizontal =
      element.getAttribute("aria-orientation") === "horizontal";
    const start = horizontal ? event.clientY : event.clientX;
    const original = value;
    element.setPointerCapture(event.pointerId);
    const move = (next) =>
      set(
        original +
          ((horizontal ? next.clientY : next.clientX) - start) * direction,
      );
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("lostpointercapture", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("lostpointercapture", end);
    element.addEventListener(
      "pointerup",
      () => element.releasePointerCapture(event.pointerId),
      { once: true },
    );
  });
}
