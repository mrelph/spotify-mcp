#!/usr/bin/env node

import {randomBytes} from 'node:crypto'
import {appendFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'

import dotenv from 'dotenv'
import express from 'express'
import open from 'open'
import SpotifyWebApi from 'spotify-web-api-node'

dotenv.config()

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8000/callback',
} = process.env

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error('Missing required environment variables:')
  console.error('   SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required')
  console.error('   Please set them in your .env file')
  process.exit(1)
}

const redirectUri = new URL(SPOTIFY_REDIRECT_URI)
if (redirectUri.hostname !== 'localhost' && redirectUri.hostname !== '127.0.0.1') {
  console.error('Error: Redirect URI must use localhost for automatic token exchange')
  console.error('   Example: http://127.0.0.1:8000/callback')
  process.exit(1)
}

const port = redirectUri.port || '8000'
const callbackPath = redirectUri.pathname || '/callback'

const state = randomBytes(16).toString('hex')

const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
})

const scopes = [
  'user-read-private',
  'user-top-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
]

const authParams = new URLSearchParams({
  client_id: SPOTIFY_CLIENT_ID,
  response_type: 'code',
  redirect_uri: SPOTIFY_REDIRECT_URI,
  scope: scopes.join(' '),
  state,
  show_dialog: 'true',
})

const authorizationUrl = `https://accounts.spotify.com/authorize?${authParams.toString()}`

/**
 * Persists or updates SPOTIFY_API_TOKEN / SPOTIFY_REFRESH_TOKEN in .env without
 * echoing the values to the terminal or the browser.
 */
function writeTokensToEnv(accessToken, refreshToken) {
  const envPath = resolve(process.cwd(), '.env')
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const lines = existing.split(/\r?\n/)
  const updates = {
    SPOTIFY_API_TOKEN: accessToken,
    SPOTIFY_REFRESH_TOKEN: refreshToken,
  }

  const seen = new Set()
  const rewritten = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/)
    if (match && updates[match[1]] !== undefined) {
      seen.add(match[1])
      return `${match[1]}=${updates[match[1]]}`
    }
    return line
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      rewritten.push(`${key}=${value}`)
    }
  }

  const out = rewritten.join('\n').replace(/\n+$/, '') + '\n'
  if (existing) {
    writeFileSync(envPath, out, {mode: 0o600})
  } else {
    appendFileSync(envPath, out, {mode: 0o600})
  }
}

const app = express()

app.get(callbackPath, async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const returnedState = typeof req.query.state === 'string' ? req.query.state : ''
  const error = typeof req.query.error === 'string' ? req.query.error : ''

  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'})

  if (error) {
    console.error('Authorization error')
    res.end(
      '<html><body><h1>Authentication Failed</h1><p>Please close this window and try again.</p></body></html>',
    )
    server.close()
    process.exit(1)
    return
  }

  if (returnedState !== state) {
    console.error('State mismatch error')
    res.end(
      '<html><body><h1>Authentication Failed</h1><p>State verification failed. Please close this window and try again.</p></body></html>',
    )
    server.close()
    process.exit(1)
    return
  }

  if (!code) {
    console.error('No authorization code received')
    res.end(
      '<html><body><h1>Authentication Failed</h1><p>No authorization code received. Please close this window and try again.</p></body></html>',
    )
    server.close()
    process.exit(1)
    return
  }

  try {
    console.error('Exchanging authorization code for tokens...')
    const data = await spotifyApi.authorizationCodeGrant(code)
    const {access_token, refresh_token, expires_in} = data.body

    writeTokensToEnv(access_token, refresh_token)
    console.error('Tokens written to .env (chmod 600). Expires in:', expires_in, 'seconds')

    res.end(
      '<html><body><h1>Authentication Successful</h1>' +
        '<p>Tokens have been saved to your local .env file. You can close this window.</p>' +
        '<script>setTimeout(() => window.close(), 3000);</script>' +
        '</body></html>',
    )

    setTimeout(() => {
      console.error('Shutting down OAuth server...')
      server.close()
      process.exit(0)
    }, 1500)
  } catch (err) {
    console.error('Error exchanging code for tokens:', err instanceof Error ? err.message : err)
    res.end(
      '<html><body><h1>Authentication Failed</h1><p>Failed to exchange authorization code for tokens. See terminal for details.</p></body></html>',
    )
    server.close()
    process.exit(1)
  }
})

app.use((_req, res) => {
  res.writeHead(404)
  res.end()
})

const server = app.listen(port, '127.0.0.1', () => {
  console.error('Spotify OAuth Helper started')
  console.error(`Callback server: http://127.0.0.1:${port}${callbackPath}`)
  console.error('Authorization URL (opening in browser):')
  console.error(`  ${authorizationUrl}`)
  console.error('Press Ctrl+C to cancel.')

  open(authorizationUrl).catch(() => {
    console.error('Failed to open browser automatically. Please visit the URL above.')
  })
})

server.on('error', (err) => {
  console.error('Server error:', err.message)
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the conflicting process and retry.`)
  }
  process.exit(1)
})

process.on('SIGINT', () => {
  console.error('Shutting down OAuth server...')
  server.close(() => process.exit(0))
})
