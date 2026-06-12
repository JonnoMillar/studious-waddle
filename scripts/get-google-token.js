#!/usr/bin/env node
/**
 * Get a fresh Google OAuth refresh token for the dashboard.
 *
 * Run: node scripts/get-google-token.js
 *
 * Then paste the printed refresh token into Vercel:
 * Project → Settings → Environment Variables → GOOGLE_REFRESH_TOKEN
 * and redeploy.
 *
 * Get your Client ID and Secret from:
 * https://console.cloud.google.com → APIs & Services → Clients
 */

import https from 'https';
import http  from 'http';
import { exec }     from 'child_process';
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, res));

const CLIENT_ID     = await ask('Google Client ID: ');
const CLIENT_SECRET = await ask('Google Client Secret: ');
rl.close();

const REDIRECT_URI = 'http://127.0.0.1:8989/callback';
const SCOPE        = 'https://www.googleapis.com/auth/calendar.readonly';

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, `http://127.0.0.1:8989`);
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code received.'); return; }
  res.end('<h2>Authorised! You can close this window.</h2>');
  server.close();

  const params = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code',
  });

  const tokenReq = https.request({
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, tokenRes => {
    let body = '';
    tokenRes.on('data', d => body += d);
    tokenRes.on('end', () => {
      const data = JSON.parse(body);
      if (data.refresh_token) {
        console.log('\n✅ Your new refresh token:\n');
        console.log(data.refresh_token);
        console.log('\nPaste into Vercel → Settings → Env Vars → GOOGLE_REFRESH_TOKEN → Redeploy\n');
      } else {
        console.error('❌ No refresh token:', data);
      }
    });
  });
  tokenReq.write(params.toString());
  tokenReq.end();
});

server.listen(8989, '127.0.0.1', () => {
  console.log('\nOpening browser...\nIf it does not open, paste this URL manually:\n');
  console.log(authUrl + '\n');
  const cmd = process.platform === 'win32' ? `start "" "${authUrl}"` :
              process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(cmd);
});

const REDIRECT_URI  = 'http://127.0.0.1:8989/callback';
const SCOPE         = 'https://www.googleapis.com/auth/calendar.readonly';

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;

// Start a temporary local server to catch the redirect
const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, `http://127.0.0.1:8989`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.end('No code received.');
    return;
  }

  res.end('<h2>Authorised! You can close this window.</h2>');
  server.close();

  // Exchange code for tokens
  const params = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code',
  });

  const tokenReq = https.request({
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, tokenRes => {
    let body = '';
    tokenRes.on('data', d => body += d);
    tokenRes.on('end', () => {
      const data = JSON.parse(body);
      if (data.refresh_token) {
        console.log('\n✅ Success! Your new refresh token:\n');
        console.log(data.refresh_token);
        console.log('\nPaste this into Vercel → Settings → Environment Variables → GOOGLE_REFRESH_TOKEN');
        console.log('Then redeploy the project.\n');
      } else {
        console.error('❌ No refresh token returned:', data);
      }
    });
  });

  tokenReq.write(params.toString());
  tokenReq.end();
});

server.listen(8989, '127.0.0.1', () => {
  console.log('Opening browser for Google authorisation...');
  // Open browser (works on Windows, Mac, Linux)
  const cmd = process.platform === 'win32' ? `start "${authUrl}"` :
              process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(cmd);
  console.log('\nIf the browser did not open, paste this URL manually:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorisation...');
});
