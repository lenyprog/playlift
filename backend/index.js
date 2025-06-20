import express from 'express';
import axios from 'axios';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json());

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  REDIRECT_URI,
  FRONTEND_URI,
  COOKIE_SECRET,
} = process.env;

const PORT = process.env.PORT || 3000;

const STATE_KEY = 'spotify_auth_state';

// Helper: génère une chaîne aléatoire pour l’état OAuth
function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// Helper: Header Basic Auth pour token Spotify
function getAuthHeader() {
  return (
    'Basic ' +
    Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
  );
}

// --- ROUTE /login : redirige vers Spotify pour login ---
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  res.cookie(STATE_KEY, state, { httpOnly: true, maxAge: 3600000, signed: true });

  const scope = [
    'user-read-private',
    'user-read-email',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-top-read',
    'user-read-recently-played',
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: process.env.REDIRECT_URI,
    state,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});


// --- ROUTE /callback : échange code contre tokens ---
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.signedCookies[STATE_KEY];

  if (!state || state !== storedState) {
    return res.redirect(`${FRONTEND_URI}/?error=state_mismatch`);
  }

  res.clearCookie(STATE_KEY);

  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: getAuthHeader(),
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    res.cookie('access_token', access_token, {
      httpOnly: true,
      maxAge: expires_in * 1000,
      secure: true,
      sameSite: 'lax',
      signed: true,
    });
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: true,
      sameSite: 'lax',
      signed: true,
    });

    res.redirect(FRONTEND_URI);
  } catch (error) {
    console.error('Erreur échange tokens:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URI}/?error=invalid_token`);
  }
});

// Middleware pour vérifier et attacher access_token
async function withAccessToken(req, res, next) {
  const access_token = req.signedCookies['access_token'];
  const refresh_token = req.signedCookies['refresh_token'];

  if (!access_token) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  req.access_token = access_token;
  req.refresh_token = refresh_token;
  next();
}

// Helper requête Spotify avec token
async function spotifyRequest(req, url, method = 'get', data = null) {
  try {
    const response = await axios({
      method,
      url,
      headers: { Authorization: `Bearer ${req.access_token}` },
      data,
    });
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      // Token expiré, tu peux ici gérer refresh token (optionnel)
    }
    throw err;
  }
}

// --- Route pour obtenir infos utilisateur ---
app.get('/me', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(req, 'https://api.spotify.com/v1/me');
    res.json(data);
  } catch {
    res.status(401).json({ error: 'Erreur authentification' });
  }
});

// --- Route pour obtenir playlists ---
app.get('/playlists', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(
      req,
      'https://api.spotify.com/v1/me/playlists?limit=50'
    );
    res.json(data);
  } catch {
    res.status(400).json({ error: 'Erreur récupération playlists' });
  }
});

// --- Route pour récupérer et trier playlist ---
app.get('/playlist/:id/sorted', withAccessToken, async (req, res) => {
  try {
    const playlistId = req.params.id;
    let allTracks = [];
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

    while (url) {
      const data = await spotifyRequest(req, url);
      allTracks = allTracks.concat(data.items);
      url = data.next;
    }

    const tracks = allTracks
      .map((item) => ({
        name: item.track.name,
        artists: item.track.artists.map((a) => a.name),
        id: item.track.id,
      }))
      .sort((a, b) => a.artists[0].localeCompare(b.artists[0]));

    res.json({ sorted_tracks: tracks });
  } catch {
    res.status(400).json({ error: 'Erreur récupération ou tri playlist' });
  }
});

// --- Route top artists (long term) ---
app.get('/me/top-artists', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(
      req,
      'https://api.spotify.com/v1/me/top/artists?limit=50&time_range=long_term'
    );
    res.json(data);
  } catch {
    res.status(400).json({ error: 'Erreur top artists' });
  }
});

// --- Route top tracks (long term) ---
app.get('/me/top-tracks', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(
      req,
      'https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term'
    );
    res.json(data);
  } catch {
    res.status(400).json({ error: 'Erreur top tracks' });
  }
});

// --- Health check ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
  console.log(`Playlift backend écoute sur le port ${PORT}`);
});
