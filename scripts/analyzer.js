const { Bill } = require('../server.js');
const natural = require('natural');

class PorkAnalyzer {
  constructor() {
    // Keywords that indicate potential pork barrel spending
    this.porkKeywords = [
      // Direct pork indicators
      'memorial', 'commemorative', 'honor', 'tribute', 'heritage', 'historic',
      'festival', 'celebration', 'cultural center', 'arts center', 'museum',
      'stadium', 'arena', 'sports facility', 'recreation center',
      'visitor center', 'tourism', 'beautification', 'enhancement',
      
      // Location-specific indicators
      'hometown', 'local', 'district', 'community center', 'neighborhood',
      'specific state', 'targeted location', 'various districts',
      
      // Project-specific indicators
      'renovation', 'expansion', 'improvement', 'upgrade', 'modernization',
      'construction project', 'infrastructure project', 'development project',
      
      // Funding pattern indicators
      'appropriates', 'allocates', 'provides funding', 'targeted funding',
      'special funding', 'earmark', 'designated for', 'specifically for'
    ];

    // Phrases that indicate high-value local projects (often pork)
    this.suspiciousPatterns = [
      /\$\d+\s*million.*(?:memorial|stadium|center|museum|festival)/gi,
      /(?:memorial|commemorative).*(?:bridge|highway|building)/gi,
      /\$\d+\s*million.*(?:hometown|district|local)/gi,
      /(?:various|specific|targeted).*(?:districts|locations|communities)/gi,
      /(?:renovation|expansion).*(?:stadium|arena|facility)/gi
    ];
  }

  extractMonetaryValues(text) {
    const amounts = [];
    
    // Match various currency formats
    const patterns = [
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:million|mil)/gi,
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:billion|bil)/gi,
      /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*million\s*dollars?/gi,
      /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*billion\s*dollars?/gi
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        let value = parseFloat(match[1].replace(/,/g, ''));
        
        // Convert to actual dollar amount
        if (match[0].toLowerCase().includes('billion')) {
          value *= 1000000000;
        } else if (match[0].toLowerCase().includes('million')) {
          value *= 1000000;
        }
        
        amounts.push({
          value,
          originalText: match[0],
          formatted: this.formatCurrency(value)
        });
      }
    });

    return amounts;
  }

  formatCurrency(amount) {
    if (amount >= 1000000000) {
      return `$${(amount / 1000000000).toFixed(1)}B`;
    } else if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    } else {
      return `$${amount.toLocaleString()}`;
    }
  }

  analyzePorkIndicators(text) {
    const indicators = [];
    const lowerText = text.toLowerCase();
    
    // Check for keyword matches
    this.porkKeywords.forEach(keyword => {
      if (lowerText.includes(keyword.toLowerCase())) {
        indicators.push({
          type: 'keyword',
          keyword,
          context: this.extractContext(text, keyword)
        });
      }
    });

    // Check for suspicious patterns
    this.suspiciousPatterns.forEach((pattern, index) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          indicators.push({
            type: 'pattern',
            pattern: `Suspicious Pattern ${index + 1}`,
            match,
            context: match
          });
        });
      }
    });

    return indicators;
  }

  extractContext(text, keyword, contextLength = 100) {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index === -1) return '';
    
    const start = Math.max(0, index - contextLength/2);
    const end = Math.min(text.length, index + keyword.length + contextLength/2);
    
    return '...' + text.substring(start, end) + '...';
  }

  identifyPorkItems(text, monetaryValues, indicators) {
    const porkItems = [];
    
    // Look for specific project mentions with funding
    const projectPatterns = [
      {
        pattern: /\$\d+[^.]*?(?:memorial|commemorative)[^.]*?(?:bridge|highway|building|center)/gi,
        type: 'Memorial Project'
      },
      {
        pattern: /\$\d+[^.]*?(?:stadium|arena|sports facility)[^.]*/gi,
        type: 'Sports Facility'
      },
      {
        pattern: /\$\d+[^.]*?(?:museum|cultural center|arts center)[^.]*/gi,
        type: 'Cultural Facility'
      },
      {
        pattern: /\$\d+[^.]*?(?:visitor center|tourism|beautification)[^.]*/gi,
        type: 'Tourism/Beautification'
      },
      {
        pattern: /\$\d+[^.]*?(?:university|research facility)[^.]*/gi,
        type: 'Educational Facility'
      },
      {
        pattern: /\$\d+[^.]*?(?:various|miscellaneous|community)[^.]*/gi,
        type: 'Various Local Projects'
      }
    ];

    projectPatterns.forEach(({ pattern, type }) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const amounts = this.extractMonetaryValues(match);
          const totalValue = amounts.reduce((sum, amt) => sum + amt.value, 0);
          
          porkItems.push({
            description: match.trim(),
            amount: amounts.length > 0 ? amounts[0].formatted : 'Amount unclear',
            beneficiary: this.extractBeneficiary(match),
            justification: this.assessJustification(match),
            suspicionLevel: this.calculateSuspicionLevel(match, totalValue),
            type,
            monetaryValue: totalValue
          });
        });
      }
    });

    return porkItems;
  }

  extractBeneficiary(text) {
    // Try to identify who benefits from the spending
    const beneficiaryPatterns = [
      /in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /(?:sponsors?|representative|senator)\s+([A-Z][a-z]+)/i
    ];

    for (const pattern of beneficiaryPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'Specific locality/district';
  }

  assessJustification(text) {
    const justificationKeywords = [
      'infrastructure', 'economic development', 'job creation', 'safety',
      'education', 'research', 'healthcare', 'transportation'
    ];

    const foundJustifications = justificationKeywords.filter(keyword =>
      text.toLowerCase().includes(keyword)
    );

    if (foundJustifications.length > 0) {
      return `Claimed: ${foundJustifications.join(', ')}`;
    }

    return 'No clear public benefit justification';
  }

  calculateSuspicionLevel(text, value) {
    let suspicionScore = 0;

    // High suspicion indicators
    if (text.toLowerCase().includes('memorial')) suspicionScore += 3;
    if (text.toLowerCase().includes('hometown')) suspicionScore += 3;
    if (text.toLowerCase().includes('festival')) suspicionScore += 2;
    if (text.toLowerCase().includes('stadium')) suspicionScore += 2;
    if (text.toLowerCase().includes('various')) suspicionScore += 2;
    if (text.toLowerCase().includes('targeted')) suspicionScore += 2;

    // Value-based suspicion
    if (value > 50000000) suspicionScore += 2; // Over $50M
    if (value > 100000000) suspicionScore += 1; // Over $100M

    // Length-based suspicion (very specific = more suspicious)
    if (text.length > 100) suspicionScore += 1;

    if (suspicionScore >= 5) return 'high';
    if (suspicionScore >= 3) return 'medium';
    return 'low';
  }

  async analyzeAllBills() {
    try {
      console.log('🔍 Starting pork barrel analysis...');
      
      // Get all bills that haven't been analyzed yet
      const bills = await Bill.find({
        $or: [
          { 'porkAnalysis.analysisDate': { $exists: false } },
          { 'porkAnalysis.analysisDate': null }
        ]
      });

      console.log(`Analyzing ${bills.length} bills for pork...`);

      if (bills.length === 0) {
        console.log('No bills found to analyze');
        return { analyzed: 0, withPork: 0 };
      }

      let billsWithPork = 0;
      let totalPorkValue = 0;

      for (const bill of bills) {
        console.log(`Analyzing ${bill.billId}: ${bill.title}`);
        
        // Combine all text for analysis
        const analysisText = [
          bill.title || '',
          bill.summary || '',
          bill.fullText || ''
        ].join(' ');

        // Extract monetary values
        const monetaryValues = this.extractMonetaryValues(analysisText);
        
        // Find pork indicators
        const indicators = this.analyzePorkIndicators(analysisText);
        
        // Identify specific pork items
        const porkItems = this.identifyPorkItems(analysisText, monetaryValues, indicators);
        
        // Calculate total pork value
        const billPorkValue = porkItems.reduce((sum, item) => 
          sum + (item.monetaryValue || 0), 0
        );

        // Determine if bill has pork
        const hasPork = porkItems.length > 0 || indicators.length >= 3;

        if (hasPork) {
          billsWithPork++;
          totalPorkValue += billPorkValue;
          console.log(`  🐷 PORK DETECTED: ${porkItems.length} items, ${this.formatCurrency(billPorkValue)}`);
        } else {
          console.log(`  ✅ CLEAN: No pork detected`);
        }

        // Update bill with analysis
        bill.porkAnalysis = {
          hasPork,
          porkItems,
          totalPorkValue: billPorkValue,
          analysisDate: new Date(),
          indicators: indicators.length,
          confidence: this.calculateConfidence(porkItems, indicators)
        };

        await bill.save();
      }

      console.log(`\n🎉 Analysis completed!`);
      console.log(`📊 Bills analyzed: ${bills.length}`);
      console.log(`🐷 Bills with pork: ${billsWithPork}`);
      console.log(`💰 Total pork value: ${this.formatCurrency(totalPorkValue)}`);
      console.log(`📈 Pork percentage: ${((billsWithPork / bills.length) * 100).toFixed(1)}%`);

      return {
        analyzed: bills.length,
        withPork: billsWithPork,
        totalValue: totalPorkValue
      };
    } catch (error) {
      console.error('❌ Analysis failed:', error.message);
      throw error;
    }
  }

  calculateConfidence(porkItems, indicators) {
    let confidence = 0;
    
    // High confidence if specific monetary pork items found
    if (porkItems.length > 0) confidence += 70;
    
    // Add confidence based on number of indicators
    confidence += Math.min(indicators.length * 5, 30);
    
    return Math.min(confidence, 100);
  }

  async analyzeSingleBill(billId) {
    try {
      const bill = await Bill.findOne({ billId });
      if (!bill) {
        throw new Error(`Bill ${billId} not found`);
      }

      console.log(`Analyzing single bill: ${billId}`);
      
      const analysisText = [bill.title, bill.summary, bill.fullText].join(' ');
      const monetaryValues = this.extractMonetaryValues(analysisText);
      const indicators = this.analyzePorkIndicators(analysisText);
      const porkItems = this.identifyPorkItems(analysisText, monetaryValues, indicators);
      const billPorkValue = porkItems.reduce((sum, item) => sum + (item.monetaryValue || 0), 0);
      const hasPork = porkItems.length > 0 || indicators.length >= 3;

      bill.porkAnalysis = {
        hasPork,
        porkItems,
        totalPorkValue: billPorkValue,
        analysisDate: new Date(),
        indicators: indicators.length,
        confidence: this.calculateConfidence(porkItems, indicators)
      };

      await bill.save();
      
      return bill.porkAnalysis;
    } catch (error) {
      console.error(`Error analyzing bill ${billId}:`, error.message);
      throw error;
    }
  }
}

if (require.main === module) {
  const analyzer = new PorkAnalyzer();
  analyzer.analyzeAllBills().then((result) => {
    console.log('Analysis completed:', result);
    process.exit(0);
  }).catch(error => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });
}

module.exports = PorkAnalyzer;