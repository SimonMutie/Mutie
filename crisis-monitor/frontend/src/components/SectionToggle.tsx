import { useState, type ReactNode } from "react";

/**
 * A section on the Kenya and South Sudan pages can be hidden by its reader.
 * The heading always stays, so the page still reads in order and the reader
 * can open the section again. The choice lasts for the visit only.
 */
export function SectionFrame({
  id,
  prefix,
  kicker,
  title,
  intro,
  children,
}: {
  id: string;
  prefix: string;
  kicker: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = `${prefix}-${id}-body`;
  return (
    <section className={`el-section${open ? "" : " is-collapsed"}`} id={`${prefix}-${id}`}>
      <p className="el-kicker">{kicker}</p>
      <h2>{title}</h2>
      <button
        type="button"
        className="el-sec-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="el-sec-toggle__chev" aria-hidden="true">▾</span>
        {open ? "Hide section" : "Show section"}
      </button>
      <div id={bodyId} className="el-sec-body" hidden={!open}>
        {intro && <div className="el-intro">{intro}</div>}
        {children}
      </div>
    </section>
  );
}
