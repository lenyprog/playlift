require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const querystring = require('querystring');
const app = express();

const PORT = process.env.PORT || 5000;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; // ex: https://playlift-api.onrender.com/callback
const FRONTEND_URI = process.env.FRONTEND_URI; // ex: https://lenyporg.github.io/playlift

app.use(cors({
  origin: FRONTEND_URI,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

const generateRandomString = length => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for(let i=0; i<length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

const stateKey = 'spotify_auth_state';

// 1. /login - redirige vers Spotify OAuth
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  const scope = [
    'user-read-private',
    'user-read-email',
    'user-top-read',
    'user-read-recently-played',
    'playlist-read-private',
    'playlist-modify-public',
    'playlist-modify-private'
  ].join(' ');

  const query = querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    state
  });

  res.cookie(stateKey, state, { httpOnly: true, secure: true, maxAge: 600000 }); // 10 min
  res.redirect(`https://accounts.spotify.com/authorize?${query}`);
});

// 2. /callback - échange code contre tokens, set cookies, redirige frontend
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    return res.redirect(`${FRONTEND_URI}/?error=state_mismatch`);
  }
  res.clearCookie(stateKey);

  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
      },
      data: querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });

    const { access_token, refresh_token, expires_in } = response.data;

    // Stocker dans cookies sécurisés, httpOnly (inaccessible JS côté client)
    res.cookie('access_token', access_token, { httpOnly: true, secure: true, maxAge: expires_in * 1000, sameSite: 'none' });
    res.cookie('refresh_token', refresh_token, { httpOnly: true, secure: true, maxAge: 30*24*60*60*1000, sameSite: 'none' }); // 30 jours

    // Redirige vers frontend sans tokens en URL
    res.redirect(FRONTEND_URI);

  } catch (error) {
    console.error('Token error', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URI}/?error=invalid_token`);
  }
});

// 3. /refresh_token - rafraîchir token depuis cookie
app.get('/refresh_token', async (req, res) => {
  const refresh_token = req.cookies ? req.cookies['refresh_token'] : null;
  if (!refresh_token) return res.status(401).json({ error: 'Missing refresh token' });

  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
      },
      data: querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token
      })
    });

    const { access_token, expires_in } = response.data;

    res.cookie('access_token', access_token, { httpOnly: true, secure: true, maxAge: expires_in * 1000, sameSite: 'none' });

    res.json({ success: true });

  } catch (error) {
    console.error('Refresh token error', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Middleware pour vérifier access_token
const requireAuth = (req, res, next) => {
  const token = req.cookies ? req.cookies['access_token'] : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized, no access token' });
  req.access_token = token;
  next();
};

// 4. /me - infos utilisateur
app.get('/me', requireAuth, async (req, res) => {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${req.access_token}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// 5. /playlists - récupérer playlists user
app.get('/playlists', requireAuth, async (req, res) => {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/playlists', {
      headers: { Authorization: `Bearer ${req.access_token}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

// 6. /playlist/:id/sorted - trier playlist par artiste
app.get('/playlist/:id/sorted', requireAuth, async (req, res) => {
  const playlist_id = req.params.id;
  if (!playlist_id) return res.status(400).json({ error: 'Missing playlist ID' });

  try {
    let tracks = [];
    let url = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`;

    while (url) {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${req.access_token}` }
      });
      tracks = tracks.concat(response.data.items);
      url = response.data.next;
    }

    tracks.sort((a, b) => {
      const artistA = a.track.artists[0].name.toLowerCase();
      const artistB = b.track.artists[0].name.toLowerCase();
      return artistA.localeCompare(artistB);
    });

    res.json({
      playlist_id,
      sorted_tracks: tracks.map(t => ({
        name: t.track.name,
        artists: t.track.artists.map(a => a.name),
        album: t.track.album.name,
        uri: t.track.uri,
        external_url: t.track.external_urls.spotify
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get and sort playlist' });
  }
});

app.listen(PORT, () => {
  console.log(`Playlift backend listening on port ${PORT}`);
});
