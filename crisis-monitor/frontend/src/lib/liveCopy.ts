/**
 * A live copy of an on-screen visual: a standalone HTML page that shows the
 * same layout, colours and CSS motion (pulses, transitions, keyframe
 * animations) in the viewer's browser. Scripts are not copied, so a map or
 * globe appears as a still frame, and a canvas is copied as its current picture.
 *
 * Each element's computed style is written out as its own inline style, but
 * only the properties that differ from a fresh element in the same place, so
 * the copy stays small. Keyframes and ::before / ::after styles are copied too.
 */

const DROP = new Set(["SCRIPT", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "LINK", "STYLE", "META", "TITLE"]);

/** The computed style a fresh element of this tag would have in the same parent. */
function baselineFor(orig: Element): CSSStyleDeclaration | null {
  const parent = orig.parentElement;
  if (!parent) return null;
  const probe = document.createElement(orig.tagName);
  probe.setAttribute("aria-hidden", "true");
  probe.style.setProperty("display", "none");
  parent.appendChild(probe);
  try {
    return getComputedStyle(probe);
  } finally {
    probe.remove();
  }
}

/** Declarations for every property where `cs` differs from `base`. */
function diffDecls(cs: CSSStyleDeclaration, base: CSSStyleDeclaration | null): string[] {
  const out: string[] = [];
  for (let k = 0; k < cs.length; k++) {
    const prop = cs[k];
    const v = cs.getPropertyValue(prop);
    if (!base || base.getPropertyValue(prop) !== v) out.push(`${prop}:${v}`);
  }
  return out;
}

function keyframesCss(): string {
  let out = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a sheet from another origin cannot be read
    }
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.KEYFRAMES_RULE) out += rule.cssText + "\n";
    }
  }
  return out;
}

function stylesheetLinks(): string {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((l) => `<link rel="stylesheet" href="${l.href}">`)
    .join("");
}

export interface LiveCopy {
  html: string;
  width: number;
  height: number;
}

export function buildLiveCopy(el: HTMLElement, paper: string): LiveCopy {
  const rect = el.getBoundingClientRect();
  const origs: HTMLElement[] = [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))];
  const clone = el.cloneNode(true) as HTMLElement;
  const copies: HTMLElement[] = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
  let pseudo = "";

  origs.forEach((orig, i) => {
    const copy = copies[i];
    if (orig.tagName === "CANVAS") {
      try {
        const img = document.createElement("img");
        img.src = (orig as HTMLCanvasElement).toDataURL("image/png");
        img.width = orig.clientWidth;
        img.height = orig.clientHeight;
        copy.replaceWith(img);
        copies[i] = img;
      } catch {
        // A canvas the browser will not read (such as a map) stays empty.
      }
      return;
    }
    const base = baselineFor(orig);
    const decls = diffDecls(getComputedStyle(orig), base);
    copy.setAttribute("style", decls.join(";"));
    copy.removeAttribute("class");
    copy.removeAttribute("id");
    const id = `lv${i}`;
    for (const ps of ["::before", "::after"] as const) {
      const cs = getComputedStyle(orig, ps);
      const content = cs.getPropertyValue("content");
      if (!content || content === "none" || content === "normal") continue;
      const pdecls = diffDecls(cs, null); // a pseudo-element has no fresh twin, so copy all of it
      pseudo += `[data-lv="${id}"]${ps}{${pdecls.join(";")}}\n`;
      copy.setAttribute("data-lv", id);
    }
  });

  // Drop anything that cannot run or does not belong in a standalone page.
  clone.querySelectorAll("*").forEach((n) => {
    if (DROP.has(n.tagName)) n.remove();
  });

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${stylesheetLinks()}
<style>
html,body{margin:0;background:${paper};}
${keyframesCss()}
${pseudo}
</style></head>
<body><div style="width:${Math.round(rect.width)}px">${clone.outerHTML}</div></body></html>`;

  return { html, width: Math.round(rect.width), height: Math.round(rect.height) };
}
