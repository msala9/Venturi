export function isTextTarget(target) {
  return !!target?.closest?.(
    'input,textarea,select,[contenteditable="true"],dialog',
  );
}

export function installSplitter(
  element,
  editor,
  property,
  initial,
  direction = 1,
) {
  let value = initial;
  try {
    value = Number(localStorage.getItem(property)) || initial;
  } catch {}
  const min = Number(element.getAttribute("aria-valuemin"));
  const max = Number(element.getAttribute("aria-valuemax"));
  const set = (next) => {
    value = Math.min(max, Math.max(min, next));
    editor.style.setProperty(property, `${value}px`);
    element.setAttribute("aria-valuenow", value);
    try {
      localStorage.setItem(property, value);
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
