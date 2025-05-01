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
  const replyContent = await searchSheet(userText);

  return client.replyMessage(event.replyToken, replyContent);
}

async function searchSheet(keyword) {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sheet1!A:E'
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return { type: 'text', text: 'ไม่มีข้อมูลในตาราง' };

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const fuse = new Fuse(dataRows, {
    keys: ['0'],
    threshold: 0.4
  });
  const fuzzyResult = fuse.search(keyword);
  if (!fuzzyResult.length) return { type: 'text', text: 'ไม่พบข้อมูลสำหรับคำค้นนี้' };

  const matchedForms = [...new Set(fuzzyResult.map(r => r.item[0]))].sort();
  if (matchedForms.length > 1) {
    const bubbles = matchedForms.slice(0, 12).map(code => {
      const name = dataRows.find(row => row[0] === code)?.[1] || '';
      return {
        type: 'bubble',
        size: 'kilo',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: `📄 ${code}`,
              weight: 'bold',
              size: 'md'
            },
            {
              type: 'text',
              text: name,
              size: 'sm',
              color: '#555555',
              wrap: true
            },
            {
              type: 'button',
              style: 'primary',
              action: {
                type: 'message',
                label: 'ดูรายละเอียด',
                text: code
              },
              height: 'sm',
              color: '#0FA3B1'
            }
          ]
        }
      };
    });

    return {
      type: 'flex',
      altText: 'กรุณาเลือกฟอร์มที่ต้องการ',
      contents: {
        type: 'carousel',
        contents: bubbles
      }
    };
  }

  const matchKeyword = fuzzyResult[0].item[0];
  const filtered = dataRows.filter(row => row[0] === matchKeyword);

  const groupByField = (index) => [...new Set(filtered.map(row => row[index]).filter(Boolean))];

  const formName = filtered[0][1];
  const stored = groupByField(2);
  const view = groupByField(3);
  const table = groupByField(4);

  const message = `📋 ฟอร์ม ${matchKeyword}: ${formName}

🗃️ Stored:\n${stored.map(s => `• ${s}`).join('\n')}

🧭 View:\n${view.map(v => `• ${v}`).join('\n')}

📂 Table:\n${table.map(t => `• ${t}`).join('\n')}`;

  return { type: 'text', text: message };
}

app.listen(port, () => console.log(`Running on ${port}`));
