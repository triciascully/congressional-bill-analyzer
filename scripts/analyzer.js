// scripts/analyzer.js
const natural = require('natural');
const { Bill } = require('../server.js');

class PorkAnalyzer {
  constructor() {
    // Keywords and phrases that indicate potential pork barrel spending
    this.porkKeywords = [
      'earmark', 'special project', 'bridge to nowhere', 'museum', 'cultural center',
      'visitor center', 'renovation', 'beautification', 'arts center', 'sports facility',
      'stadium', 'arena', 'conference center', 'community center', 'festival',
      'celebration', 'commemoration', 'memorial', 'monument', 'statue',
      'naming rights', 'research facility', 'laboratory', 'university project',
      'college project', 'local project', 'hometown project', 'district project'
    ];

    this.suspiciousPatterns = [
      /\$[\d,]+\s+(?:million|billion).*(?:for|to)\s+[\w\s]+(?:in|at|near)\s+[\w\s,]+/gi,
      /appropriat\w+.*\$[\d,]+.*for.*(?:construct|build|establish|create)/gi,
      /fund\w+.*\$[\d,]+.*(?:project|facility|center|institute)/gi
    ];

    this.locationIndicators = [
      'in the district of', 'in the state of', 'located in', 'situated in',
      'serving', 'benefiting', 'for the benefit of'
    ];
  }

  extractMonetaryAmounts(text) {
    const moneyPattern = /\$([0-9,]+(?:\.[0-9]{2})?)\s*(million|billion|thousand)?/gi;
    const amounts = [];
    let match;

    while ((match = moneyPattern.exec(text)) !== null) {
      let amount = parseFloat(match[1].replace(/,/g, ''));
      const multiplier = match[2]?.toLowerCase();
      
      if (multiplier === 'million') amount *= 1000000;
      else if (multiplier === 'billion') amount *= 1000000000;
      else if (multiplier === 'thousand') amount *= 1000;

      amounts.push({
        original: match[0],
        amount: amount,
        context: this.getContext(text, match.index, 100)
      });
    }

    return amounts;
  }

  getContext(text, index, radius = 50) {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius);
    return text.slice(start, end);
  }

  identifyPorkItems(bill) {
    const porkItems = [];
    const text = `${bill.title} ${bill.summary} ${bill.fullText}`.toLowerCase();
    
    // Look for suspicious spending patterns
    for (const pattern of this.suspiciousPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const context = this.getContext(text, match.index, 200);
        const amounts = this.extractMonetaryAmounts(match[0]);
        
        if (amounts.length > 0) {
          porkItems.push({
            description: match[0].trim(),
            amount: amounts[0].original,
            beneficiary: this.extractBeneficiary(context),
            justification: this.extractJustification(context),
            suspicionLevel: this.calculateSuspicionLevel(match[0], context)
          });
        }
      }
    }

    // Look for keyword-based pork indicators
    for (const keyword of this.porkKeywords) {
      const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
      if (keywordRegex.test(text)) {
        const matches = text.match(new RegExp(`.{0,100}\\b${keyword}\\b.{0,100}`, 'gi'));
        
        for (const match of matches || []) {
          const amounts = this.extractMonetaryAmounts(match);
          if (amounts.length > 0) {
            porkItems.push({
              description: match.trim(),
              amount: amounts[0].original,
              beneficiary: this.extractBeneficiary(match),
              justification: `Contains keyword: ${keyword}`,
              suspicionLevel: 'medium'
            });
          }
        }
      }
    }

    return porkItems;
  }

  extractBeneficiary(text) {
    // Simple extraction of potential beneficiaries
    const statePattern = /(?:in|of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
    const matches = text.match(statePattern);
    return matches ? matches[0] : 'Unknown';
  }

  extractJustification(text) {
    // Look for justification phrases
    const justificationPatterns = [
      /(?:for|to)\s+([^.]{10,50})/i,
      /(?:purpose|intended|designed)\s+([^.]{10,50})/i
    ];

    for (const pattern of justificationPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    return 'No clear justification found';
  }

  calculateSuspicionLevel(description, context) {
    let score = 0;
    
    // Check for high-value amounts
    const amounts = this.extractMonetaryAmounts(description + context);
    const maxAmount = Math.max(...amounts.map(a => a.amount), 0);
    
    if (maxAmount > 100000000) score += 3; // >100M
    else if (maxAmount > 10000000) score += 2; // >10M
    else if (maxAmount > 1000000) score += 1; // >1M

    // Check for location specificity
    if (this.locationIndicators.some(indicator => 
      context.toLowerCase().includes(indicator))) {
      score += 2;
    }

    // Check for vague or questionable purposes
    const vagueTerms = ['various', 'miscellaneous', 'other', 'general', 'unspecified'];
    if (vagueTerms.some(term => description.toLowerCase().includes(term))) {
      score += 1;
    }

    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  async analyzeBill(billId) {
    const bill = await Bill.findOne({ billId });
    if (!bill) {
      throw new Error(`Bill ${billId} not found`);
    }

    const porkItems = this.identifyPorkItems(bill);
    const totalPorkValue = porkItems.reduce((sum, item) => {
      const amounts = this.extractMonetaryAmounts(item.amount);
      return sum + (amounts[0]?.amount || 0);
    }, 0);

    bill.porkAnalysis = {
      hasPork: porkItems.length > 0,
      porkItems,
      totalPorkValue,
      analysisDate: new Date()
    };

    await bill.save();
    console.log(`Analyzed bill ${billId}: Found ${porkItems.length} potential pork items`);
    
    return bill.porkAnalysis;
  }

  async analyzeAllBills() {
    const bills = await Bill.find({ 'porkAnalysis.analysisDate': { $exists: false } });
    console.log(`Analyzing ${bills.length} bills for pork...`);

    for (const bill of bills) {
      try {
        await this.analyzeBill(bill.billId);
      } catch (error) {
        console.error(`Error analyzing bill ${bill.billId}:`, error.message);
      }
    }

    console.log('Analysis completed');
  }
}

if (require.main === module) {
  const analyzer = new PorkAnalyzer();
  analyzer.analyzeAllBills().then(() => {
    console.log('All bills analyzed');
    process.exit(0);
  }).catch(error => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });
}

module.exports = PorkAnalyzer;