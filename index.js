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
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const userSessions = {};

async function logUserAccess(userId, displayName) {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  const sheetName = 'Sheet3';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A:C`
  });

  const values = res.data.values || [];
  const rowIndex = values.findIndex(row => row[1] === userId);

  if (rowIndex >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A${rowIndex + 1}:C${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[displayName, userId, now]]
      }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A:C`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[displayName, userId, now]]
      }
    });
  }
}

app.post('/webhook', middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(async (event) => {
    if (event.type === 'message' && event.message.type === 'text') {
      const replyToken = event.replyToken;
      const userId = event.source?.userId;
      const text = event.message.text;

      let displayName = userId;
      try {
        const profile = await client.getProfile(userId);
        displayName = profile.displayName;
      } catch (e) {}

      await logUserAccess(userId, displayName);

      try {
        const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
        const blockRes = await sheets.spreadsheets.values.get({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: 'Sheet2!A:A'
        });
        const blockedUsers = (blockRes.data.values || []).flat();
        if (blockedUsers.includes(userId)) {
          await client.replyMessage(replyToken, {
            type: 'text',
            text: '🚫 คุณไม่มีสิทธิ์ใช้งาน กรุณาติดต่อ Admin'
          });
          return;
        }
      } catch (err) {
        console.error('ตรวจสอบ blacklist ล้มเหลว:', err);
      }

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
