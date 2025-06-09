// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Models
const billSchema = new mongoose.Schema({
  billId: { type: String, unique: true, required: true },
  congress: Number,
  billType: String,
  billNumber: Number,
  title: String,
  summary: String,
  fullText: String,
  porkAnalysis: {
    hasPork: Boolean,
    porkItems: [{
      description: String,
      amount: String,
      beneficiary: String,
      justification: String,
      suspicionLevel: { type: String, enum: ['low', 'medium', 'high'] }
    }],
    totalPorkValue: Number,
    analysisDate: Date
  },
  sponsors: [String],
  introducedDate: Date,
  lastAction: String,
  status: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Bill = mongoose.model('Bill', billSchema);

// Routes
app.get('/api/bills', async (req, res) => {
  try {
    const { page = 1, limit = 20, hasPork, congress } = req.query;
    const query = {};
    
    if (hasPork !== undefined) {
      query['porkAnalysis.hasPork'] = hasPork === 'true';
    }
    
    if (congress) {
      query.congress = parseInt(congress);
    }

    const bills = await Bill.find(query)
      .sort({ introducedDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-fullText'); // Exclude full text for performance

    const total = await Bill.countDocuments(query);
    
    res.json({
      bills,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bills/:id', async (req, res) => {
  try {
    const bill = await Bill.findOne({ billId: req.params.id });
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    res.json(bill);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalBills = await Bill.countDocuments();
    const billsWithPork = await Bill.countDocuments({ 'porkAnalysis.hasPork': true });
    const totalPorkValue = await Bill.aggregate([
      { $match: { 'porkAnalysis.hasPork': true } },
      { $group: { _id: null, total: { $sum: '$porkAnalysis.totalPorkValue' } } }
    ]);

    res.json({
      totalBills,
      billsWithPork,
      porkPercentage: totalBills > 0 ? ((billsWithPork / totalBills) * 100).toFixed(2) : 0,
      totalPorkValue: totalPorkValue[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add this initialization endpoint
app.get('/api/initialize', async (req, res) => {
  try {
    console.log('🚀 Starting database initialization...');
    
    const CongressScraper = require('./scripts/scraper');
    const PorkAnalyzer = require('./scripts/analyzer');
    
    console.log('📥 Scraping bills from GitHub...');
    const scraper = new CongressScraper();
    await scraper.scrapeBills();
    
    console.log('🔍 Analyzing bills for pork...');
    const analyzer = new PorkAnalyzer();
    await analyzer.analyzeAllBills();
    
    const totalBills = await Bill.countDocuments();
    const billsWithPork = await Bill.countDocuments({ 'porkAnalysis.hasPork': true });
    
    res.json({ 
      success: true, 
      message: 'Database initialized successfully!',
      stats: { totalBills, billsWithPork }
    });
  } catch (error) {
    console.error('❌ Initialization error:', error);
    res.status(500).json({ 
      error: error.message,
      message: 'Database initialization failed'
    });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const totalBills = await Bill.countDocuments();
    res.json({
      databaseConnected: true,
      totalBills,
      isEmpty: totalBills === 0
    });
  } catch (error) {
    res.status(500).json({
      databaseConnected: false,
      error: error.message
    });
  }
});

app.get('/api/test-repo', async (req, res) => {
  try {
    const axios = require('axios');
    const baseUrl = 'https://api.github.com/repos/unitedstates/congress';
    
    // Test main repo
    const repoResponse = await axios.get(baseUrl, {
      headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}` }
    });
    
    // Test data directory
    const dataResponse = await axios.get(`${baseUrl}/contents/data`, {
      headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}` }
    });
    
    // Test congress 118
    const congress118Response = await axios.get(`${baseUrl}/contents/data/118`, {
      headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}` }
    });
    
    res.json({
      repository: '✅ Accessible',
      dataDirectory: `✅ Found ${dataResponse.data.length} items`,
      congress118: `✅ Found ${congress118Response.data.length} items`,
      congress118Items: congress118Response.data.map(item => item.name)
    });
  } catch (error) {
    res.json({
      error: error.message,
      status: error.response?.status,
      path: error.config?.url
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, Bill };