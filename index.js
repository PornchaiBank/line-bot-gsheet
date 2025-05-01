const express = require('express');
const { google } = require('googleapis');
const { Client, middleware } = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ✅ แปลง GOOGLE_CREDENTIALS base64 → credentials.json
const credPath = path.join(__dirname, 'credentials.json');
if (process.env.GOOGLE_CREDENTIALS && !fs.existsSync(credPath)) {
  fs.writeFileSync(credPath, Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64'));
}

// LINE config
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

// Google Sheets Auth
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

// Webhook
app.post('/webhook', middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  console.log('Received event:', JSON.stringify(event));

  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const userText = event.message.text;
  const replyText = await searchSheet(userText);

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText
  });
}

async function searchSheet(keyword) {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sheet1!A:B'
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) return 'ไม่มีข้อมูลในตาราง';

  const fuse = new Fuse(rows, {
    keys: ['0'], // ค้นหาจาก column แรกของแต่ละ row
    threshold: 0.4,
    includeScore: true
  });

  const result = fuse.search(keyword);

  if (result.length > 0) {
    return result[0].item[1]; // column B ของ row ที่ match
  } else {
    return 'ขออภัย ไม่พบข้อมูลที่เกี่ยวข้อง';
  }
}

app.listen(port, () => console.log(`Running on ${port}`));