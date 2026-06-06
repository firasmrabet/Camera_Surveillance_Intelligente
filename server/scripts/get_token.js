const fs = require('fs');

(async () => {
  try {
    const resp = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@security.com', password: 'admin123' })
    });
    const j = await resp.json();
    fs.writeFileSync(__dirname + '/token.json', JSON.stringify(j, null, 2));
    console.log('Wrote token.json');
  } catch (err) {
    console.error('Error fetching token:', err);
    process.exit(1);
  }
})();
