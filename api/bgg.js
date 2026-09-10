// Vercel Serverless Function: /api/bgg
// BoardGameGeek XMLAPI2 호출 프록시 (CORS 및 인증 처리)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400'); // 1시간 캐싱

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { endpoint, query, id } = req.query;
  let targetUrl = '';

  if (endpoint === 'search' && query) {
    targetUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`;
  } else if (endpoint === 'thing' && id) {
    targetUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${id}&stats=1`;
  } else {
    return res.status(400).json({ error: 'Invalid parameters. Use endpoint=search&query=... or endpoint=thing&id=...' });
  }

  try {
    const headers = {
      'User-Agent': 'BoardGameManager/1.0 (Vercel Serverless)'
    };
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    const response = await fetch(targetUrl, { headers });
    const xmlText = await response.text();

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(xmlText);
  } catch (error) {
    console.error('BGG API proxy error:', error);
    return res.status(500).json({ error: 'Failed to fetch from BGG', details: error.message });
  }
}
