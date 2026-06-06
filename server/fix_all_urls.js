require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const cams = await mongoose.connection.db.collection('cameras').find({ url: /videofeed/ }).toArray();
  console.log('cams with videofeed:', cams.length);
  for (const c of cams) {
    const newUrl = `https://${c.connection.host}:${c.connection.port}/?action=stream`;
    const r = await mongoose.connection.db.collection('cameras').updateOne(
      { id: c.id },
      { $set: { url: newUrl } }
    );
    console.log(`  ${c.id}: ${c.url} -> ${newUrl} (${r.modifiedCount})`);
  }
  await mongoose.disconnect();
})();
