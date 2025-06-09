// scripts/scraper.js
const axios = require('axios');
const { Bill } = require('../server.js');
const natural = require('natural');

class CongressScraper {
  constructor() {
    this.baseUrl = 'https://api.github.com/repos/unitedstates/congress';
    this.headers = {
      'Authorization': `token ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    };
  }

  async getCurrentCongress() {
    // 118th Congress (2023-2025)
    return 118;
  }

  async getBillsList(congress) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/contents/data/${congress}`,
        { headers: this.headers }
      );
      
      return response.data.filter(item => 
        item.type === 'dir' && ['bills'].includes(item.name)
      );
    } catch (error) {
      console.error('Error fetching bills list:', error.message);
      return [];
    }
  }

  async getBillTypes(congress) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/contents/data/${congress}/bills`,
        { headers: this.headers }
      );
      
      return response.data.filter(item => item.type === 'dir');
    } catch (error) {
      console.error('Error fetching bill types:', error.message);
      return [];
    }
  }

  async getBillsInType(congress, billType) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/contents/data/${congress}/bills/${billType}`,
        { headers: this.headers }
      );
      
      return response.data.filter(item => item.type === 'dir');
    } catch (error) {
      console.error(`Error fetching ${billType} bills:`, error.message);
      return [];
    }
  }

  async getBillData(congress, billType, billNumber) {
    try {
      const dataResponse = await axios.get(
        `${this.baseUrl}/contents/data/${congress}/bills/${billType}/${billNumber}/data.json`,
        { headers: this.headers }
      );
      
      const billData = JSON.parse(Buffer.from(dataResponse.data.content, 'base64').toString());
      
      // Try to get full text
      let fullText = '';
      try {
        const textResponse = await axios.get(
          `${this.baseUrl}/contents/data/${congress}/bills/${billType}/${billNumber}/text-versions`,
          { headers: this.headers }
        );
        
        if (textResponse.data.length > 0) {
          const latestVersion = textResponse.data[0];
          const textFileResponse = await axios.get(
            `${this.baseUrl}/contents/data/${congress}/bills/${billType}/${billNumber}/text-versions/${latestVersion.name}/document.txt`,
            { headers: this.headers }
          );
          fullText = Buffer.from(textFileResponse.data.content, 'base64').toString();
        }
      } catch (textError) {
        console.log(`No full text available for ${billType}${billNumber}`);
      }

      return { ...billData, fullText };
    } catch (error) {
      console.error(`Error fetching bill data for ${billType}${billNumber}:`, error.message);
      return null;
    }
  }

  async scrapeBills() {
    const congress = await this.getCurrentCongress();
    console.log(`Scraping bills for Congress ${congress}`);

    const billTypes = await this.getBillTypes(congress);
    
    for (const billTypeDir of billTypes.slice(0, 2)) { // Limit for demo
      const billType = billTypeDir.name;
      console.log(`Processing ${billType} bills...`);
      
      const bills = await this.getBillsInType(congress, billType);
      
      for (const billDir of bills.slice(0, 5)) { // Limit for demo
        const billNumber = billDir.name;
        console.log(`Processing ${billType}${billNumber}...`);
        
        const billData = await this.getBillData(congress, billType, billNumber);
        if (!billData) continue;

        const billId = `${congress}-${billType}-${billNumber}`;
        
        const existingBill = await Bill.findOne({ billId });
        if (existingBill) {
          console.log(`Bill ${billId} already exists, skipping...`);
          continue;
        }

        const bill = new Bill({
          billId,
          congress,
          billType,
          billNumber: parseInt(billNumber),
          title: billData.title || '',
          summary: billData.summary?.text || '',
          fullText: billData.fullText || '',
          sponsors: billData.sponsors?.map(s => s.name) || [],
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
        console.log(`Saved bill ${billId}`);
        
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}

if (require.main === module) {
  const scraper = new CongressScraper();
  scraper.scrapeBills().then(() => {
    console.log('Scraping completed');
    process.exit(0);
  }).catch(error => {
    console.error('Scraping failed:', error);
    process.exit(1);
  });
}

module.exports = CongressScraper;