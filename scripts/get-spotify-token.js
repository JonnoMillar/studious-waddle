#!/usr/bin/env node
/**
 * Get a fresh Spotify OAuth refresh token for the dashboard.
 *
 * Run: node scripts/get-spotify-token.js
 * (Client ID/Secret can also be passed via SPOTIFY_CLIENT_ID /
 *  SPOTIFY_CLIENT_SECRET env vars to skip the prompts.)
 *
 * The registered redirect URI in the Spotify app settings must be
 * exactly http://127.0.0.1:8888/callback — Spotify no longer accepts
 * http://localhost for new apps.
 *
 * Then paste the printed refresh token into Vercel:
 * Project → Settings → Environment Variables → SPOTIFY_REFRESH_TOKEN
 * and redeploy.
 *
 * Get your Client ID and Secret from:
 * https://developer.spotify.com/dashboard
 */

import https from 'https';
import http  from 'http';
import { exec } from 'child_process';
import { createInterface } from 'readline';

let CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
let CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  const rl  = createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));
  CLIENT_ID     = CLIENT_ID     || (await ask('Spotify Client ID: ')).trim();
  CLIENT_SECRET = CLIENT_SECRET || (await ask('Spotify Client Secret: ')).trim();
  rl.close();
}

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPE        = 'user-read-currently-playing user-read-recently-played user-top-read';

const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8888');
  if (url.pathname !== '/callback') { res.statusCode = 404; res.end(); return; }

  const err = url.searchParams.get('error');
  if (err) {
    res.end(`<h2>Spotify returned an error: ${err}</h2>`);
    console.error('❌ Authorisation error:', err);
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  if (!code) { res.end('No code received.'); return; }
  res.end('<h2>Authorised! You can close this window.</h2>');
  server.close();

  const params = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const tokenReq = https.request({
    hostname: 'accounts.spotify.com',
    path:     '/api/token',
    method:   'POST',
    headers:  {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
  }, tokenRes => {
    let body = '';
    tokenRes.on('data', d => body += d);
    tokenRes.on('end', () => {
      const data = JSON.parse(body);
      if (data.refresh_token) {
        console.log('\n✅ Your new refresh token:\n');
        console.log('REFRESH_TOKEN=' + data.refresh_token);
        console.log('\nGranted scopes:', data.scope);
        console.log('\nPaste into Vercel → Settings → Env Vars → SPOTIFY_REFRESH_TOKEN → Redeploy\n');
      } else {
        console.error('❌ No refresh token:', data);
        process.exitCode = 1;
      }
    });
  });
  tokenReq.write(params.toString());
  tokenReq.end();
});

server.listen(8888, '127.0.0.1', () => {
  console.log('\nOpening browser...\nIf it does not open, paste this URL manually:\n');
  console.log(authUrl + '\n');
  const cmd = process.platform === 'win32' ? `start "" "${authUrl}"` :
              process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(cmd);
});
