const fs = require('fs');

(async () => {
  try {
    const tokenData = JSON.parse(fs.readFileSync(__dirname + '/token.json', 'utf8'));
    const token = tokenData.token;
    const resp = await fetch('http://localhost:5000/api/alerts', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const j = await resp.json();
    fs.writeFileSync(__dirname + '/alerts.json', JSON.stringify(j, null, 2));
    console.log('Wrote alerts.json');
  } catch (err) {
    console.error('Error fetching alerts:', err);
    process.exit(1);
  }
})();
