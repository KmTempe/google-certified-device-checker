// Rate Limiter Test Script for Chrome DevTools Console
// Tests the API rate limit (100 requests/hour per IP)

const API_URL = "" ; /* 'https://api.example.com/check'; */  
const localAPIUrl = 'http://localhost:8000/check';

async function testRateLimiter(numRequests = 105) {
  console.log(`🚀 Starting rate limiter test with ${numRequests} requests...`);
  console.log(`⏰ Rate limit: 100 requests/hour per IP`);
  console.log('---');

  const results = {
    successful: 0,
    rateLimited: 0,
    errors: 0,
    responses: []
  };

  for (let i = 1; i <= numRequests; i++) {
    try {
      const cacheBuster = `${Date.now()}-${i}`;
      const response = await fetch(`${localAPIUrl}?model=Pixel&_=${cacheBuster}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        cache: 'no-store'
      });

      const status = response.status;
      
      if (status === 200) {
        results.successful++;
        console.log(`✅ Request ${i}/${numRequests}: Success (${status})`);
      } else if (status === 429) {
        results.rateLimited++;
        const data = await response.json();
        console.log(`🛑 Request ${i}/${numRequests}: RATE LIMITED (${status})`);
        console.log(`   Message: ${data.detail || 'Too many requests'}`);
        
        // Stop after first rate limit hit
        if (results.rateLimited === 1) {
          console.log('---');
          console.log('⚠️  Rate limit reached! Stopping test.');
          break;
        }
      } else {
        results.errors++;
        console.log(`❌ Request ${i}/${numRequests}: Error (${status})`);
      }

      results.responses.push({ request: i, status });

      // Small delay to avoid overwhelming the server
      if (i % 10 === 0) {
        console.log(`   Progress: ${i}/${numRequests} requests sent...`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      results.errors++;
      console.log(`❌ Request ${i}/${numRequests}: Network error - ${error.message}`);
    }
  }

  // Summary
  console.log('---');
  console.log('📊 TEST RESULTS:');
  console.log(`   ✅ Successful requests: ${results.successful}`);
  console.log(`   🛑 Rate limited requests: ${results.rateLimited}`);
  console.log(`   ❌ Error requests: ${results.errors}`);
  console.log(`   📈 Total requests sent: ${results.successful + results.rateLimited + results.errors}`);
  
  if (results.rateLimited > 0) {
    console.log('---');
    console.log('✅ Rate limiter is working correctly!');
    console.log(`   Blocked requests after ${results.successful} successful attempts`);
  } else if (results.successful >= 100) {
    console.log('---');
    console.log('⚠️  Warning: Sent 100+ requests without hitting rate limit');
    console.log('   This might indicate the rate limiter is not working as expected');
  }

  return results;
}

// Quick test - sends requests until rate limited
async function quickTest() {
  console.log('🔥 QUICK TEST - Finding rate limit threshold...');
  await testRateLimiter(105);
}

// Instructions
console.log('🔧 Rate Limiter Test Script Loaded!');
console.log('');
console.log('Available commands:');
console.log('  quickTest()           - Send 105 requests to test rate limit');
console.log('  testRateLimiter(N)    - Send N requests (default: 105)');
console.log('');
console.log('⚡ Run: quickTest()');
