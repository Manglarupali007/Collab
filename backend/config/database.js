const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Check if MONGODB_URI exists
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      console.error('❌ MONGODB_URI is not defined in .env file');
      console.log('⚠️ Please create .env file with:');
      console.log('   MONGODB_URI=mongodb://localhost:27017/nexus_collab');
      return;
    }
    
    console.log(`📍 Connecting to: ${mongoURI}`);
    
    const conn = await mongoose.connect(mongoURI);
    
    console.log(`✅ MongoDB Connected Successfully!`);
    console.log(`📍 Database: ${conn.connection.db.databaseName}`);
    console.log(`📍 Host: ${conn.connection.host}`);
    
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    console.log('⚠️ Please make sure:');
    console.log('   1. MongoDB is running (net start MongoDB)');
    console.log('   2. MONGODB_URI is correct in .env file');
    console.log('   3. MongoDB is listening on port 27017');
  }
};

module.exports = connectDB;