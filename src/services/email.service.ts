import nodemailer from 'nodemailer';
import { GMAIL_USER, GMAIL_APP_PASSWORD, FRONTEND_URL } from '../config/env';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

export async function sendVerificationEmail(to: string, rawToken: string): Promise<void> {
  const link = `${FRONTEND_URL}/verify-email?token=${rawToken}`;
  await transporter.sendMail({
    from: `"TERN" <${GMAIL_USER}>`,
    to,
    subject: 'Verify your TERN account',
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your TERN account</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#1a1a2e;padding:32px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:2px;">TERN</h1>
              <p style="margin:6px 0 0;color:#a0aec0;font-size:12px;letter-spacing:1px;text-transform:uppercase;">State &amp; Transition Model Creator</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 12px;color:#1a202c;font-size:20px;font-weight:600;">Confirm your email address</h2>
              <p style="margin:0 0 24px;color:#4a5568;font-size:15px;line-height:1.6;">
                Thanks for signing up! Please verify your email address to activate your account.
                This link will expire in <strong>24 hours</strong>.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 32px;">
                    <a href="${link}"
                       style="display:inline-block;background-color:#38a169;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 40px;border-radius:6px;letter-spacing:0.5px;">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#718096;font-size:13px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;word-break:break-all;">
                <a href="${link}" style="color:#38a169;font-size:13px;">${link}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background-color:#f7fafc;border-radius:0 0 8px 8px;">
              <p style="margin:0;color:#a0aec0;font-size:12px;line-height:1.6;">
                If you didn't create a TERN account, you can safely ignore this email — no action is needed.
              </p>
              <p style="margin:8px 0 0;color:#cbd5e0;font-size:11px;">&copy; ${new Date().getFullYear()} TERN. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  });
}
