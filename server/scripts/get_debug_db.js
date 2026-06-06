const fs = require('fs');

(async () => {
  try {
    const resp = await fetch('http://localhost:5000/api/debug/db');
    const j = await resp.json();
    fs.writeFileSync(__dirname + '/debug_db.json', JSON.stringify(j, null, 2));
    console.log('Wrote debug_db.json');
  } catch (err) {
    console.error('Error fetching debug DB:', err);
    process.exit(1);
  }
})();
