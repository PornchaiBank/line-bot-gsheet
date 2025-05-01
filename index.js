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
  const flexContent = await searchSheet(userText);

  if (typeof flexContent === 'string') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: flexContent
    });
  } else {
    return client.replyMessage(event.replyToken, flexContent);
  }
}

async function searchSheet(keyword) {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sheet1!A:E'
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return 'ไม่มีข้อมูลในตาราง';

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const filtered = dataRows.filter(row => row[0] === keyword);
  if (filtered.length === 0) return 'ไม่พบข้อมูลสำหรับฟอร์มนี้';

  const groupByField = (index) => [...new Set(filtered.map(row => row[index]).filter(Boolean))];

  const formName = filtered[0][1];
  const stored = groupByField(2);
  const view = groupByField(3);
  const table = groupByField(4);

  return {
    type: 'flex',
    altText: `ข้อมูลของฟอร์ม ${keyword}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `ฟอร์ม ${keyword}: ${formName}`,
            weight: 'bold',
            size: 'lg',
            margin: 'md'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'text',
            text: 'Stored:',
            weight: 'bold',
            margin: 'md'
          },
          ...stored.map(s => ({ type: 'text', text: s, margin: 'sm' })),
          {
            type: 'text',
            text: 'View:',
            weight: 'bold',
            margin: 'md'
          },
          ...view.map(v => ({ type: 'text', text: v, margin: 'sm' })),
          {
            type: 'text',
            text: 'Table:',
            weight: 'bold',
            margin: 'md'
          },
          ...table.map(t => ({ type: 'text', text: t, margin: 'sm' }))
        ]
      }
    }
  };
}

app.listen(port, () => console.log(`Running on ${port}`));
