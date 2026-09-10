// Vercel Serverless Function: /api/sheets
// 구글 스프레드시트 CSV 데이터를 서버사이드에서 안전하게 가져와 반환 (브라우저 CORS 완전 해결)

const DEFAULT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTWcH2CPw1KzrlIZLTZ12uYABfTa7flyqg-EVwlZfIy2icyWJJ4TqSHN9WFGBbFKnrl9WPspzHchnbQ/pub?output=csv";

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=180'); // 1분 CDN 캐싱

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const csvUrl = req.query.url || DEFAULT_CSV_URL;
    const response = await fetch(csvUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Google Sheets responded with status ${response.status}`);
    }

    const csvText = await response.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(csvText);
  } catch (error) {
    console.error('Failed to fetch Google Sheets CSV:', error);
    return res.status(500).json({ error: 'Failed to fetch spreadsheet', details: error.message });
  }
}
