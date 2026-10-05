import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import { Node, mergeAttributes, type Extensions, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  ImagePlus,
  Italic,
  LayoutDashboard,
  Link2,
  List,
  ListOrdered,
  MapPinned,
  Minus,
  Palette,
  Quote,
  Redo2,
  SquareAsterisk,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Underline,
  Undo2,
} from "lucide-react";
import { api, type CustomDashboard } from "../api";
import { uploadImageFile } from "../imageUpload";

/**
 * The formatting editor for Regional Spotlight articles, and the read-only
 * view of what it produces.
 *
 * An article body is stored as a document tree (JSON), not as HTML. The
 * same set of building blocks (`spotlightExtensions`) defines both what the
 * editor can write and what the reader shows, so an article always looks
 * the same in both — and nothing outside that set can be displayed, which
 * is what keeps a stored article from ever carrying script. The server
 * checks the same rules again before saving (backend lib/spotlightDoc.ts).
 *
 * Three blocks are specific to this platform:
 *   - figure:  an uploaded or linked image (a map, an infographic) with a
 *              caption, a width and an alignment;
 *   - embed:   something live shown inside the article — one of the
 *              platform's own shared dashboards, or an interactive map or
 *              chart hosted elsewhere;
 *   - callout: a tinted box for key points.
 */

const isHttpUrl = (url: unknown): url is string => typeof url === "string" && /^https?:\/\/[^\s<>"']+$/i.test(url);
const isHttpsUrl = (url: unknown): url is string => typeof url === "string" && /^https:\/\/[^\s<>"']+$/i.test(url);
const isDashboardToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{6,120}$/.test(t);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** True when a stored body was written in the formatting editor (as
 *  opposed to the first version's plain text). */
export function isRichBody(body: string | null | undefined): body is string {
  return !!body && /^\s*\{\s*"type"\s*:\s*"doc"/.test(body);
}

/* ───────────────────────── custom blocks ───────────────────────── */

type Align = "left" | "center" | "right";

function blockPlacement(width: number, align: Align): React.CSSProperties {
  return {
    width: `${clamp(width, 15, 100)}%`,
    marginLeft: align === "left" ? 0 : "auto",
    marginRight: align === "right" ? 0 : "auto",
  };
}

/** Drag the grip to resize. `axis` x changes the width (as a share of the
 *  article's width), y the height in pixels. */
function useDragResize(onResize: (dx: number, dy: number, start: { width: number; height: number; parentWidth: number }) => void) {
  return (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const block = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-resizable]");
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const parentWidth = block.parentElement?.getBoundingClientRect().width ?? rect.width;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) =>
      onResize(ev.clientX - startX, ev.clientY - startY, {
        width: rect.width,
        height: rect.height,
        parentWidth,
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function BlockControls({ children }: { children: React.ReactNode }) {
  // contentEditable=false + stopping mousedown keeps typing in these inputs
  // from being treated as edits to the article text.
  return (
    <div className="spotlight-block-controls" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

function AlignButtons({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  return (
    <span className="spotlight-block-controls__group">
      {(["left", "center", "right"] as const).map((a) => (
        <button key={a} type="button" aria-pressed={value === a} onClick={() => onChange(a)} title={`Align ${a}`}>
          {a === "left" ? <AlignLeft size={14} /> : a === "center" ? <AlignCenter size={14} /> : <AlignRight size={14} />}
        </button>
      ))}
    </span>
  );
}

function FigureView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { src, alt, caption, width, align } = node.attrs as {
    src: string;
    alt: string;
    caption: string;
    width: number;
    align: Align;
  };
  const editable = editor.isEditable;
  const startResize = useDragResize((dx, _dy, start) => {
    // Centered images grow from both sides, so the pointer moves half as far as the width changes.
    const factor = align === "center" ? 2 : 1;
    updateAttributes({
      width: Math.round(clamp(((start.width + dx * factor) / start.parentWidth) * 100, 15, 100)),
    });
  });
  if (!isHttpUrl(src)) return <NodeViewWrapper />;
  return (
    <NodeViewWrapper as="figure" className={`spotlight-figure${selected && editable ? " is-selected" : ""}`} style={blockPlacement(width, align)} data-resizable>
      {/* The picture itself is the handle for dragging the block elsewhere in the article. */}
      <div className="spotlight-figure__image">
        <img src={src} alt={alt || caption || ""} loading="lazy" data-drag-handle />
        {editable && selected && <span className="spotlight-grip spotlight-grip--corner" onPointerDown={startResize} title="Drag to resize" />}
      </div>
      {editable ? (
        selected ? (
          <BlockControls>
            <label>
              Width
              <input type="range" min={15} max={100} value={width} onChange={(e) => updateAttributes({ width: Number(e.target.value) })} />
              <span>{width}%</span>
            </label>
            <AlignButtons value={align} onChange={(a) => updateAttributes({ align: a })} />
            <input type="text" value={caption} placeholder="Caption (shown under the image)" onChange={(e) => updateAttributes({ caption: e.target.value })} />
            <input type="text" value={alt} placeholder="Description for screen readers" onChange={(e) => updateAttributes({ alt: e.target.value })} />
            <button type="button" className="is-danger" onClick={deleteNode}>
              Remove
            </button>
          </BlockControls>
        ) : (
          caption && <figcaption>{caption}</figcaption>
        )
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}

const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
      width: { default: 100 },
      align: { default: "center" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-spotlight-figure]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const src = e.getAttribute("data-src");
          return isHttpUrl(src)
            ? {
                src,
                alt: e.getAttribute("data-alt") ?? "",
                caption: e.getAttribute("data-caption") ?? "",
                width: Number(e.getAttribute("data-width")) || 100,
                align: e.getAttribute("data-align") || "center",
              }
            : false;
        },
      },
      // A picture pasted from a web page or a Word document that points at a web address.
      {
        tag: "img[src]",
        getAttrs: (el) =>
          isHttpUrl((el as HTMLElement).getAttribute("src"))
            ? {
                src: (el as HTMLElement).getAttribute("src"),
                alt: (el as HTMLElement).getAttribute("alt") ?? "",
              }
            : false,
      },
    ];
  },
  renderHTML({ node }) {
    const a = node.attrs;
    return [
      "figure",
      {
        "data-spotlight-figure": "",
        "data-src": a.src,
        "data-alt": a.alt,
        "data-caption": a.caption,
        "data-width": a.width,
        "data-align": a.align,
      },
      ["img", { src: a.src, alt: a.alt }],
      ["figcaption", {}, a.caption],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});

/** Where an embedded frame points. A platform dashboard is addressed by its
 *  share token and always opened on whatever address this site is being
 *  served from, so articles keep working if the site's address changes. */
function embedSource(attrs: { kind?: string; src?: string; token?: string }): string | null {
  if (attrs.kind === "dashboard") return isDashboardToken(attrs.token) ? `${window.location.origin}/shared/${attrs.token}?embed=1` : null;
  return isHttpsUrl(attrs.src) ? attrs.src : null;
}

function EmbedView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { kind, height, width, align, caption } = node.attrs as {
    kind: string;
    height: number;
    width: number;
    align: Align;
    caption: string;
  };
  const editable = editor.isEditable;
  const src = embedSource(node.attrs);
  const startResize = useDragResize((_dx, dy, start) =>
    updateAttributes({
      height: Math.round(clamp(start.height + dy, 160, 2400)),
    }),
  );
  if (!src) return <NodeViewWrapper />;
  return (
    <NodeViewWrapper as="figure" className={`spotlight-embed${selected && editable ? " is-selected" : ""}`} style={blockPlacement(width, align)}>
      <div className="spotlight-embed__frame" style={{ height }} data-resizable>
        <iframe
          src={src}
          title={caption || (kind === "dashboard" ? "Live dashboard" : "Embedded content")}
          loading="lazy"
          allow="fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          // Outside content runs in its own box: scripts and its own storage
          // are allowed (interactive maps need them), reaching into this
          // page is not. The platform's own dashboard pages need no box.
          sandbox={kind === "dashboard" ? undefined : "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"}
        />
        {/* While editing, a click should select the block, not start panning the map inside it. */}
        {editable && <div className="spotlight-embed__shield" data-drag-handle />}
        {editable && selected && <span className="spotlight-grip spotlight-grip--bottom" onPointerDown={startResize} title="Drag to change the height" />}
      </div>
      {editable && selected ? (
        <BlockControls>
          <label>
            Height
            <input type="range" min={160} max={1600} step={10} value={height} onChange={(e) => updateAttributes({ height: Number(e.target.value) })} />
            <span>{height}px</span>
          </label>
          <label>
            Width
            <input type="range" min={30} max={100} value={width} onChange={(e) => updateAttributes({ width: Number(e.target.value) })} />
            <span>{width}%</span>
          </label>
          <AlignButtons value={align} onChange={(a) => updateAttributes({ align: a })} />
          <input type="text" value={caption} placeholder="Caption (shown under it)" onChange={(e) => updateAttributes({ caption: e.target.value })} />
          <a href={src} target="_blank" rel="noopener noreferrer">
            Open
          </a>
          <button type="button" className="is-danger" onClick={deleteNode}>
            Remove
          </button>
        </BlockControls>
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}

const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      kind: { default: "external" },
      src: { default: "" },
      token: { default: "" },
      height: { default: 520 },
      width: { default: 100 },
      align: { default: "center" },
      caption: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-spotlight-embed]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const attrs = {
            kind: e.getAttribute("data-kind") ?? "external",
            src: e.getAttribute("data-src") ?? "",
            token: e.getAttribute("data-token") ?? "",
          };
          return embedSource(attrs)
            ? {
                ...attrs,
                height: Number(e.getAttribute("data-height")) || 520,
                width: Number(e.getAttribute("data-width")) || 100,
                caption: e.getAttribute("data-caption") ?? "",
              }
            : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    const a = node.attrs;
    return [
      "div",
      {
        "data-spotlight-embed": "",
        "data-kind": a.kind,
        "data-src": a.src,
        "data-token": a.token,
        "data-height": a.height,
        "data-width": a.width,
        "data-caption": a.caption,
      },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});

function CalloutView() {
  return (
    <NodeViewWrapper className="spotlight-callout">
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-spotlight-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-spotlight-callout": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

function spotlightExtensions(editable: boolean): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: {
        openOnClick: !editable,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TableKit.configure({ table: { resizable: editable } }),
    Figure,
    Embed,
    Callout,
    ...(editable
      ? [
          Placeholder.configure({
            placeholder: "Write or paste the article here. Use the toolbar for headings, tables, images, maps and live dashboards.",
          }),
        ]
      : []),
  ];
}

/* ───────────────────── converting first-version text ───────────────────── */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function legacyInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Entries written before the formatting editor existed used a few plain
 *  text marks (## heading, - bullet, **bold** ...). Opening one in the
 *  editor converts it, so nothing has to be retyped. */
export function legacyTextToHtml(text: string): string {
  const out: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const image = /^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/.exec(line);
    if (heading) {
      const level = heading[1].length >= 3 ? 3 : 2;
      out.push(`<h${level}>${legacyInline(heading[2])}</h${level}>`);
      i++;
    } else if (image) {
      out.push(`<figure data-spotlight-figure data-src="${escapeHtml(image[2])}" data-caption="${escapeHtml(image[1])}"></figure>`);
      i++;
    } else if (/^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const rx = ordered ? /^\d+[.)]\s+/ : /^[-*•]\s+/;
      const items: string[] = [];
      while (i < lines.length && rx.test(lines[i].trim())) items.push(`<li><p>${legacyInline(lines[i++].trim().replace(rx, ""))}</p></li>`);
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
    } else if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quoted.push(lines[i++].trim().replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${legacyInline(quoted.join(" "))}</p></blockquote>`);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*•]\s|\d+[.)]\s|>|!\[)/.test(lines[i].trim())) para.push(legacyInline(lines[i++].trim()));
      out.push(`<p>${para.join("<br>")}</p>`);
    }
  }
  return out.join("");
}

function initialContent(body: string | null | undefined): JSONContent | string {
  if (!body) return "";
  if (isRichBody(body)) {
    try {
      return JSON.parse(body) as JSONContent;
    } catch {
      return "";
    }
  }
  return legacyTextToHtml(body);
}

/* ───────────────────────────── reader ───────────────────────────── */

export function RichTextView({ body }: { body: string }) {
  const extensions = useMemo(() => spotlightExtensions(false), []);
  const editor = useEditor({
    extensions,
    editable: false,
    content: initialContent(body),
  });
  const shown = useRef(body);
  useEffect(() => {
    if (editor && shown.current !== body) {
      shown.current = body;
      editor.commands.setContent(initialContent(body));
    }
  }, [editor, body]);
  return <EditorContent editor={editor} className="spotlight-rich" />;
}

/* ───────────────────────────── editor ───────────────────────────── */

const TEXT_COLORS = [
  { name: "Teal", value: "#0d9488" },
  { name: "Blue", value: "#2f66f0" },
  { name: "Red", value: "#d1352b" },
  { name: "Amber", value: "#b3690b" },
  { name: "Green", value: "#17924f" },
  { name: "Grey", value: "#5b6577" },
];
const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#fff3a3" },
  { name: "Green", value: "#cdeee9" },
  { name: "Blue", value: "#d9e5ff" },
  { name: "Red", value: "#fbdcd9" },
];

type Panel = null | "link" | "image" | "embed" | "dashboard" | "color" | "highlight" | "table";

interface EditorProps {
  /** The stored body the editor starts from (a document, or first-version text). */
  initialBody: string | null | undefined;
  /** Called with the document as a JSON string after every change. */
  onChange: (body: string) => void;
}

export function RichTextEditor({ initialBody, onChange }: EditorProps) {
  const extensions = useMemo(() => spotlightExtensions(true), []);
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorRef = useRef<Editor | null>(null);

  async function insertImages(files: File[], at?: number) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    for (const [n, file] of images.entries()) {
      setStatus({
        text: `Uploading ${images.length > 1 ? `image ${n + 1} of ${images.length}` : file.name}…`,
      });
      try {
        const src = await uploadImageFile(file);
        const ed = editorRef.current;
        if (!ed) return;
        const figure = { type: "figure", attrs: { src, alt: "", caption: "" } };
        if (at !== undefined && n === 0) ed.chain().focus().insertContentAt(at, figure).run();
        else ed.chain().focus().insertContent(figure).run();
      } catch (err) {
        setStatus({
          text: err instanceof Error ? err.message : "The image could not be uploaded.",
          error: true,
        });
        return;
      }
    }
    setStatus(null);
  }

  const editor = useEditor({
    extensions,
    content: initialContent(initialBody),
    shouldRerenderOnTransaction: true, // the toolbar reflects the cursor's current formatting
    onUpdate: ({ editor: ed }) => onChangeRef.current(JSON.stringify(ed.getJSON())),
    editorProps: {
      // Pictures pasted or dropped in are uploaded and placed, never embedded as raw data.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0) return false;
        event.preventDefault();
        const at = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void insertImages(files, at);
        return true;
      },
    },
  });
  editorRef.current = editor;

  if (!editor) return null;

  const style = editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : editor.isActive("heading", { level: 4 }) ? "h4" : "p";
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const inTable = editor.isActive("table");

  return (
    <div className="spotlight-editor-rich">
      {/* The toolbar and whichever panel it has opened stay in view together while the article scrolls. */}
      <div className="spotlight-toolbar-wrap">
        <div className="spotlight-toolbar" role="toolbar" aria-label="Formatting">
          <ToolButton label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
            <Undo2 size={16} />
          </ToolButton>
          <ToolButton label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
            <Redo2 size={16} />
          </ToolButton>
          <Sep />
          <select
            aria-label="Text style"
            value={style}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .setHeading({ level: Number(v[1]) as 2 | 3 | 4 })
                  .run();
            }}
          >
            <option value="p">Normal text</option>
            <option value="h2">Heading</option>
            <option value="h3">Subheading</option>
            <option value="h4">Small heading</option>
          </select>
          <Sep />
          <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={16} />
          </ToolButton>
          <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={16} />
          </ToolButton>
          <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <Underline size={16} />
          </ToolButton>
          <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough size={16} />
          </ToolButton>
          <ToolButton label="Superscript" active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
            <SuperscriptIcon size={16} />
          </ToolButton>
          <ToolButton label="Subscript" active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()}>
            <SubscriptIcon size={16} />
          </ToolButton>
          <ToolButton label="Text colour" active={panel === "color"} onClick={() => toggle("color")}>
            <Palette size={16} />
          </ToolButton>
          <ToolButton label="Highlight" active={panel === "highlight" || editor.isActive("highlight")} onClick={() => toggle("highlight")}>
            <Highlighter size={16} />
          </ToolButton>
          <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
            <Eraser size={16} />
          </ToolButton>
          <Sep />
          <ToolButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
            <AlignLeft size={16} />
          </ToolButton>
          <ToolButton label="Align centre" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
            <AlignCenter size={16} />
          </ToolButton>
          <ToolButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
            <AlignRight size={16} />
          </ToolButton>
          <ToolButton label="Justify" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
            <AlignJustify size={16} />
          </ToolButton>
          <Sep />
          <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List size={16} />
          </ToolButton>
          <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={16} />
          </ToolButton>
          <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote size={16} />
          </ToolButton>
          <ToolButton label="Key points box" active={editor.isActive("callout")} onClick={() => editor.chain().focus().toggleWrap("callout").run()}>
            <SquareAsterisk size={16} />
          </ToolButton>
          <ToolButton label="Dividing line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            <Minus size={16} />
          </ToolButton>
          <Sep />
          <ToolButton label="Link" active={panel === "link" || editor.isActive("link")} onClick={() => toggle("link")}>
            <Link2 size={16} />
          </ToolButton>
          <ToolButton label="Table" active={panel === "table" || inTable} onClick={() => toggle("table")}>
            <TableIcon size={16} />
          </ToolButton>
          <Sep />
          <ToolButton label="Image, map or infographic" text="Image" active={panel === "image"} onClick={() => toggle("image")}>
            <ImagePlus size={16} />
          </ToolButton>
          <ToolButton label="Interactive map or chart from another site" text="Embed" active={panel === "embed"} onClick={() => toggle("embed")}>
            <MapPinned size={16} />
          </ToolButton>
          <ToolButton label="Live dashboard from this platform" text="Live dashboard" active={panel === "dashboard"} onClick={() => toggle("dashboard")}>
            <LayoutDashboard size={16} />
          </ToolButton>
        </div>

        {panel === "color" && (
          <ToolPanel>
            <span>Text colour</span>
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className="spotlight-swatch"
                title={c.name}
                aria-label={c.name}
                style={{ background: c.value }}
                onClick={() => editor.chain().focus().setColor(c.value).run()}
              />
            ))}
            <button type="button" className="spotlight-btn spotlight-btn--small" onClick={() => editor.chain().focus().unsetColor().run()}>
              Default
            </button>
          </ToolPanel>
        )}
        {panel === "highlight" && (
          <ToolPanel>
            <span>Highlight</span>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className="spotlight-swatch"
                title={c.name}
                aria-label={c.name}
                style={{ background: c.value }}
                onClick={() => editor.chain().focus().setHighlight({ color: c.value }).run()}
              />
            ))}
            <button type="button" className="spotlight-btn spotlight-btn--small" onClick={() => editor.chain().focus().unsetHighlight().run()}>
              None
            </button>
          </ToolPanel>
        )}
        {panel === "link" && <LinkPanel editor={editor} onDone={() => setPanel(null)} />}
        {panel === "table" && <TablePanel editor={editor} inTable={inTable} />}
        {panel === "image" && (
          <ImagePanel
            onFiles={(files) => {
              setPanel(null);
              void insertImages(files);
            }}
            onUrl={(src) => {
              editor.chain().focus().insertContent({ type: "figure", attrs: { src } }).run();
              setPanel(null);
            }}
          />
        )}
        {panel === "embed" && (
          <EmbedPanel
            onInsert={(src) => {
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "embed",
                  attrs: { kind: "external", src },
                })
                .run();
              setPanel(null);
            }}
          />
        )}
        {panel === "dashboard" && (
          <DashboardPanel
            onInsert={(token, name) => {
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "embed",
                  attrs: {
                    kind: "dashboard",
                    token,
                    height: 640,
                    caption: name,
                  },
                })
                .run();
              setPanel(null);
            }}
          />
        )}
        {status && (
          <p
            className={`spotlight-notice${status.error ? " spotlight-notice--error" : ""}`}
            style={{
              margin: "8px 0 0",
              background: status.error ? "#fdeeed" : "#e4f4ea",
            }}
          >
            {status.text}
          </p>
        )}
      </div>

      <EditorContent editor={editor} className="spotlight-rich spotlight-rich--editing" />
    </div>
  );
}

function ToolButton(props: { label: string; text?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="spotlight-tool"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active ?? undefined}
      disabled={props.disabled}
      // Keeps the text selection while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
      {props.text && <span>{props.text}</span>}
    </button>
  );
}

const Sep = () => <span className="spotlight-toolbar__sep" aria-hidden="true" />;
const ToolPanel = ({ children }: { children: React.ReactNode }) => <div className="spotlight-toolpanel">{children}</div>;

function LinkPanel({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [url, setUrl] = useState<string>(() => (editor.getAttributes("link").href as string | undefined) ?? "");
  const [error, setError] = useState<string | null>(null);
  function apply() {
    let href = url.trim();
    if (!href) return;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(href)) href = `mailto:${href}`;
    else if (!/^(https?:\/\/|mailto:)/i.test(href)) href = `https://${href}`;
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(href)) return setError("That is not a web or email address.");
    if (editor.state.selection.empty && !editor.isActive("link"))
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    onDone();
  }
  return (
    <ToolPanel>
      <span>Link</span>
      <input
        className="spotlight-input"
        style={{ flex: "1 1 280px" }}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), apply())}
        placeholder="https://… or an email address"
        autoFocus
      />
      <button type="button" className="spotlight-btn spotlight-btn--small spotlight-btn--primary" onClick={apply}>
        Apply
      </button>
      {editor.isActive("link") && (
        <button
          type="button"
          className="spotlight-btn spotlight-btn--small"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onDone();
          }}
        >
          Remove link
        </button>
      )}
      {error ? <small className="is-error">{error}</small> : <small>Select the words first, then add the address. With nothing selected, the address itself is inserted.</small>}
    </ToolPanel>
  );
}

function TablePanel({ editor, inTable }: { editor: Editor; inTable: boolean }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => fn(editor.chain().focus()).run();
  if (!inTable) {
    return (
      <ToolPanel>
        <span>New table</span>
        <label>
          Rows <input className="spotlight-input" type="number" min={1} max={40} value={rows} onChange={(e) => setRows(clamp(Number(e.target.value) || 1, 1, 40))} style={{ width: 70 }} />
        </label>
        <label>
          Columns <input className="spotlight-input" type="number" min={1} max={12} value={cols} onChange={(e) => setCols(clamp(Number(e.target.value) || 1, 1, 12))} style={{ width: 70 }} />
        </label>
        <button type="button" className="spotlight-btn spotlight-btn--small spotlight-btn--primary" onClick={run((c) => c.insertTable({ rows, cols, withHeaderRow: true }))}>
          Insert table
        </button>
        <small>The first row is a header row. A table copied from Word or Excel can also be pasted straight in.</small>
      </ToolPanel>
    );
  }
  const B = ({ label, on }: { label: string; on: () => void }) => (
    <button type="button" className="spotlight-btn spotlight-btn--small" onMouseDown={(e) => e.preventDefault()} onClick={on}>
      {label}
    </button>
  );
  return (
    <ToolPanel>
      <span>Table</span>
      <B label="Row above" on={run((c) => c.addRowBefore())} />
      <B label="Row below" on={run((c) => c.addRowAfter())} />
      <B label="Delete row" on={run((c) => c.deleteRow())} />
      <B label="Column left" on={run((c) => c.addColumnBefore())} />
      <B label="Column right" on={run((c) => c.addColumnAfter())} />
      <B label="Delete column" on={run((c) => c.deleteColumn())} />
      <B label="Header row on/off" on={run((c) => c.toggleHeaderRow())} />
      <B label="Header column on/off" on={run((c) => c.toggleHeaderColumn())} />
      <B label="Merge or split cells" on={run((c) => c.mergeOrSplit())} />
      <button type="button" className="spotlight-btn spotlight-btn--small spotlight-btn--danger" onMouseDown={(e) => e.preventDefault()} onClick={run((c) => c.deleteTable())}>
        Delete table
      </button>
      <small>Drag a column's edge to change its width. Drag across cells to select several before merging.</small>
    </ToolPanel>
  );
}

function ImagePanel({ onFiles, onUrl }: { onFiles: (files: File[]) => void; onUrl: (src: string) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <ToolPanel>
      <span>Image</span>
      <button type="button" className="spotlight-btn spotlight-btn--small spotlight-btn--primary" onClick={() => fileInput.current?.click()}>
        Upload from this computer
      </button>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => e.target.files?.length && onFiles(Array.from(e.target.files))} />
      <span style={{ fontWeight: 400 }}>or</span>
      <input className="spotlight-input" style={{ flex: "1 1 240px" }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Address of an image already online (https://…)" />
      <button
        type="button"
        className="spotlight-btn spotlight-btn--small"
        onClick={() => (isHttpUrl(url.trim()) ? onUrl(url.trim()) : setError("Enter the image's full web address, starting with https://"))}
      >
        Insert
      </button>
      {error ? (
        <small className="is-error">{error}</small>
      ) : (
        <small>
          For maps and infographics, export them as PNG or JPEG. You can also paste or drag a picture straight into the article. Large files are shrunk automatically to fit; click an image afterwards
          to resize it or add a caption.
        </small>
      )}
    </ToolPanel>
  );
}

/** Accepts either a plain address or a site's "embed code" (an iframe
 *  snippet) and returns the address inside it. */
export function extractEmbedUrl(input: string): string | null {
  const text = input.trim();
  const fromCode = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(text)?.[1];
  const url = (fromCode ?? text).replace(/&amp;/g, "&").trim();
  return isHttpsUrl(url) ? url : null;
}

function EmbedPanel({ onInsert }: { onInsert: (src: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <ToolPanel>
      <span>Embed</span>
      <textarea
        className="spotlight-input"
        style={{ flex: "1 1 420px", minHeight: 58 }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the embed code or the address of an interactive map, chart or dashboard"
        autoFocus
      />
      <button
        type="button"
        className="spotlight-btn spotlight-btn--small spotlight-btn--primary"
        onClick={() => {
          const src = extractEmbedUrl(value);
          if (src) onInsert(src);
          else setError("That is not an embed code or an address starting with https://");
        }}
      >
        Insert
      </button>
      {error ? (
        <small className="is-error">{error}</small>
      ) : (
        <small>
          Works with anything that offers “Embed” or “Share → Embed”: Datawrapper, Flourish, Google My Maps, ArcGIS Online, Felt, Power BI, Tableau Public, YouTube. Paste what that site gives you.
          Some sites refuse to be shown inside other pages; if the box stays blank, that site does not allow it.
        </small>
      )}
    </ToolPanel>
  );
}

function DashboardPanel({ onInsert }: { onInsert: (token: string, name: string) => void }) {
  const [dashboards, setDashboards] = useState<CustomDashboard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getCustomDashboards()
      .then(setDashboards)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your dashboards."));
  }, []);

  async function shareAndInsert(d: CustomDashboard) {
    setBusy(true);
    try {
      const shared = await api.updateCustomDashboard(d.id, { is_public: true });
      if (!shared.share_token) throw new Error("The dashboard could not be shared.");
      onInsert(shared.share_token, shared.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The dashboard could not be shared.");
      setBusy(false);
    }
  }

  return (
    <ToolPanel>
      <span>Live dashboard</span>
      {error && <small className="is-error">{error}</small>}
      {!dashboards && !error && <small>Loading your dashboards…</small>}
      {dashboards && dashboards.length === 0 && <small>You have no dashboards yet. Build one under Trends &amp; Patterns, then come back here to place it in the article.</small>}
      {dashboards && dashboards.length > 0 && (
        <ul className="spotlight-picklist">
          {dashboards.map((d) => {
            const shared = d.is_public && !!d.share_token;
            return (
              <li key={d.id}>
                <span>
                  <strong>{d.name}</strong>
                  <em>
                    {d.widgets.length} widget{d.widgets.length === 1 ? "" : "s"}, {shared ? "shared live" : "not shared yet"}
                  </em>
                </span>
                {shared ? (
                  <button type="button" className="spotlight-btn spotlight-btn--small spotlight-btn--primary" onClick={() => onInsert(d.share_token!, d.name)}>
                    Insert
                  </button>
                ) : confirming === d.id ? (
                  <button type="button" className="spotlight-btn spotlight-btn--small spotlight-btn--primary" disabled={busy} onClick={() => shareAndInsert(d)}>
                    {busy ? "Sharing…" : "Share live and insert"}
                  </button>
                ) : (
                  <button type="button" className="spotlight-btn spotlight-btn--small" onClick={() => setConfirming(d.id)}>
                    Insert
                  </button>
                )}
                {confirming === d.id && !shared && (
                  <small>To appear in an article this dashboard has to be shared live, which means anyone who has its link can view it. Readers of the article see it update on its own.</small>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ToolPanel>
  );
}
