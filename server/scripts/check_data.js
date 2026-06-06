const fs = require('fs');

(async () => {
  try {
    const tokenData = JSON.parse(fs.readFileSync(__dirname + '/token.json', 'utf8'));
    const token = tokenData.token;

    const camerasResp = await fetch('http://localhost:5000/api/cameras', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const cameras = await camerasResp.json();

    const alertsResp = await fetch('http://localhost:5000/api/alerts', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const alerts = await alertsResp.json();
    // also fetch debug DB dump to help diagnose ownerId/token mismatches
    let debug = null;
    try {
      const dbResp = await fetch('http://localhost:5000/api/debug/db');
      debug = await dbResp.json();
    } catch (err) {
      console.warn('Could not fetch debug DB:', err.message || err);
    }

    const out = { cameras, alerts, debug };
    fs.writeFileSync(__dirname + '/check_data.json', JSON.stringify(out, null, 2));
    console.log('Wrote check_data.json');
  } catch (err) {
    console.error('Error checking data:', err);
    process.exit(1);
  }
})();
