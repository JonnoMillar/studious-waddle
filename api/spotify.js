export const config = { maxDuration: 10 };

let cachedAccessToken = null;
let tokenExpiresAt    = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const { access_token, expires_in } = await r.json();
  if (!access_token) return null;
  cachedAccessToken = access_token;
  tokenExpiresAt    = Date.now() + (expires_in || 3600) * 1000;
  return access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = await getAccessToken();
  if (!token) {
    return res.json({ error: 'Spotify credentials not configured', nowPlaying: null, recentTrack: null, topTrack: null, topArtist: null });
  }

  const headers = { Authorization: `Bearer ${token}` };

  const [nowRes, recentRes, topTrackRes, topArtistRes] = await Promise.all([
    fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers }),
    fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', { headers }),
    fetch('https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=1', { headers }),
    fetch('https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=1', { headers }),
  ]);

  let nowPlaying = null;
  if (nowRes.status === 200) {
    try {
      const d = await nowRes.json();
      if (d?.item) nowPlaying = {
        name:      d.item.name,
        artist:    d.item.artists?.map(a => a.name).join(', ') || '',
        album:     d.item.album?.name || '',
        art:       d.item.album?.images?.[1]?.url || d.item.album?.images?.[0]?.url || '',
        url:       d.item.external_urls?.spotify || '',
        isPlaying: d.is_playing,
      };
    } catch (_) {}
  }

  let recentTrack = null;
  if (!nowPlaying && recentRes.status === 200) {
    try {
      const d = await recentRes.json();
      const t = d?.items?.[0]?.track;
      const playedAt = d?.items?.[0]?.played_at;
      if (t) recentTrack = {
        name:    t.name,
        artist:  t.artists?.map(a => a.name).join(', ') || '',
        album:   t.album?.name || '',
        art:     t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '',
        url:     t.external_urls?.spotify || '',
        minsAgo: playedAt ? Math.round((Date.now() - new Date(playedAt)) / 60000) : null,
      };
    } catch (_) {}
  }

  let topTrack = null;
  if (topTrackRes.status === 200) {
    try {
      const d = await topTrackRes.json();
      const t = d?.items?.[0];
      if (t) topTrack = {
        name:   t.name,
        artist: t.artists?.map(a => a.name).join(', ') || '',
        art:    t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '',
        url:    t.external_urls?.spotify || '',
      };
    } catch (_) {}
  }

  let topArtist = null;
  if (topArtistRes.status === 200) {
    try {
      const d = await topArtistRes.json();
      const a = d?.items?.[0];
      if (a) topArtist = {
        name:  a.name,
        genre: a.genres?.[0] || '',
        art:   a.images?.[1]?.url || a.images?.[0]?.url || '',
        url:   a.external_urls?.spotify || '',
      };
    } catch (_) {}
  }

  res.json({ nowPlaying, recentTrack, topTrack, topArtist });
}
