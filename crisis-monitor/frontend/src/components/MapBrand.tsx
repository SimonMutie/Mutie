import type { CSSProperties } from "react";
import Logo from "./Logo";
import { mapClientLogo } from "../mapProvider";
import { logoSvg } from "../lib/brandLogo";

/**
 * The Lens's own mark on its maps, in place of the map provider's logo (MapTiler's paid plans allow it), with the
 * signed-in client's logo beside it when the client has one. The provider's text credit (© MapTiler © OpenStreetMap
 * contributors) stays in the map's attribution corner, as its terms require.
 */
export default function MapBrand({ small = false, style }: { small?: boolean; style?: CSSProperties }) {
  const client = mapClientLogo();
  const mark = small ? 16 : 22;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 10,
        bottom: 10,
        zIndex: 440,
        display: "flex",
        alignItems: "center",
        gap: small ? 5 : 7,
        padding: small ? "3px 6px" : "4px 9px 4px 5px",
        borderRadius: 8,
        background: "rgba(6, 10, 18, 0.62)",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(4px)",
        pointerEvents: "none",
        userSelect: "none",
        ...style,
      }}
    >
      <Logo size={mark} standalone />
      {!small && <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.02em", color: "#e6edf7" }}>The <span style={{ color: "#14b8a6" }}>Lens</span></span>}
      {client && (
        <>
          <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.18)" }} />
          <img src={client} alt="" style={{ height: mark, maxWidth: mark * 3, objectFit: "contain" }} />
        </>
      )}
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

/** A saved map image with the same branding drawn into its bottom-left corner. Returns a PNG data address. */
export async function brandMapImage(dataUrl: string): Promise<string> {
  const base = await loadImage(dataUrl);
  const c = document.createElement("canvas");
  c.width = base.naturalWidth;
  c.height = base.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(base, 0, 0);
  const scale = Math.max(1, c.width / 1400);
  const mark = Math.round(30 * scale), pad = Math.round(10 * scale);
  const logo = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg())}`);
  let client: HTMLImageElement | null = null;
  const clientUrl = mapClientLogo();
  if (clientUrl) client = await loadImage(clientUrl).catch(() => null);
  ctx.font = `700 ${Math.round(15 * scale)}px system-ui, sans-serif`;
  const text = "The Lens";
  const textW = ctx.measureText(text).width;
  const clientW = client ? Math.min(mark * 3, (client.naturalWidth / client.naturalHeight) * mark) : 0;
  const w = pad + mark + pad * 0.8 + textW + (client ? pad * 1.6 + clientW : 0) + pad;
  const h = mark + pad * 1.2;
  const x = pad * 1.5, y = c.height - h - pad * 1.5;
  ctx.fillStyle = "rgba(6, 10, 18, 0.72)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8 * scale);
  ctx.fill();
  ctx.drawImage(logo, x + pad, y + pad * 0.6, mark, mark);
  ctx.fillStyle = "#e6edf7";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + pad + mark + pad * 0.8, y + h / 2);
  if (client) {
    const cx = x + pad + mark + pad * 0.8 + textW + pad * 0.8;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(cx, y + pad * 0.6, Math.max(1, scale), mark);
    try {
      ctx.drawImage(client, cx + pad * 0.8, y + pad * 0.6, clientW, mark);
    } catch {
      /* unreadable logo: leave it out */
    }
  }
  try {
    return c.toDataURL("image/png");
  } catch {
    // A client logo from another site without image permissions spoils the canvas: save without it.
    return dataUrl;
  }
}
