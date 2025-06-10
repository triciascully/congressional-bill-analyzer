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

app.get('/api/diagnose-repo', async (req, res) => {
  try {
    const axios = require('axios');
    const baseUrl = 'https://api.github.com/repos/unitedstates/congress';
    const headers = {
      'Authorization': `token ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    const results = {};

    // Test main repository
    const repoResponse = await axios.get(baseUrl, { headers });
    results.repository = '✅ Accessible';

    // Check root contents
    const rootResponse = await axios.get(`${baseUrl}/contents`, { headers });
    results.rootContents = rootResponse.data.map(item => `${item.name} (${item.type})`);

    // Check data directory
    try {
      const dataResponse = await axios.get(`${baseUrl}/contents/data`, { headers });
      results.dataDirectory = dataResponse.data.map(item => `${item.name} (${item.type})`);
      
      // Check for congress sessions
      const congressSessions = dataResponse.data.filter(item => item.type === 'dir' && /^\d+$/.test(item.name));
      results.congressSessions = congressSessions.map(item => item.name);
    } catch (error) {
      results.dataDirectory = `❌ Error: ${error.message}`;
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test-github', async (req, res) => {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GITHUB_TOKEN not set' });
    }
    
    const axios = require('axios');
    const response = await axios.get('https://api.github.com/user', {
      headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}` }
    });
    
    res.json({ 
      message: '✅ GitHub API connected!',
      user: response.data.login,
      rateLimit: response.headers['x-ratelimit-remaining']
    });
  } catch (error) {
    res.status(500).json({ 
      error: '❌ GitHub API failed',
      details: error.message,
      tokenExists: !!process.env.GITHUB_TOKEN
    });
  }
});

app.get('/api/force-analysis', async (req, res) => {
  try {
    console.log('🔄 Forcing re-analysis of all existing bills...');
    
    // Clear all existing pork analysis data
    const updateResult = await Bill.updateMany(
      {},
      {
        $unset: {
          'porkAnalysis.analysisDate': 1
        },
        $set: {
          'porkAnalysis.hasPork': false,
          'porkAnalysis.porkItems': [],
          'porkAnalysis.totalPorkValue': 0
        }
      }
    );
    
    console.log(`✅ Cleared analysis data for ${updateResult.modifiedCount} bills`);
    
    // Now run the analyzer
    const PorkAnalyzer = require('./scripts/analyzer');
    const analyzer = new PorkAnalyzer();
    const analysisResult = await analyzer.analyzeAllBills();
    
    console.log('✅ Re-analysis completed');
    
    // Get final stats
    const totalBills = await Bill.countDocuments();
    const billsWithPork = await Bill.countDocuments({ 'porkAnalysis.hasPork': true });
    const porkPercentage = totalBills > 0 ? ((billsWithPork / totalBills) * 100).toFixed(1) : 0;
    
    // Get total pork value
    const totalPorkValue = await Bill.aggregate([
      { $match: { 'porkAnalysis.hasPork': true } },
      { $group: { _id: null, total: { $sum: '$porkAnalysis.totalPorkValue' } } }
    ]);
    
    const formatCurrency = (amount) => {
      if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(1)}B`;
      if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
      return `$${amount.toLocaleString()}`;
    };
    
    res.json({
      success: true,
      message: 'All bills re-analyzed successfully!',
      analysisResult,
      finalStats: {
        totalBills,
        billsWithPork,
        porkPercentage: `${porkPercentage}%`,
        totalPorkValue: formatCurrency(totalPorkValue[0]?.total || 0)
      }
    });
    
  } catch (error) {
    console.error('❌ Force analysis failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Force analysis failed'
    });
  }
});

// Alternative: Reset everything and start fresh
app.get('/api/reset-and-initialize', async (req, res) => {
  try {
    console.log('🗑️ Clearing all existing bills...');
    
    // Delete all existing bills
    const deleteResult = await Bill.deleteMany({});
    console.log(`✅ Deleted ${deleteResult.deletedCount} existing bills`);
    
    // Now run the full initialization
    const CongressScraper = require('./scripts/scraper');
    const PorkAnalyzer = require('./scripts/analyzer');
    
    console.log('📝 Creating fresh sample bills...');
    const scraper = new CongressScraper();
    const scrapeResult = await scraper.scrapeBills();
    console.log('✅ Sample bills created');
    
    console.log('🔍 Analyzing bills for pork...');
    const analyzer = new PorkAnalyzer();
    const analysisResult = await analyzer.analyzeAllBills();
    console.log('✅ Pork analysis completed');
    
    // Get final stats
    const totalBills = await Bill.countDocuments();
    const billsWithPork = await Bill.countDocuments({ 'porkAnalysis.hasPork': true });
    
    res.json({
      success: true,
      message: 'Database reset and reinitialized successfully!',
      scrapeResult,
      analysisResult,
      stats: {
        totalBills,
        billsWithPork,
        porkPercentage: totalBills > 0 ? ((billsWithPork / totalBills) * 100).toFixed(2) : 0
      }
    });
    
  } catch (error) {
    console.error('❌ Reset and initialization failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Reset and initialization failed'
    });
  }
});

// Endpoint to clear sample data and load real bills
app.get('/api/load-real-data', async (req, res) => {
  try {
    console.log('🔄 Loading real congressional bill data...');
    
    // Delete existing sample bills (optional)
    const deleteResult = await Bill.deleteMany({});
    console.log(`🗑️ Cleared ${deleteResult.deletedCount} existing bills`);
    
    // Use the real data scraper
    const RealCongressScraper = require('./scripts/scraper');
    const scraper = new RealCongressScraper();
    const scrapeResult = await scraper.scrapeBills();
    
    console.log('✅ Real data loaded');
    
    // Analyze the new bills
    const PorkAnalyzer = require('./scripts/analyzer');
    const analyzer = new PorkAnalyzer();
    const analysisResult = await analyzer.analyzeAllBills();
    
    console.log('✅ Analysis completed');
    
    // Get final stats
    const totalBills = await Bill.countDocuments();
    const billsWithPork = await Bill.countDocuments({ 'porkAnalysis.hasPork': true });
    
    res.json({
      success: true,
      message: 'Real congressional data loaded successfully!',
      scrapeResult,
      analysisResult,
      stats: {
        totalBills,
        billsWithPork,
        porkPercentage: totalBills > 0 ? ((billsWithPork / totalBills) * 100).toFixed(1) : 0
      }
    });
    
  } catch (error) {
    console.error('❌ Real data loading failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to load real data'
    });
  }
});

// Endpoint to refresh/update existing data
app.get('/api/refresh-data', async (req, res) => {
  try {
    console.log('🔄 Refreshing congressional bill data...');
    
    // Get new bills without deleting existing ones
    const RealCongressScraper = require('./scripts/scraper');
    const scraper = new RealCongressScraper();
    const scrapeResult = await scraper.scrapeBills();
    
    console.log('✅ Data refreshed');
    
    // Re-analyze all bills (including new ones)
    const PorkAnalyzer = require('./scripts/analyzer');
    const analyzer = new PorkAnalyzer();
    
    // Clear existing analysis and re-analyze all
    await Bill.updateMany(
      {},
      {
        $unset: { 'porkAnalysis.analysisDate': 1 },
        $set: {
          'porkAnalysis.hasPork': false,
          'porkAnalysis.porkItems': [],
          'porkAnalysis.totalPorkValue': 0
        }
      }
    );
    
    const analysisResult = await analyzer.analyzeAllBills();
    console.log('✅ Re-analysis completed');
    
    // Get updated stats
    const totalBills = await Bill.countDocuments();
    const billsWithPork = await Bill.countDocuments({ 'porkAnalysis.hasPork': true });
    
    res.json({
      success: true,
      message: 'Data refreshed successfully!',
      scrapeResult,
      analysisResult,
      stats: {
        totalBills,
        billsWithPork,
        porkPercentage: totalBills > 0 ? ((billsWithPork / totalBills) * 100).toFixed(1) : 0
      }
    });
    
  } catch (error) {
    console.error('❌ Data refresh failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to refresh data'
    });
  }
});

// Endpoint to get Congress.gov API key setup instructions
app.get('/api/setup-real-data', async (req, res) => {
  try {
    const hasApiKey = !!process.env.CONGRESS_API_KEY;
    
    res.json({
      hasApiKey,
      message: hasApiKey ? 
        'Congress.gov API key is configured. You can use real data!' :
        'Congress.gov API key not found. Using realistic sample data.',
      instructions: {
        step1: 'Visit https://api.data.gov/signup/',
        step2: 'Register for a free API key',
        step3: 'Add CONGRESS_API_KEY to your Render environment variables',
        step4: 'Redeploy your app',
        step5: 'Use /api/load-real-data to get real congressional bills',
        note: 'Without an API key, the system uses realistic sample data based on actual bills'
      },
      currentStatus: hasApiKey ? 'Ready for real data' : 'Using sample data',
      sampleDataInfo: 'The sample data includes realistic bills like the Infrastructure Investment Act, CHIPS Act, and appropriations bills with real pork barrel examples'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Failed to check API key status'
    });
  }
});

// Enhanced initialization that uses real data scraper
app.get('/api/initialize-real', async (req, res) => {
  try {
    console.log('🚀 Initializing with real congressional data...');
    
    // Check if we already have data
    const existingCount = await Bill.countDocuments();
    if (existingCount > 0) {
      return res.json({
        success: true,
        message: `Database already contains ${existingCount} bills. Use /api/refresh-data to update or /api/load-real-data to start fresh.`,
        existingBills: existingCount
      });
    }
    
    // Load real data
    const RealCongressScraper = require('./scripts/scraper');
    const scraper = new RealCongressScraper();
    const scrapeResult = await scraper.scrapeBills();
    
    console.log('✅ Real bills loaded');
    
    // Analyze for pork
    const PorkAnalyzer = require('./scripts/analyzer');
    const analyzer = new PorkAnalyzer();
    const analysisResult = await analyzer.analyzeAllBills();
    
    console.log('✅ Pork analysis completed');
    
    // Get final stats
    const totalBills = await Bill.countDocuments();
    const billsWithPork = await Bill.countDocuments({ 'porkAnalysis.hasPork': true });
    
    res.json({
      success: true,
      message: 'Database initialized with real congressional data!',
      scrapeResult,
      analysisResult,
      stats: {
        totalBills,
        billsWithPork,
        porkPercentage: totalBills > 0 ? ((billsWithPork / totalBills) * 100).toFixed(1) : 0
      }
    });
    
  } catch (error) {
    console.error('❌ Real data initialization failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Real data initialization failed'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, Bill };