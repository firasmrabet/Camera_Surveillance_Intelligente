require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const r = await mongoose.connection.db.collection('cameras').updateOne(
    { id: 'cam-91473391' },
    { $set: { url: 'https://192.168.100.165:8080/?action=stream' } }
  );
  console.log('updated:', r.modifiedCount);
  const cam = await mongoose.connection.db.collection('cameras').findOne({ id: 'cam-91473391' });
  console.log('new url:', cam.url);
  await mongoose.disconnect();
})();
