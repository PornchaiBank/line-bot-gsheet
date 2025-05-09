const express = require('express');
const { google } = require('googleapis');
const { Client, middleware } = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const credPath = path.join(__dirname, 'credentials.json');
if (process.env.GOOGLE_CREDENTIALS && !fs.existsSync(credPath)) {
  fs.writeFileSync(credPath, Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64'));
}

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

const userSessions = {};

app.post('/webhook', middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(async (event) => {
    if (event.type === 'message' && event.message.type === 'text') {
      const replyToken = event.replyToken;
      const userId = event.source?.userId;
      const text = event.message.text;

      const nextMatch = text.match(/^next:(\d+)$/i);
      if (nextMatch) {
        const page = parseInt(nextMatch[1], 10);
        const session = userSessions[userId];
        if (session && session.pages[page]) {
          const maxPage = session.pages.length - 1;
          const nextPage = page < maxPage ? page + 1 : null;

          const response = {
            type: 'flex',
            altText: `📌 หน้า ${page + 1}/${session.pages.length}`,
            contents: {
              type: 'carousel',
              contents: session.pages[page]
            }
          };

          if (nextPage !== null) {
            await client.replyMessage(replyToken, [
              response,
              {
                type: 'template',
                altText: '📌 หน้าถัดไป',
                template: {
                  type: 'buttons',
                  title: `หน้า ${page + 1}/${session.pages.length}`,
                  text: 'ดูหน้าถัดไป',
                  actions: [
                    {
                      type: 'message',
                      label: '▶️ ถัดไป',
                      text: `next:${nextPage}`
                    }
                  ]
                }
              }
            ]);
          } else {
            await client.replyMessage(replyToken, response);
          }
          session.currentPage = page;
          return;
        }
      }

      try {
        const message = await searchSheet(text, userId);
        await client.replyMessage(replyToken, message);
      } catch (err) {
        console.error('Reply failed, trying push:', err);
        if (userId) {
          const fallback = await searchSheet(text, userId);
          await client.pushMessage(userId, fallback);
        }
      }
    }
  })).then(() => res.sendStatus(200));
});

async function searchSheet(keyword, userId = null) {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sheet1!A:F'
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return { type: 'text', text: '❌ ไม่พบข้อมูลในตาราง' };

  const dataRows = rows.slice(1);
  const keywordLower = keyword.toLowerCase();
  const exactMatches = dataRows.filter(row => row[0]?.toLowerCase() === keywordLower);
  if (exactMatches.length > 0) {
    return buildFormDetailMessage(keyword, exactMatches);
  }

  const fuse = new Fuse(dataRows, {
    keys: ['0'],
    threshold: 0.4,
    ignoreLocation: true,
    isCaseSensitive: false
  });
  const fuzzyResult = fuse.search(keyword);
  if (!fuzzyResult.length) return { type: 'text', text: '❌ ไม่พบข้อมูลที่เกี่ยวข้องกับคำค้นนี้' };

  const matchedForms = [...new Set(fuzzyResult.map(r => r.item[0]))].sort();
  const allBubbles = matchedForms.map(code => {
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
              label: '🔍 ดูรายละเอียด',
              text: code
            },
            height: 'sm',
            color: '#0FA3B1'
          }
        ]
      }
    };
  });

  const chunkSize = 12;
  const chunks = [];
  for (let i = 0; i < allBubbles.length; i += chunkSize) {
    chunks.push(allBubbles.slice(i, i + chunkSize));
  }

  if (userId) {
    userSessions[userId] = {
      pages: chunks,
      currentPage: 0
    };
  }

  const response = {
    type: 'flex',
    altText: '📌 พบหลายฟอร์ม กรุณาเลือก',
    contents: {
      type: 'carousel',
      contents: chunks[0]
    }
  };

  if (chunks.length > 1) {
    return [
      response,
      {
        type: 'template',
        altText: '📌 หน้าถัดไป',
        template: {
          type: 'buttons',
          title: `หน้า 1/${chunks.length}`,
          text: 'ดูหน้าถัดไป',
          actions: [
            {
              type: 'message',
              label: '▶️ ถัดไป',
              text: `next:1`
            }
          ]
        }
      }
    ];
  }

  return response;
}

function buildFormDetailMessage(keyword, filtered) {
  const groupByField = (index) => [...new Set(filtered.map(row => row[index]).filter(Boolean))];

  const formName = filtered[0][1];
  const stored = groupByField(2);
  const view = groupByField(3);
  const table = groupByField(4);
  const report = groupByField(5);

  const message = `📋 ฟอร์ม ${keyword}: ${formName}

🗂️ Stored\n${stored.map(s => `🔹 ${s}`).join('\n')}

🖥️ View\n${view.map(v => `🔸 ${v}`).join('\n')}

📊 Table\n${table.map(t => `▪️ ${t}`).join('\n')}

📑 Report\n${report.map(r => `📄 ${r}`).join('\n')}`;

  return {
    type: 'text',
    text: message
  };
}

app.listen(port, () => {
  console.log(`✅ LINE Bot running at http://localhost:${port}`);
});