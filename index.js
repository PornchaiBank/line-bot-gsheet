async function searchSheet(keyword, userId = null) {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sheet1!A:E'
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return { type: 'text', text: '❌ ไม่พบข้อมูลในตาราง' };

  const headers = rows[0];
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

  if (chunks.length === 1) {
    return {
      type: 'flex',
      altText: '📌 กรุณาเลือกฟอร์มที่ต้องการ',
      contents: {
        type: 'carousel',
        contents: chunks[0]
      }
    };
  } else {
    const firstMessage = {
      type: 'flex',
      altText: '📌 พบหลายฟอร์ม กรุณาเลือก',
      contents: {
        type: 'carousel',
        contents: chunks[0]
      }
    };
    if (userId) {
      for (let i = 1; i < chunks.length; i++) {
        const msg = {
          type: 'flex',
          altText: '📌 ฟอร์มเพิ่มเติม',
          contents: {
            type: 'carousel',
            contents: chunks[i]
          }
        };
        await client.pushMessage(userId, msg);
      }
    }
    return firstMessage;
  }
}
