/**
 * Script to provision Samiksha Jhunjhunwala's account and dispatch a fully responsive,
 * ultra-aesthetic cyber dark welcome email with zero emojis.
 */
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from backend/.env or root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MEMBER_DATA = {
  name: 'Samiksha Jhunjhunwala',
  email: 'njg269574@mail.jiit.ac.in',
  roll_number: 'njg269574',
  batch: 'E4',
  branch: 'ECM',
  role: 'MEMBER',
  tempPassword: 'CICR_INVENTORY@1234'
};

async function provisionAndSendEmail() {
  console.log('================================================================');
  console.log('CICR // PROVISIONING USER ACCOUNT & DISPATCHING WELCOME EMAIL');
  console.log('Name:        ', MEMBER_DATA.name);
  console.log('Email:       ', MEMBER_DATA.email);
  console.log('Roll Number: ', MEMBER_DATA.roll_number);
  console.log('Batch/Branch:', MEMBER_DATA.batch, MEMBER_DATA.branch);
  console.log('Role:        ', MEMBER_DATA.role);
  console.log('Temp Pass:   ', MEMBER_DATA.tempPassword);
  console.log('================================================================\n');

  // 1. Hash temporary password
  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(MEMBER_DATA.tempPassword, salt);

  // 2. Check and upsert in Supabase
  console.log('[1/4] Querying Supabase database...');
  const { data: existingUser, error: checkErr } = await supabase
    .from('users')
    .select('id, name, email, roll_number, role')
    .or(`email.ilike.${MEMBER_DATA.email},roll_number.ilike.${MEMBER_DATA.roll_number}`)
    .maybeSingle();

  if (checkErr) {
    console.warn('[WARN] Error querying Supabase:', checkErr.message);
  }

  let finalUserId = null;

  if (existingUser) {
    console.log(`[INFO] User already exists (ID: ${existingUser.id}). Updating password hash & profile...`);
    const { data: updated, error: updErr } = await supabase
      .from('users')
      .update({
        name: MEMBER_DATA.name,
        email: MEMBER_DATA.email.toLowerCase(),
        roll_number: MEMBER_DATA.roll_number,
        role: MEMBER_DATA.role,
        password_hash
      })
      .eq('id', existingUser.id)
      .select('id')
      .single();

    if (updErr) {
      console.error('[ERROR] Failed to update user in Supabase:', updErr.message);
      process.exit(1);
    }
    finalUserId = updated.id;
    console.log('[OK] User record successfully updated in Supabase.');
  } else {
    console.log('[INFO] Inserting new user record into Supabase...');
    const { data: inserted, error: insErr } = await supabase
      .from('users')
      .insert([{
        name: MEMBER_DATA.name,
        email: MEMBER_DATA.email.toLowerCase(),
        roll_number: MEMBER_DATA.roll_number,
        role: MEMBER_DATA.role,
        password_hash,
        created_at: new Date().toISOString()
      }])
      .select('id')
      .single();

    if (insErr) {
      console.error('[ERROR] Insert failed in Supabase:', insErr.message);
      process.exit(1);
    }
    finalUserId = inserted.id;
    console.log(`[OK] User created successfully in Supabase (ID: ${finalUserId}).`);
  }

  // 3. Update local user_approval_data.json cache
  console.log('\n[2/4] Synchronizing approval cache in user_approval_data.json...');
  const approvalFile = path.resolve(__dirname, '../../user_approval_data.json');
  try {
    let approvalDoc = { approvalState: {}, purgedEmails: [] };
    if (fs.existsSync(approvalFile)) {
      approvalDoc = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
      if (!approvalDoc.approvalState) approvalDoc.approvalState = {};
      if (!approvalDoc.purgedEmails) approvalDoc.purgedEmails = [];
    }

    // Unpurge if purged
    approvalDoc.purgedEmails = approvalDoc.purgedEmails.filter(
      e => e.toLowerCase() !== MEMBER_DATA.email.toLowerCase()
    );

    // Set approval status
    approvalDoc.approvalState[MEMBER_DATA.email.toLowerCase()] = {
      status: 'APPROVED',
      role: 'MEMBER',
      approvedAt: new Date().toISOString(),
      approvedBy: 'ADMINISTRATOR PROVISIONING',
      name: MEMBER_DATA.name,
      roll_number: MEMBER_DATA.roll_number,
      batch: `${MEMBER_DATA.batch} ${MEMBER_DATA.branch}`
    };

    fs.writeFileSync(approvalFile, JSON.stringify(approvalDoc, null, 2), 'utf8');
    console.log('[OK] user_approval_data.json successfully synchronized.');
  } catch (err) {
    console.warn('[WARN] Failed to update user_approval_data.json:', err.message);
  }

  // 4. Record audit log
  console.log('\n[3/4] Recording system audit log...');
  try {
    await supabase.from('audit_logs').insert([{
      action: 'Account Provisioned',
      user_id: finalUserId,
      description: `Administrator provisioned student member account for ${MEMBER_DATA.name} (${MEMBER_DATA.email}) [Batch: ${MEMBER_DATA.batch} ${MEMBER_DATA.branch}, Role: ${MEMBER_DATA.role}]`,
      created_at: new Date().toISOString()
    }]);
    console.log('[OK] Audit log entry recorded.');
  } catch (err) {
    console.warn('[WARN] Audit log record skipped:', err.message);
  }

  // 5. Send aesthetic, fully responsive, zero-emoji email
  console.log('\n[4/4] Generating and dispatching responsive aesthetic email (ZERO EMOJIS)...');

  const smtpUser = process.env.SMTP_USER || 'cicrinventory@gmail.com';
  const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const portalUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://cicr-inventory.vercel.app/';

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    family: 4,
    tls: {
      rejectUnauthorized: false
    }
  });

  // Verify SMTP connection
  await transporter.verify();
  console.log('[OK] SMTP connection to Gmail verified successfully.');

  const emailHtml = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>CICR Inventory // Portal Access - Samiksha Jhunjhunwala</title>
  <style type="text/css">
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: #06080e;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #e2e8f0;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table {
      border-collapse: collapse !important;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      border: 0;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }
    a {
      text-decoration: none;
    }
    .wrapper-table {
      width: 100% !important;
      background-color: #06080e;
      margin: 0;
      padding: 36px 14px;
    }
    .container-table {
      max-width: 600px !important;
      width: 100% !important;
      margin: 0 auto;
      background-color: #0c101a;
      border: 1px solid #1a2333;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .mono-text {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace !important;
    }
    .cta-btn {
      display: inline-block;
      background-color: #00f0ff;
      color: #050811 !important;
      font-weight: 800;
      font-size: 13px;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      padding: 15px 36px;
      border-radius: 5px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
      text-align: center;
      text-decoration: none;
      transition: background-color 0.2s ease;
    }
    .cta-btn:hover {
      background-color: #38bdf8 !important;
    }
    .passcode-badge {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
      font-size: 21px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #00f0ff;
      background-color: #050811;
      display: inline-block;
      padding: 13px 26px;
      border-radius: 5px;
      border: 1px solid rgba(0, 240, 255, 0.4);
    }
    .feature-card {
      background-color: #080c14;
      border: 1px solid #1a2333;
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 10px;
    }
    @media only screen and (max-width: 600px) {
      .wrapper-table {
        padding: 16px 8px !important;
      }
      .container-table {
        width: 100% !important;
        border-radius: 6px !important;
      }
      .header-padding {
        padding: 20px 16px !important;
      }
      .content-padding {
        padding: 22px 16px !important;
      }
      .footer-padding {
        padding: 18px 16px !important;
      }
      .passcode-badge {
        font-size: 17px !important;
        letter-spacing: 1.2px !important;
        padding: 11px 18px !important;
        word-break: break-all !important;
      }
      .cta-btn {
        display: block !important;
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 14px 20px !important;
      }
      .spec-label {
        width: 120px !important;
      }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#06080e;">
  <table role="presentation" width="100%" class="wrapper-table" cellpadding="0" cellspacing="0" border="0" style="background-color:#06080e;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" class="container-table" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#0c101a;border:1px solid #1a2333;border-radius:10px;">
          
          <!-- Brand Header -->
          <tr>
            <td class="header-padding" style="padding:22px 28px;background-color:#090d16;border-bottom:1px solid #1a2333;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div class="mono-text" style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:15px;font-weight:800;color:#f8fafc;letter-spacing:1.8px;">
                      CICR <span style="color:#00f0ff;">//</span> INVENTORY
                    </div>
                    <div class="mono-text" style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:10.5px;color:#64748b;letter-spacing:0.8px;margin-top:3px;">
                      CENTRE FOR INNOVATION, CONTROL &amp; ROBOTICS
                    </div>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span class="mono-text" style="display:inline-block;padding:5px 10px;font-size:10px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-radius:3px;background:rgba(16,185,129,0.08);color:#10b981;border:1px solid rgba(16,185,129,0.28);">
                      [ ACCESS AUTHORIZED ]
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td class="content-padding" style="padding:28px;">

              <!-- Status Overline -->
              <div style="margin-bottom:14px;">
                <span class="mono-text" style="display:inline-block;padding:4px 10px;font-size:9.5px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;border-radius:3px;background:rgba(0,240,255,0.06);color:#00f0ff;border:1px solid rgba(0,240,255,0.25);">
                  // STUDENT ONBOARDING // PORTAL ACCESS
                </span>
              </div>

              <!-- Main Greeting Heading -->
              <h1 style="margin:0 0 10px 0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;letter-spacing:-0.3px;">
                Welcome to the CICR Vault, Samiksha
              </h1>
              <p style="margin:0 0 22px 0;font-size:13.5px;color:#94a3b8;line-height:1.65;">
                Your student membership profile has been authorized on the official <strong style="color:#ffffff;">CICR Robotics Inventory Portal</strong>. You now have complete access to explore lab hardware, submit component requests, and monitor your hardware loans.
              </p>

              <!-- Profile Details Matrix -->
              <div style="background-color:#080c14;border:1px solid #1a2333;border-radius:6px;padding:18px;margin-bottom:22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
                  <tr>
                    <td class="mono-text spec-label" style="padding:7px 0;color:#64748b;width:140px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:0.5px;">MEMBER NAME:</td>
                    <td style="padding:7px 0;color:#ffffff;font-weight:600;">Samiksha Jhunjhunwala</td>
                  </tr>
                  <tr>
                    <td class="mono-text spec-label" style="padding:7px 0;color:#64748b;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:0.5px;border-top:1px solid #121826;">COLLEGE EMAIL:</td>
                    <td class="mono-text" style="padding:7px 0;color:#00f0ff;font-weight:600;font-family:'SFMono-Regular',Consolas,Menlo,monospace;border-top:1px solid #121826;">njg269574@mail.jiit.ac.in</td>
                  </tr>
                  <tr>
                    <td class="mono-text spec-label" style="padding:7px 0;color:#64748b;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:0.5px;border-top:1px solid #121826;">ENROLLMENT ID:</td>
                    <td class="mono-text" style="padding:7px 0;color:#cbd5e1;font-family:'SFMono-Regular',Consolas,Menlo,monospace;border-top:1px solid #121826;">njg269574</td>
                  </tr>
                  <tr>
                    <td class="mono-text spec-label" style="padding:7px 0;color:#64748b;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:0.5px;border-top:1px solid #121826;">BATCH / BRANCH:</td>
                    <td style="padding:7px 0;color:#cbd5e1;border-top:1px solid #121826;">Batch E4 &bull; ECM</td>
                  </tr>
                  <tr>
                    <td class="mono-text spec-label" style="padding:7px 0;color:#64748b;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:0.5px;border-top:1px solid #121826;">DEPARTMENT:</td>
                    <td style="padding:7px 0;color:#cbd5e1;border-top:1px solid #121826;">Electronics &amp; Computer Engineering</td>
                  </tr>
                  <tr>
                    <td class="mono-text spec-label" style="padding:7px 0;color:#64748b;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:0.5px;border-top:1px solid #121826;">ACCESS LEVEL:</td>
                    <td style="padding:7px 0;color:#10b981;font-weight:600;border-top:1px solid #121826;">Student Member [Approved]</td>
                  </tr>
                </table>
              </div>

              <!-- Passcode Chamber -->
              <div style="background-color:rgba(0,240,255,0.03);border:1px solid rgba(0,240,255,0.25);border-radius:6px;padding:22px 18px;margin-bottom:24px;text-align:center;">
                <div class="mono-text" style="font-size:10.5px;font-weight:700;letter-spacing:1.8px;color:#00f0ff;text-transform:uppercase;margin-bottom:10px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;">
                  // INITIAL ACCESS PASSCODE
                </div>
                <div class="passcode-badge">
                  CICR_INVENTORY@1234
                </div>
                <div style="font-size:12px;color:#94a3b8;margin-top:12px;line-height:1.5;">
                  Authenticate using your official college email and this initial passcode.
                </div>
              </div>

              <!-- Interactive Call To Action Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 24px 0;">
                <tr>
                  <td align="center">
                    <a href="${portalUrl}" target="_blank" class="cta-btn">
                      OPEN CICR VAULT PORTAL
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Interactive Feature Highlights -->
              <div style="margin-bottom:22px;">
                <div class="mono-text" style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:#cbd5e1;text-transform:uppercase;margin-bottom:12px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;">
                  // PORTAL CAPABILITIES
                </div>

                <div class="feature-card">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="mono-text" style="vertical-align:top;width:48px;color:#00f0ff;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:12px;font-weight:700;padding-top:2px;">[01]</td>
                      <td>
                        <div style="font-size:13px;font-weight:600;color:#ffffff;margin-bottom:2px;">Hardware Catalog</div>
                        <div style="font-size:12px;color:#94a3b8;line-height:1.5;">Explore microcontrollers, drone accessories, LiDAR modules, sensors, and motor drivers in real time.</div>
                      </td>
                    </tr>
                  </table>
                </div>

                <div class="feature-card">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="mono-text" style="vertical-align:top;width:48px;color:#00f0ff;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:12px;font-weight:700;padding-top:2px;">[02]</td>
                      <td>
                        <div style="font-size:13px;font-weight:600;color:#ffffff;margin-bottom:2px;">Digital Requisition</div>
                        <div style="font-size:12px;color:#94a3b8;line-height:1.5;">Submit hardware requests directly from the portal with automated approval workflow and instant allocation.</div>
                      </td>
                    </tr>
                  </table>
                </div>

                <div class="feature-card">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="mono-text" style="vertical-align:top;width:48px;color:#00f0ff;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:12px;font-weight:700;padding-top:2px;">[03]</td>
                      <td>
                        <div style="font-size:13px;font-weight:600;color:#ffffff;margin-bottom:2px;">Loan Management</div>
                        <div style="font-size:12px;color:#94a3b8;line-height:1.5;">Track borrowed components, monitor return deadlines, and manage extensions transparently.</div>
                      </td>
                    </tr>
                  </table>
                </div>
              </div>

              <!-- Security Advisory Card -->
              <div style="background-color:#080c14;border-left:3px solid #38bdf8;padding:14px 16px;border-radius:4px;font-size:12px;color:#cbd5e1;line-height:1.6;">
                <strong style="color:#38bdf8;">Account Management:</strong> For your security, please sign in to the portal and customize your passcode under Account Settings upon initial access.
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="footer-padding" style="padding:22px 28px;background-color:#090d16;border-top:1px solid #1a2333;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:10.5px;color:#64748b;line-height:1.65;">
              <div class="mono-text" style="color:#94a3b8;font-weight:600;margin-bottom:3px;letter-spacing:0.8px;">
                CENTRE FOR INNOVATION, CONTROL &amp; ROBOTICS (CICR)
              </div>
              <div class="mono-text" style="color:#64748b;">
                Jaypee Institute of Information Technology &bull; Sector 128, Noida
              </div>
              <div class="mono-text" style="color:#475569;margin-top:6px;font-size:9.5px;letter-spacing:0.5px;">
                Automated System Transmission // No-Reply &bull; Reference: CICR-VAULT-2026 / NODE-128
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const plainText = [
    `CICR ROBOTICS // INVENTORY SYSTEM`,
    `================================================`,
    `Welcome to the CICR Vault, Samiksha Jhunjhunwala`,
    ``,
    `Your student membership account has been authorized.`,
    ``,
    `MEMBER SPECIFICATIONS:`,
    `- Name:        Samiksha Jhunjhunwala`,
    `- College ID:  njg269574@mail.jiit.ac.in`,
    `- Enrollment:  njg269574`,
    `- Batch:       E4`,
    `- Branch:      ECM (Electronics & Computer Engineering)`,
    `- Access:      Student Member [Approved]`,
    ``,
    `INITIAL ACCESS PASSCODE:`,
    `- Portal URL:          ${portalUrl}`,
    `- Login Email:         ${MEMBER_DATA.email}`,
    `- Passcode:            ${MEMBER_DATA.tempPassword}`,
    ``,
    `PORTAL CAPABILITIES:`,
    `[01] Hardware Catalog:    Browse microcontrollers, drone modules, sensors, and actuators.`,
    `[02] Digital Requisition: Submit hardware requests with automated approval workflows.`,
    `[03] Loan Management:    Track allocations and return schedules directly.`,
    ``,
    `SECURITY ADVISORY:`,
    `Please sign in and customize your passcode under Account Settings upon initial access.`,
    ``,
    `Regards,`,
    `Centre for Innovation, Control & Robotics (CICR)`,
    `Jaypee Institute of Information Technology, Sector 128`
  ].join('\n');

  const mailOptions = {
    from: `"CICR Lab Admin" <${smtpUser}>`,
    replyTo: `"CICR Lab Admin" <${smtpUser}>`,
    to: MEMBER_DATA.email,
    subject: `Welcome to CICR // Robotics Inventory Portal Access - Samiksha Jhunjhunwala`,
    text: plainText,
    html: emailHtml,
    priority: 'normal',
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'OOF, AutoReply'
    }
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('[SUCCESS] Email sent successfully!');
  console.log('Message ID: ', info.messageId);
  console.log('Accepted:   ', info.accepted);
  console.log('Response:   ', info.response);
  console.log('\n================================================================');
  console.log('ALL TASKS COMPLETED SUCCESSFULLY');
  console.log('================================================================');
}

provisionAndSendEmail().catch((err) => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
