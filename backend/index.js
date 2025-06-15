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
} = process.env;

const PORT = process.env.PORT || 3000;

const generateRandomString = (length = 16) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for(let i=0; i<length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

const STATE_KEY = 'spotify_auth_state';

// --- Helper pour header basic auth ---
const getAuthHeader = () => {
  return 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
};

// --- 1. Login route ---
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  res.cookie(STATE_KEY, state, { httpOnly: true, maxAge: 3600000 });

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
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    state,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

// --- 2. Callback route ---
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[STATE_KEY] : null;

  if (state === null || state !== storedState) {
    return res.redirect(`${FRONTEND_URI}/?error=state_mismatch`);
  }

  res.clearCookie(STATE_KEY);

  try {
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: getAuthHeader(),
      },
      data: new URLSearchParams({
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Stock tokens en cookies HttpOnly, sécurisés
    res.cookie('access_token', access_token, {
      httpOnly: true,
      maxAge: expires_in * 1000,
      secure: true,
      sameSite: 'lax',
    });
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: true,
      sameSite: 'lax',
    });

    res.redirect(FRONTEND_URI);
  } catch (error) {
    console.error('Erreur échange tokens:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URI}/?error=invalid_token`);
  }
});

// --- Middleware pour refresh token + attach access_token ---
async function withAccessToken(req, res, next) {
  let access_token = req.cookies.access_token;
  const refresh_token = req.cookies.refresh_token;

  if (!access_token && !refresh_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // TODO: ici on pourrait rafraîchir automatiquement le token si expiré
  // Pour simplifier, on va tenter et si 401, on renvoie une erreur (à améliorer)

  req.access_token = access_token;
  req.refresh_token = refresh_token;
  next();
}

// --- Fonction helper requête Spotify ---
async function spotifyRequest(req, url, method = 'get') {
  try {
    const res = await axios({
      method,
      url,
      headers: { Authorization: `Bearer ${req.access_token}` },
    });
    return res.data;
  } catch (err) {
    // Si 401, token expiré ou invalide, tu peux gérer refresh token ici
    throw err;
  }
}

// --- 3. /me - Infos utilisateur ---
app.get('/me', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(req, 'https://api.spotify.com/v1/me');
    res.json(data);
  } catch (e) {
    res.status(401).json({ error: 'Erreur authentification' });
  }
});

// --- 4. /playlists - Récupère playlists utilisateur ---
app.get('/playlists', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(req, 'https://api.spotify.com/v1/me/playlists?limit=50');
    res.json(data);
  } catch (e) {
    res.status(401).json({ error: 'Erreur récupération playlists' });
  }
});

// --- 5. /playlist/:id/sorted - Récupère tracks triés par artiste ---
app.get('/playlist/:id/sorted', withAccessToken, async (req, res) => {
  try {
    const playlistId = req.params.id;

    // Récupérer tous les tracks (pagination si > 100)
    let allTracks = [];
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
    while (url) {
      const data = await spotifyRequest(req, url);
      allTracks = allTracks.concat(data.items);
      url = data.next;
    }

    // Map tracks en format simple + trie par artiste
    const tracks = allTracks
      .map(item => ({
        name: item.track.name,
        artists: item.track.artists.map(a => a.name),
        id: item.track.id,
      }))
      .sort((a, b) => a.artists[0].localeCompare(b.artists[0]));

    res.json({ sorted_tracks: tracks });
  } catch (e) {
    res.status(400).json({ error: 'Erreur récupération ou tri playlist' });
  }
});

// --- 6. /me/top-artists ---
app.get('/me/top-artists', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(req, 'https://api.spotify.com/v1/me/top/artists?limit=50&time_range=long_term');
    res.json(data);
  } catch {
    res.status(400).json({ error: 'Erreur top artists' });
  }
});

// --- 7. /me/top-tracks ---
app.get('/me/top-tracks', withAccessToken, async (req, res) => {
  try {
    const data = await spotifyRequest(req, 'https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term');
    res.json(data);
  } catch {
    res.status(400).json({ error: 'Erreur top tracks' });
  }
});

// --- 8. Route pour refresh token (optionnel, pas géré ici) ---

// --- 9. Catch-all 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// --- Start serveur ---
app.listen(PORT, () => {
  console.log(`Playlift backend écoute sur le port ${PORT}`);
});
