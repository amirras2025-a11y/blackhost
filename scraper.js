const Scraper = require('@ibrahim-rahhal/images-scraper');
const fs = require('fs');

async function main() {
  const query = process.env.SEARCH_QUERY;
  let limit = parseInt(process.env.IMAGE_LIMIT, 10);
  if (!query) {
    console.error('SEARCH_QUERY is required');
    process.exit(1);
  }
  if (isNaN(limit) || limit < 1) limit = 30;
  limit = Math.min(limit, 100);

  console.log(`🔍 Searching Google Images for "${query}" (limit: ${limit})`);

  const google = new Scraper({
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
  });

  try {
    const results = await google.scrape(query, limit);
    if (!results || results.length === 0) {
      console.warn('❌ No images found.');
      fs.writeFileSync('index.html', `<html><body><h1>No images found for "${query}".</h1></body></html>`);
      return;
    }

    let cards = '';
    for (let i = 0; i < results.length; i++) {
      const img = results[i];
      const sourceUrl = img.source || img.url || '#';
      cards += `<div class="card">...`; // (ساختار HTML مثل قبل)
    }
    // ... (ادامه کد برای تولید HTML)

  } catch (error) {
    console.error('❌ Scraping failed:', error);
    process.exit(1);
  }
}
main();
