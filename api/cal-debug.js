export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId) return res.json({ error: 'GOOGLE_CLIENT_ID not set' });
  if (!clientSecret) return res.json({ error: 'GOOGLE_CLIENT_SECRET not set' });
  if (!refreshToken) return res.json({ error: 'GOOGLE_REFRESH_TOKEN not set' });

  // Step 1: get access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return res.json({ step: 'token', error: tokenData });

  const headers = { Authorization: `Bearer ${tokenData.access_token}` };

  // Step 2: list calendars
  const calListRes = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50',
    { headers }
  );
  const calList = await calListRes.json();
  if (!calList.items) return res.json({ step: 'calendarList', error: calList });

  const calIds = calList.items.map(c => ({ id: c.id, summary: c.summary }));

  // Step 3: fetch events from primary
  const now    = new Date().toISOString();
  const cutoff = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  const evRes  = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${cutoff}&singleEvents=true&orderBy=startTime&maxResults=10`,
    { headers }
  );
  const evData = await evRes.json();

  res.json({
    calendars: calIds,
    primaryEvents: evData.items?.map(e => ({ summary: e.summary, start: e.start })) || [],
    primaryError: evData.error || null,
  });
}
