// Email delivery via Brevo (free tier, 300/day). API-key based so it works
// from serverless hosts (no SMTP connections). Without BREVO_API_KEY the
// mailer runs in DEV mode: the verification link is printed to the server
// console instead of being sent, so local flows keep working.
//
// Env:
//   BREVO_API_KEY  - Brevo API key (Settings > SMTP & API > API keys)
//   MAIL_FROM      - verified Brevo sender address, e.g. "noreply@you.nl"
//   MAIL_FROM_NAME - optional display name (default "Sus URL Shortener")

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

export function mailerConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

function verificationEmailHtml(username, link) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto">
      <h1 style="font-size:20px">Verify your sus:// account</h1>
      <p>Hi ${escapeHtml(username)}, one click and your account is fully armed:</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#c8f135;color:#191817;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">
          Verify my email
        </a>
      </p>
      <p style="color:#6b6560;font-size:13px">
        The link expires in 24 hours. If you didn't sign up, ignore this email — no account was created without your click.
      </p>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Send the verification link. Returns { dev: true, link } in dev mode
 * (no API key) so local tooling can surface the link in the response.
 */
export async function sendVerificationEmail({ email, username, link }) {
  if (!mailerConfigured()) {
    console.log(`[mailer:dev] verification link for ${email}: ${link}`);
    return { dev: true, link };
  }
  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: process.env.MAIL_FROM_NAME || "Sus URL Shortener", email: process.env.MAIL_FROM },
      to: [{ email }],
      subject: "Verify your sus:// account",
      htmlContent: verificationEmailHtml(username, link),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return { dev: false };
}
