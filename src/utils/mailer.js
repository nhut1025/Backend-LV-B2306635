// src/utils/mailer.js
//
// Helper gửi email. Nếu đã cấu hình SMTP_HOST/SMTP_USER/SMTP_PASS trong .env
// -> gửi email thật qua nodemailer. Nếu CHƯA cấu hình -> in link ra console,
// để bạn test được toàn bộ luồng mà không cần tài khoản email thật.

const nodemailer = require('nodemailer');

function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail({ to, subject, html, devLabel }) {
  if (!isSmtpConfigured()) {
    console.log(`\n📧 [DEV MODE - chưa cấu hình SMTP] ${devLabel || subject}`);
    console.log(`   Gửi tới: ${to}`);
    console.log(`   Nội dung HTML:\n${html}\n`);
    return;
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

async function sendVerificationEmail(toEmail, verifyLink) {
  await sendMail({
    to: toEmail,
    subject: 'Xác thực email — Quán Ăn',
    devLabel: 'Link xác thực email:',
    html: `
      <p>Cảm ơn bạn đã đăng ký tài khoản tại Quán Ăn.</p>
      <p><a href="${verifyLink}">Bấm vào đây để xác thực email</a> (link có hiệu lực trong 24 giờ).</p>
      <p>Nếu không phải bạn đăng ký, hãy bỏ qua email này.</p>
      <p>Link đầy đủ: ${verifyLink}</p>
    `,
  });
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  await sendMail({
    to: toEmail,
    subject: 'Đặt lại mật khẩu — Quán Ăn',
    devLabel: 'Link đặt lại mật khẩu:',
    html: `
      <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
      <p><a href="${resetLink}">Bấm vào đây để đặt lại mật khẩu</a> (link có hiệu lực trong 1 giờ).</p>
      <p>Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>
      <p>Link đầy đủ: ${resetLink}</p>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
