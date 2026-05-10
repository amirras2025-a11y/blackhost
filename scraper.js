const { GoogleImagesScraper } = require('google-images-scraper');
const fs = require('fs');

async function main() {
  const query = process.env.SEARCH_QUERY;
  let limit = parseInt(process.env.IMAGE_LIMIT, 10);
  const safeMode = process.env.SAFE_MODE === 'true';

  if (!query) {
    console.error('SEARCH_QUERY is required');
    process.exit(1);
  }
  if (isNaN(limit) || limit < 1) limit = 30;
  limit = Math.min(limit, 100);

  console.log(`🔍 Searching Google Images for "${query}" (limit: ${limit}, safe: ${safeMode})`);

  const scraper = new GoogleImagesScraper({
    query: query,
    limit: limit,
    safe: safeMode,   // true = safe search on
    puppeteerOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  try {
    const images = await scraper.scrape();

    if (!images || images.length === 0) {
      console.warn('❌ No images found.');
      fs.writeFileSync('index.html', `<html><body><h1>No images found for "${query}".</h1></body></html>`);
      return;
    }

    console.log(`✅ Retrieved ${images.length} images. Generating HTML...`);

    // ساخت کارت‌های HTML
    let cards = '';
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const imgUrl = img.url || '';
      const sourceUrl = img.source || img.url || '#';
      cards += `
      <div class="card">
        <div class="img-wrapper">
          <img src="${escapeHtml(imgUrl)}" alt="Image ${i+1}" loading="lazy" onerror="this.style.opacity='0.2'">
        </div>
        <div class="info">
          <div class="source">
            🔗 <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceUrl.substring(0, 70))}${sourceUrl.length > 70 ? '…' : ''}</a>
            <button class="copy-btn" data-link="${escapeHtml(sourceUrl)}">📋 Copy</button>
          </div>
          ${img.title ? `<div class="title">📝 ${escapeHtml(img.title)}</div>` : ''}
        </div>
      </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Image Gallery: ${escapeHtml(query)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; padding: 20px; }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 10px; color: #1a1a2e; }
    .sub { text-align: center; margin-bottom: 30px; color: #4a4a6a; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; }
    .card { background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); transition: transform 0.2s, box-shadow 0.2s; }
    .card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px rgba(0,0,0,0.1); }
    .img-wrapper { aspect-ratio: 16/9; background: #e9ecef; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .img-wrapper img { width: 100%; height: 100%; object-fit: contain; background: #f0f0f0; }
    .info { padding: 12px 15px; }
    .source { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.75rem; background: #f8f9fa; padding: 6px 10px; border-radius: 30px; }
    .source a { color: #0066cc; text-decoration: none; word-break: break-all; flex: 1; }
    .source a:hover { text-decoration: underline; }
    .copy-btn { background: #e9ecef; border: none; padding: 4px 12px; border-radius: 20px; cursor: pointer; font-size: 0.7rem; font-weight: 500; transition: background 0.2s; }
    .copy-btn:hover { background: #dee2e6; }
    .title { font-size: 0.7rem; color: #6c757d; margin-top: 8px; word-break: break-word; }
    footer { text-align: center; margin-top: 40px; color: #6c757d; font-size: 0.75rem; border-top: 1px solid #dee2e6; padding-top: 20px; }
    @media (max-width: 640px) { .gallery { gap: 15px; } }
  </style>
</head>
<body>
<div class="container">
  <h1>🖼️ Google Image Gallery</h1>
  <div class="sub">🔍 "${escapeHtml(query)}" — ${images.length} images</div>
  <div class="gallery">${cards}</div>
  <footer>Images belong to their respective owners. Source links point to original webpages.</footer>
</div>
<script>
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const link = btn.getAttribute('data-link');
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      const old = btn.innerText;
      btn.innerText = '✅ Copied!';
      setTimeout(() => btn.innerText = old, 1500);
    } catch(e) {
      prompt('Copy manually:', link);
    }
  });
});
</script>
</body>
</html>`;

    fs.writeFileSync('index.html', html);
    console.log('✅ index.html generated successfully.');

  } catch (error) {
    console.error('❌ Scraping failed:', error);
    process.exit(1);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

main();
