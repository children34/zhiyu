// api/index.js
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
// Serve static files (HTML, CSS, JS, images) from the project root directory
app.use(express.static(path.join(__dirname, '..')));

// Create transporter for SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify SMTP connection on startup
transporter.verify((error, success) => {
  if (error) console.error('SMTP 連線失敗:', error);
  else console.log('SMTP 已成功連線 ✅');
});

// POST /send-contact – 接收表單資料並寄送郵件
app.post('/send-contact', async (req, res) => {
  const { name, email, message } = req.body || {};

  // 基本欄位檢查
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: '欄位不可為空' });
  }

  const mailOptions = {
    from: `"${name}" <${process.env.SMTP_USER}>`,
    to: process.env.MAIL_TO,
    subject: `聯絡表單 – ${name}`,
    text: `姓名: ${name}\nEmail: ${email}\n\n訊息:\n${message}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (err) {
    console.error('寄信失敗:', err);
    res.status(500).json({ success: false, error: '寄信失敗，請稍後再試' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 後端 API 正在埠號 ${PORT} 上執行`);
});
