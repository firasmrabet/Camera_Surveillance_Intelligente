require('dotenv').config();
const fs = require('fs');

(async () => {
  try {
    const tokenPath = __dirname + '/token.json';
    if (!fs.existsSync(tokenPath)) {
      console.error('token.json not found. Run get_token.js first.');
      process.exit(1);
    }

    const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const token = tokenData.token;
    const phone = process.env.TWILIO_PHONE_NUMBER || process.argv[2];

    if (!phone) {
      console.error('No phone provided in .env or as argument');
      process.exit(1);
    }

    const resp = await fetch('http://localhost:5000/api/auth/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ phone })
    });

    const j = await resp.json();
    console.log('Profile update response:', j);
  } catch (err) {
    console.error('Error updating profile:', err);
    process.exit(1);
  }
})();
