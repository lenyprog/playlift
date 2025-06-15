require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const querystring = require('querystring');
const app = express();

const PORT = process.env.PORT || 5000;
const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;
const frontend_uri = process.env.FRONTEND_URI;

app.use(cors());
app.use(express.json());

// Générer un code random string
const generateRandomString = length => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for(let i=0; i<length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

const stateKey = 'spotify_auth_state';

// 1. Route pour lancer l’authentification Spotify
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
    client_id,
    scope,
    redirect_uri,
    state
  });

  res.cookie(stateKey, state);
  res.redirect(`https://accounts.spotify.com/authorize?${query}`);
});

// 2. Callback pour récupérer le code et échanger contre token
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  // TODO: vérifier le state (sécurité)

  if (!code) {
    return res.redirect(`${frontend_uri}/?error=missing_code`);
  }

  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      data: querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri
      })
    });

    const { access_token, refresh_token, expires_in } = response.data;

    // Redirige vers frontend avec les tokens en query params
    const redirectUrl = `${frontend_uri}/?access_token=${access_token}&refresh_token=${refresh_token}&expires_in=${expires_in}`;
    res.redirect(redirectUrl);

  } catch (err) {
    console.error('Error fetching token:', err.response.data);
    res.redirect(`${frontend_uri}/?error=token_error`);
  }
});

// 3. Endpoint pour rafraîchir le token
app.get('/refresh_token', async (req, res) => {
  const refresh_token = req.query.refresh_token;
  if (!refresh_token) return res.status(400).json({ error: 'Missing refresh token' });

  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      data: querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token
      })
    });

    res.json({ access_token: response.data.access_token, expires_in: response.data.expires_in });

  } catch (err) {
    console.error('Error refreshing token:', err.response.data);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// 4. Exemple : récupérer playlists user
app.get('/playlists', async (req, res) => {
  const access_token = req.headers.authorization?.split(' ')[1];
  if (!access_token) return res.status(401).json({ error: 'Missing access token' });

  try {
    const response = await axios.get('https://api.spotify.com/v1/me/playlists', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    res.json(response.data);
  } catch (err) {
    console.error('Error fetching playlists:', err.response?.data);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// 5. Endpoint pour trier une playlist par artiste
app.get('/playlist/:id/sorted', async (req, res) => {
  const access_token = req.headers.authorization?.split(' ')[1];
  const playlist_id = req.params.id;
  if (!access_token) return res.status(401).json({ error: 'Missing access token' });
  if (!playlist_id) return res.status(400).json({ error: 'Missing playlist id' });

  try {
    const tracks = [];
    let url = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`;

    while (url) {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      tracks.push(...response.data.items);
      url = response.data.next;
    }

    // Trie les pistes par nom d'artiste (premier artiste)
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

  } catch (err) {
    console.error('Error sorting playlist:', err.response?.data);
    res.status(500).json({ error: 'Failed to sort playlist' });
  }
});

app.listen(PORT, () => {
  console.log(`Playlift backend listening on port ${PORT}`);
});
