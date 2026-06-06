require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const cams = await mongoose.connection.db.collection('cameras').find({}).toArray();
  console.log('total:', cams.length);
  for (const c of cams) {
    console.log('  ' + c.id + ' | url=' + c.url + ' | conn=' + JSON.stringify(c.connection));
  }
  await mongoose.disconnect();
})();
