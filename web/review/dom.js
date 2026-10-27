/** Builds an element with text and attributes. Text goes in as textContent, never as HTML. */
export function el(tagName, options = {}, children = []) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) element.setAttribute(name, value);
  for (const child of children) element.append(child);
  return element;
}

export function setDisabled(button, isDisabled) {
  button.setAttribute('aria-disabled', String(isDisabled));
}

export function isDisabled(button) {
  return button.getAttribute('aria-disabled') === 'true';
}
