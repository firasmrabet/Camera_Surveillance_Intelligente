// Get a JWT for the test user
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await mongoose.connection.db.collection('users').findOne({ email: 'firasmrabet1603@gmail.com' });
  if (!user) { console.error('User not found'); process.exit(1); }
  const token = jwt.sign(
    { id: user._id.toString(), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  console.log(token);
  process.exit(0);
})();
