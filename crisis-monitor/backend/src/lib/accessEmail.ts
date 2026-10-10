/**
 * The reply a person gets after asking for access: a branded, plain-spoken
 * confirmation signed by the Managing Director. Everything taken from the
 * form is escaped before it goes into the HTML.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const ACCESS_INBOX = "info@afrilensconsulting.com";
export const SIGNATORY = {
  name: "Simon Mutie",
  title: "Managing Director",
  company: "Afrilens Consulting",
  place: "Nairobi, Kenya",
  phone: "+254 716 770 354",
  email: "simon.mutie@afrilensconsulting.com",
  web: "afrilensconsulting.com",
};

const STEPS: [string, string][] = [
  ["We review your request", "A member of our team reads it personally and looks at how The Lens can serve your organisation."],
  ["We get in touch", "We contact you at this email address to talk through your needs and the access that fits them."],
  ["You are set up", "Your secure logins are created, with guidance on getting the most from the platform from day one."],
];

const OFFER = [
  "Live conflict-escalation monitoring across Africa and the Middle East, with sourced assessments",
  "Province-level maps, economic and market indicators, and standing hotspot tracking",
  "Custom monitoring queries and alerts delivered to your team",
  "Analysis from conflict specialists, not just automated feeds",
];

export function accessReplyEmail(name: string) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const subject = "Thank you for contacting Afrilens Consulting";
  const s = SIGNATORY;

  const text = [
    `Dear ${first},`,
    "",
    "Thank you for your interest in The Lens, Afrilens Consulting's crisis-monitoring platform. We have received your request for access, and we will be in touch as soon as possible.",
    "",
    "What happens next",
    ...STEPS.map(([h, b], i) => `${i + 1}. ${h}: ${b}`),
    "",
    "What The Lens gives your team",
    ...OFFER.map((o) => `- ${o}`),
    "",
    "If your matter is urgent, call me directly on the number below.",
    "",
    "Kind regards,",
    "",
    s.name,
    `${s.title}, ${s.company}`,
    s.place,
    `Tel: ${s.phone}`,
    `Email: ${s.email}`,
    s.web,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f5;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1d2733;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">
  <tr><td style="background:#0b1a2b;padding:26px 32px;">
    <div style="font-size:12px;letter-spacing:3px;color:#c9a24a;font-weight:600;">AFRILENS CONSULTING</div>
    <div style="font-size:24px;color:#ffffff;font-weight:600;margin-top:8px;line-height:1.3;">Thank you for getting in touch</div>
  </td></tr>
  <tr><td style="padding:30px 32px 8px;font-size:15px;line-height:1.65;">
    <p style="margin:0 0 14px;">Dear ${esc(first)},</p>
    <p style="margin:0 0 14px;">Thank you for your interest in <strong>The Lens</strong>, Afrilens Consulting's crisis-monitoring platform. We have received your request for access, and <strong>we will be in touch as soon as possible.</strong></p>
  </td></tr>
  <tr><td style="padding:6px 32px 8px;">
    <div style="font-size:12px;letter-spacing:2px;color:#8a6d1f;font-weight:700;margin-bottom:10px;">WHAT HAPPENS NEXT</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${STEPS.map(
      ([h, b], i) => `<tr><td width="34" valign="top" style="padding:0 0 12px;"><div style="width:26px;height:26px;border-radius:13px;background:#0b1a2b;color:#c9a24a;font-weight:700;font-size:13px;line-height:26px;text-align:center;">${i + 1}</div></td><td style="padding:0 0 12px;font-size:14px;line-height:1.55;"><strong>${h}</strong><br><span style="color:#4a5666;">${b}</span></td></tr>`
    ).join("")}
    </table>
  </td></tr>
  <tr><td style="padding:8px 32px 8px;">
    <div style="background:#f6f2e7;border-left:3px solid #c9a24a;padding:16px 18px;border-radius:4px;">
      <div style="font-size:12px;letter-spacing:2px;color:#8a6d1f;font-weight:700;margin-bottom:8px;">WHAT THE LENS GIVES YOUR TEAM</div>
      <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#2b3645;">${OFFER.map((o) => `<li>${o}</li>`).join("")}</ul>
    </div>
  </td></tr>
  <tr><td style="padding:18px 32px 6px;font-size:15px;line-height:1.65;">
    <p style="margin:0 0 18px;">If your matter is urgent, please call me directly on the number below.</p>
    <p style="margin:0;">Kind regards,</p>
  </td></tr>
  <tr><td style="padding:14px 32px 30px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-top:2px solid #c9a24a;padding-top:12px;"><tr><td style="padding-top:12px;font-size:14px;line-height:1.6;">
      <div style="font-size:17px;font-weight:700;color:#0b1a2b;">${s.name}</div>
      <div style="color:#4a5666;">${s.title}, ${s.company}</div>
      <div style="color:#4a5666;margin-bottom:6px;">${s.place}</div>
      <div><span style="color:#8a6d1f;font-weight:600;">T</span>&nbsp; <a href="tel:+254716770354" style="color:#1d2733;text-decoration:none;">${s.phone}</a></div>
      <div><span style="color:#8a6d1f;font-weight:600;">E</span>&nbsp; <a href="mailto:${s.email}" style="color:#1d2733;text-decoration:none;">${s.email}</a></div>
      <div><span style="color:#8a6d1f;font-weight:600;">W</span>&nbsp; <a href="https://${s.web}" style="color:#1d2733;text-decoration:none;">${s.web}</a></div>
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#f5f7fa;padding:14px 32px;font-size:11.5px;color:#7a8696;line-height:1.5;">
    You are receiving this because a request for access to The Lens was made with this email address. If this was not you, you can ignore this message and no account will be created.
  </td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text, replyTo: s.email };
}
