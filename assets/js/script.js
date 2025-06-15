function authorize() {
  const client_id = 'YOUR_SPOTIFY_CLIENT_ID'; // Replace with your actual client ID
  const redirect_uri = 'https://lenyporg.github.io/playlift/';
  const scopes = [
    'user-read-private',
    'user-read-email',
    'user-top-read',
    'user-read-recently-played',
    'playlist-read-private',
    'playlist-modify-public',
    'playlist-modify-private'
  ];

  const authUrl = `https://accounts.spotify.com/authorize?` +
                  `client_id=${client_id}` +
                  `&response_type=token` +
                  `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
                  `&scope=${encodeURIComponent(scopes.join(' '))}`;

  window.location.href = authUrl;
}
