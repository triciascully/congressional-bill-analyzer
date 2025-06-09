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

  async testConnection() {
    try {
      console.log('Testing GitHub API connection...');
      const response = await axios.get(this.baseUrl, { headers: this.headers });
      console.log('✅ Repository accessible');
      return true;
    } catch (error) {
      console.error('❌ Repository access failed:', error.message);
      throw error;
    }
  }

  async getBillTypes(congress) {
    try {
      console.log(`Fetching bill types for Congress ${congress}...`);
      
      // First, check if the congress data directory exists
      const congressPath = `${this.baseUrl}/contents/data/${congress}`;
      const congressResponse = await axios.get(congressPath, { headers: this.headers });
      
      console.log(`Found ${congressResponse.data.length} items in Congress ${congress} data directory`);
      
      // Look for bills directory
      const billsDir = congressResponse.data.find(item => 
        item.type === 'dir' && item.name === 'bills'
      );
      
      if (!billsDir) {
        console.log('No bills directory found, trying alternative structure...');
        // Try direct bill type access
        return await this.getAlternativeBillTypes(congress);
      }
      
      // Get bill types from bills directory
      const billTypesPath = `${this.baseUrl}/contents/data/${congress}/bills`;
      const response = await axios.get(billTypesPath, { headers: this.headers });
      
      const billTypes = response.data.filter(item => item.type === 'dir');
      console.log(`Found bill types: ${billTypes.map(bt => bt.name).join(', ')}`);
      
      return billTypes;
    } catch (error) {
      console.error('Error fetching bill types:', error.message);
      if (error.response?.status === 404) {
        console.log('Bills directory not found, trying alternative approach...');
        return await this.getAlternativeBillTypes(congress);
      }
      throw error;
    }
  }

  async getAlternativeBillTypes(congress) {
    // Try common bill types directly
    const commonBillTypes = ['hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres'];
    const validBillTypes = [];
    
    for (const billType of commonBillTypes.slice(0, 2)) { // Limit to first 2 for testing
      try {
        const testPath = `${this.baseUrl}/contents/data/${congress}/bills/${billType}`;
        await axios.get(testPath, { headers: this.headers });
        validBillTypes.push({ name: billType, type: 'dir' });
        console.log(`✅ Found bill type: ${billType}`);
      } catch (error) {
        console.log(`❌ Bill type ${billType} not found`);
      }
    }
    
    return validBillTypes;
  }

  async getBillsInType(congress, billType) {
    try {
      console.log(`Fetching bills for type ${billType}...`);
      const response = await axios.get(
        `${this.baseUrl}/contents/data/${congress}/bills/${billType}`,
        { headers: this.headers }
      );
      
      const bills = response.data.filter(item => item.type === 'dir');
      console.log(`Found ${bills.length} bills in ${billType}`);
      return bills.slice(0, 3); // Limit to 3 bills for testing
    } catch (error) {
      console.error(`Error fetching ${billType} bills:`, error.message);
      return [];
    }
  }

  async getBillData(congress, billType, billNumber) {
    try {
      console.log(`Fetching data for ${billType}${billNumber}...`);
      
      // Get bill metadata
      const dataPath = `${this.baseUrl}/contents/data/${congress}/bills/${billType}/${billNumber}/data.json`;
      const dataResponse = await axios.get(dataPath, { headers: this.headers });
      
      if (!dataResponse.data.content) {
        throw new Error('No content in data.json response');
      }
      
      const billData = JSON.parse(Buffer.from(dataResponse.data.content, 'base64').toString());
      
      // Try to get full text (optional)
      let fullText = '';
      try {
        const textVersionsPath = `${this.baseUrl}/contents/data/${congress}/bills/${billType}/${billNumber}/text-versions`;
        const textResponse = await axios.get(textVersionsPath, { headers: this.headers });
        
        if (textResponse.data.length > 0) {
          const latestVersion = textResponse.data[0];
          const textFilePath = `${this.baseUrl}/contents/data/${congress}/bills/${billType}/${billNumber}/text-versions/${latestVersion.name}/document.txt`;
          
          try {
            const textFileResponse = await axios.get(textFilePath, { headers: this.headers });
            fullText = Buffer.from(textFileResponse.data.content, 'base64').toString();
            console.log(`✅ Got full text for ${billType}${billNumber} (${fullText.length} chars)`);
          } catch (textError) {
            console.log(`No full text file for ${billType}${billNumber}`);
          }
        }
      } catch (textError) {
        console.log(`No text versions available for ${billType}${billNumber}`);
      }

      return { ...billData, fullText };
    } catch (error) {
      console.error(`Error fetching bill data for ${billType}${billNumber}:`, error.message);
      if (error.response?.status === 404) {
        console.log(`Bill ${billType}${billNumber} data not found, skipping...`);
      }
      return null;
    }
  }

  async scrapeBills() {
    try {
      console.log('🚀 Starting bill scraping process...');
      
      // Test connection first
      await this.testConnection();
      
      const congress = await this.getCurrentCongress();
      console.log(`Scraping bills for Congress ${congress}`);

      const billTypes = await this.getBillTypes(congress);
      
      if (billTypes.length === 0) {
        throw new Error('No bill types found. Check GitHub repository structure.');
      }
      
      let totalProcessed = 0;
      let totalSaved = 0;
      
      for (const billTypeDir of billTypes) {
        const billType = billTypeDir.name;
        console.log(`\n📋 Processing ${billType} bills...`);
        
        const bills = await this.getBillsInType(congress, billType);
        console.log(`Found ${bills.length} bills to process`);
        
        for (const billDir of bills) {
          const billNumber = billDir.name;
          totalProcessed++;
          
          console.log(`Processing ${billType}${billNumber} (${totalProcessed})...`);
          
          const billData = await this.getBillData(congress, billType, billNumber);
          if (!billData) {
            console.log(`Skipping ${billType}${billNumber} - no data available`);
            continue;
          }

          const billId = `${congress}-${billType}-${billNumber}`;
          
          // Check if bill already exists
          const existingBill = await Bill.findOne({ billId });
          if (existingBill) {
            console.log(`Bill ${billId} already exists, skipping...`);
            continue;
          }

          // Create and save bill
          try {
            const bill = new Bill({
              billId,
              congress,
              billType,
              billNumber: parseInt(billNumber) || 0,
              title: billData.title || `${billType.toUpperCase()} ${billNumber}`,
              summary: billData.summary?.text || '',
              fullText: billData.fullText || '',
              sponsors: billData.sponsors?.map(s => s.name || s.title || 'Unknown') || [],
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
            totalSaved++;
            console.log(`✅ Saved bill ${billId} (${totalSaved} total saved)`);
          } catch (saveError) {
            console.error(`Error saving bill ${billId}:`, saveError.message);
          }
          
          // Add delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      console.log(`\n🎉 Scraping completed!`);
      console.log(`📊 Total processed: ${totalProcessed}`);
      console.log(`💾 Total saved: ${totalSaved}`);
      
      return { totalProcessed, totalSaved };
    } catch (error) {
      console.error('❌ Scraping failed:', error.message);
      throw error;
    }
  }
}

if (require.main === module) {
  const scraper = new CongressScraper();
  scraper.scrapeBills().then((result) => {
    console.log('Scraping completed:', result);
    process.exit(0);
  }).catch(error => {
    console.error('Scraping failed:', error);
    process.exit(1);
  });
}

module.exports = CongressScraper;