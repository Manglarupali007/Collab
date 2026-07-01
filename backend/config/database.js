const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nexus_collab';
    
    console.log(`📍 Connecting to MongoDB...`);
    
    const conn = await mongoose.connect(mongoURI);
    
    console.log(`✅ MongoDB Connected Successfully!`);
    console.log(`📍 Database: ${conn.connection.db.databaseName}`);
    console.log(`📍 Host: ${conn.connection.host}`);
    
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    console.log('⚠️ Please make sure MongoDB is running');
  }
};

module.exports = connectDB;