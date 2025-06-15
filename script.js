const BACKEND_URL = 'https://playlift-api.onrender.com';

const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const userImg = document.getElementById('user-img');
const playlistsSection = document.getElementById('playlists-section');
const playlistsList = document.getElementById('playlists-list');
const playlistDetails = document.getElementById('playlist-details');
const playlistTitle = document.getElementById('playlist-title');
const playlistTracks = document.getElementById('playlist-tracks');
const btnSortArtist = document.getElementById('btn-sort-artist');
const statsSection = document.getElementById('stats-section');
const topArtistsSpan = document.getElementById('top-artists');
const topTracksSpan = document.getElementById('top-tracks');
const topGenresSpan = document.getElementById('top-genres');
const totalHoursSpan = document.getElementById('total-hours');
const errorMessage = document.getElementById('error-message');

let currentPlaylistId = null;
let currentPlaylistTracks = [];

btnLogin.onclick = () => {
  // Redirige vers backend /login
  window.location.href = `${BACKEND_URL}/login`;
};

btnLogout.onclick = () => {
  // Supprime les cookies côté navigateur (rien côté backend)
  // Comme on utilise cookies HttpOnly, frontend ne peut pas vraiment les supprimer
  // La meilleure méthode est de demander backend à clear cookies (à ajouter si besoin)
  alert('Pour te déconnecter, vide tes cookies ou ferme le navigateur.');
};

async function fetchJSON(url) {
  const res = await fetch(url, {
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Erreur réseau');
  return res.json();
}

// Vérifie si utilisateur connecté
async function checkUser() {
  try {
    const user = await fetchJSON(`${BACKEND_URL}/me`);
    showUser(user);
    await loadPlaylists();
    await loadUserStats();
    btnLogin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
  } catch {
    // Pas connecté
    btnLogin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
    userInfo.classList.add('hidden');
    playlistsSection.classList.add('hidden');
    playlistDetails.classList.add('hidden');
    statsSection.classList.add('hidden');
  }
}

function showUser(user) {
  userName.textContent = user.display_name || 'Utilisateur';
  if (user.images && user.images.length > 0) {
    userImg.src = user.images[0].url;
    userImg.alt = `Photo de ${user.display_name}`;
  } else {
    userImg.src = '';
    userImg.alt = '';
  }
  userInfo.classList.remove('hidden');
}

async function loadPlaylists() {
  try {
    const data = await fetchJSON(`${BACKEND_URL}/playlists`);
    playlistsList.innerHTML = '';
    if (data.items.length === 0) {
      playlistsList.innerHTML = '<li>Aucune playlist trouvée</li>';
    } else {
      data.items.forEach(pl => {
        const li = document.createElement('li');
        li.textContent = pl.name + ` (${pl.tracks.total} titres)`;
        li.dataset.id = pl.id;
        li.onclick = () => loadPlaylistDetails(pl.id, pl.name);
        playlistsList.appendChild(li);
      });
    }
    playlistsSection.classList.remove('hidden');
  } catch (e) {
    showError('Erreur lors du chargement des playlists');
  }
}

async function loadPlaylistDetails(id, name) {
  currentPlaylistId = id;
  playlistTitle.textContent = name;
  playlistTracks.innerHTML = 'Chargement...';
  playlistDetails.classList.remove('hidden');

  try {
    const res = await fetchJSON(`${BACKEND_URL}/playlist/${id}/sorted`);
    currentPlaylistTracks = res.sorted_tracks;
    displayTracks(currentPlaylistTracks);
  } catch (e) {
    showError('Erreur lors du chargement de la playlist');
  }
}

function displayTracks(tracks) {
  playlistTracks.innerHTML = '';
  tracks.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${t.name}</strong> — ${t.artists.join(', ')}`;
    playlistTracks.appendChild(li);
  });
}

btnSortArtist.onclick = () => {
  if (!currentPlaylistTracks.length) return;
  // Trie localement (au cas où backend non trié)
  currentPlaylistTracks.sort((a, b) => {
    const artA = a.artists[0].toLowerCase();
    const artB = b.artists[0].toLowerCase();
    return artA.localeCompare(artB);
  });
  displayTracks(currentPlaylistTracks);
};

function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.classList.remove('hidden');
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 6000);
}

// --------------------------------------
// Playlift Wrap simplifié (statistiques)
// --------------------------------------

async function loadUserStats() {
  try {
    // Top artistes
    const topArtistsRes = await fetchJSON(`${BACKEND_URL}/me/top-artists`);
    const topArtists = topArtistsRes.items.slice(0, 5).map(a => a.name).join(', ') || 'N/A';
    topArtistsSpan.textContent = topArtists;

    // Top tracks
    const topTracksRes = await fetchJSON(`${BACKEND_URL}/me/top-tracks`);
    const topTracks = topTracksRes.items.slice(0, 5).map(t => t.name).join(', ') || 'N/A';
    topTracksSpan.textContent = topTracks;

    // Genres (aggregé)
    const genresCount = {};
    topArtistsRes.items.forEach(artist => {
      artist.genres.forEach(g => {
        genresCount[g] = (genresCount[g] || 0) + 1;
      });
    });
    const topGenres = Object.entries(genresCount)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 5)
      .map(g => g[0])
      .join(', ') || 'N/A';
    topGenresSpan.textContent = topGenres;

    // Heures d'écoute estimées (simple estimation sur base top tracks)
    // Ce point est complexe, ici on met une valeur statique
    totalHoursSpan.textContent = 'Données non disponibles'; // Remplacer par un vrai calcul si backend supporte

    statsSection.classList.remove('hidden');
  } catch {
    showError('Impossible de charger les statistiques utilisateur');
  }
}

checkUser();
