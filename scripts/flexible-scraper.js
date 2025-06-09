const axios = require('axios');
const { Bill } = require('../server.js');

class FlexibleCongressScraper {
  constructor() {
    this.baseUrl = 'https://api.github.com/repos/unitedstates/congress';
    this.headers = {
      'Authorization': `token ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    };
  }

  async findAvailableCongress() {
    console.log('🔍 Searching for available Congress sessions...');
    const dataResponse = await axios.get(`${this.baseUrl}/contents/data`, { headers: this.headers });
    
    const congressDirs = dataResponse.data
      .filter(item => item.type === 'dir' && /^\d+$/.test(item.name))
      .map(item => parseInt(item.name))
      .sort((a, b) => b - a);
    
    console.log(`Found Congress sessions: ${congressDirs.join(', ')}`);
    
    for (const congress of congressDirs) {
      try {
        const congressResponse = await axios.get(`${this.baseUrl}/contents/data/${congress}`, { headers: this.headers });
        const hasBills = congressResponse.data.some(item => item.name === 'bills');
        
        if (hasBills) {
          console.log(`✅ Using Congress ${congress}`);
          return congress;
        }
      } catch (error) {
        console.log(`❌ Congress ${congress} not accessible`);
      }
    }
    
    throw new Error('No accessible Congress sessions found');
  }

  async scrapeBills() {
    console.log('🚀 Starting flexible scraping...');
    
    const congress = await this.findAvailableCongress();
    console.log(`Using Congress ${congress}`);
    
    // Get bill types
    const billsResponse = await axios.get(`${this.baseUrl}/contents/data/${congress}/bills`, { headers: this.headers });
    const billTypes = billsResponse.data.filter(item => item.type === 'dir').slice(0, 2); // Limit to 2 types
    
    let totalSaved = 0;
    
    for (const billType of billTypes) {
      console.log(`Processing ${billType.name} bills...`);
      
      const billsInType = await axios.get(`${this.baseUrl}/contents/data/${congress}/bills/${billType.name}`, { headers: this.headers });
      const bills = billsInType.data.filter(item => item.type === 'dir').slice(0, 5); // Limit to 5 bills
      
      for (const bill of bills) {
        try {
          const billData = await this.getBillData(congress, billType.name, bill.name);
          if (billData) {
            await this.saveBill(congress, billType.name, bill.name, billData);
            totalSaved++;
          }
        } catch (error) {
          console.log(`Skipping ${billType.name}${bill.name}: ${error.message}`);
        }
      }
    }
    
    return { totalSaved, congress };
  }

  async getBillData(congress, billType, billNumber) {
    const dataPath = `${this.baseUrl}/contents/data/${congress}/bills/${billType}/${billNumber}/data.json`;
    const response = await axios.get(dataPath, { headers: this.headers });
    return JSON.parse(Buffer.from(response.data.content, 'base64').toString());
  }

  async saveBill(congress, billType, billNumber, billData) {
    const billId = `${congress}-${billType}-${billNumber}`;
    
    const existingBill = await Bill.findOne({ billId });
    if (existingBill) return;

    const bill = new Bill({
      billId,
      congress,
      billType,
      billNumber: parseInt(billNumber) || 0,
      title: billData.title || `${billType.toUpperCase()} ${billNumber}`,
      summary: billData.summary?.text || '',
      fullText: billData.title + ' ' + (billData.summary?.text || ''),
      sponsors: billData.sponsors?.map(s => s.name || 'Unknown') || [],
      introducedDate: billData.introduced_at ? new Date(billData.introduced_at) : new Date(),
      lastAction: billData.actions?.[billData.actions.length - 1]?.text || '',
      status: billData.status || 'unknown',
      porkAnalysis: {
        hasPork: false,
        porkItems: [],
        totalPorkValue: 0,
        analysisDate: new Date()
      }
    });

    await bill.save();
    console.log(`✅ Saved ${billId}`);
  }
}

module.exports = FlexibleCongressScraper;