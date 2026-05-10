const google = require('google-imgs');
const fs = require('fs');
const path = require('path');

const query = process.env.SEARCH_QUERY;
let limit = parseInt(process.env.IMAGE_LIMIT, 10);
const isUnsafe = process.env.UNSAFE_MODE === 'true';

if (!query) {
    console.error('Search query is required');
    process.exit(1);
}

if (isNaN(limit) || limit < 1) limit = 30;
limit = Math.min(limit, 100);  

async function getImageLinks() {
    console.log(`Starting search for "${query}" (Limit: ${limit}, Unsafe: ${!isUnsafe})...`);
    
    const options = {
        limit: limit,
        safe: !isUnsafe   
    };

    try {
        const imageList = await google.image(query, options);
        
        if (!imageList || imageList.length === 0) {
            console.warn('No images found.');
            return [];
        }
        
        const cleanResults = imageList.map(img => ({
            url: img.url, 
            source: img.source, 
            title: img.title, 
            width: img.width, 
            height: img.height, 
            type: img.type 
        }));
        
        console.log(`Successfully extracted ${cleanResults.length} images.`);
        return cleanResults;
    } catch (error) {
        console.error('Error during scraping:', error);
        return [];
    }
}

function generateHtml(imageData, query, downloadTime) {
    if (!imageData || imageData.length === 0) {
        return `<html><body><p>No results found for "${query}".</p></body></html>`;
    }

    let cardsHtml = '';
    for (let i = 0; i < imageData.length; i++) {
        const img = imageData[i];
        cardsHtml += `
        <div class="card">
            <div class="img-wrapper">
                <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.title || 'Image')}" loading="lazy" onerror="this.style.opacity='0.3'">
            </div>
            <div class="info">
                <div class="source-link">
                    <span>🔗 Source:</span>
                    <a href="${escapeHtml(img.source || '#')}" target="_blank" rel="noopener noreferrer">
                        ${escapeHtml(img.source || 'No source link')}
                    </a>
                    <button class="copy-btn" data-link="${escapeHtml(img.source || '')}" 
                        ${!img.source ? 'disabled' : ''}>
                        📋 Copy
                    </button>
                </div>
                ${img.title ? `<div class="title">📝 ${escapeHtml(img.title)}</div>` : ''}
                ${(img.width && img.height) ? `<div class="dimensions">📏 ${img.width}x${img.height}px</div>` : ''}
            </div>
        </div>`;
    }

    const currentTime = downloadTime || new Date().toLocaleString();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🖼️ Image Gallery: ${escapeHtml(query)}</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
            .container { max-width: 1400px; margin: 0 auto; }
            header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #ddd; }
            h1 { font-size: 1.8rem; margin-bottom: 8px; }
            .query { background: #e9ecef; display: inline-block; padding: 5px 12px; border-radius: 20px; font-size: 0.9rem; margin-top: 8px; }
            .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 25px; }
            .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; display: flex; flex-direction: column; }
            .card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px rgba(0,0,0,0.12); }
            .img-wrapper { aspect-ratio: 16 / 9; background: #1a1a1a; display: flex; align-items: center; justify-content: center; overflow: hidden; }
            .img-wrapper img { width: 100%; height: 100%; object-fit: contain; transition: transform 0.3s; background: #f0f0f0; }
            .card:hover .img-wrapper img { transform: scale(1.02); }
            .info { padding: 12px 15px; flex: 1; display: flex; flex-direction: column; gap: 8px; background: #fff; border-top: 1px solid #eee; }
            .source-link { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 0.75rem; margin-bottom: 5px; background: #f8f9fa; padding: 8px; border-radius: 20px; }
            .source-link span { font-weight: 600; }
            .source-link a { color: #0066cc; text-decoration: none; word-break: break-all; flex: 1; }
            .source-link a:hover { text-decoration: underline; }
            .copy-btn { background: #e9ecef; border: none; padding: 6px 12px; border-radius: 30px; cursor: pointer; font-size: 0.7rem; font-weight: 500; transition: background 0.2s; }
            .copy-btn:hover:not(:disabled) { background: #dee2e6; }
            .copy-btn:active { background: #ced4da; }
            .copy-btn:disabled { opacity: 0.5; cursor: not-allowed; background: #e9ecef; }
            .title { font-size: 0.75rem; color: #555; border-top: 1px dashed #eee; margin-top: 5px; padding-top: 5px; word-break: break-word; }
            .dimensions { font-size: 0.7rem; color: #777; font-family: monospace; text-align: right; }
            footer { margin-top: 40px; text-align: center; font-size: 0.8rem; color: #777; border-top: 1px solid #ddd; padding-top: 20px; }
            @media (max-width: 640px) { .gallery { gap: 15px; } }
        </style>
    </head>
    <body>
    <div class="container">
        <header>
            <h1>🖼️ Google Image Gallery</h1>
            <div class="query">🔍 ${escapeHtml(query)}</div>
            <div class="query">📸 Images: ${imageData.length}   |   🕒 Generated: ${currentTime}</div>
        </header>
        <div class="gallery">
            ${cardsHtml}
        </div>
        <footer>
            ⚠️ Images belong to their respective owners. This gallery is auto-generated.
            <br><small>Click on the source link to visit the original website.</small>
        </footer>
    </div>
    <script>
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const link = btn.getAttribute('data-link');
                if (!link) return;
                try {
                    await navigator.clipboard.writeText(link);
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '✅ Copied!';
                    setTimeout(() => btn.innerHTML = originalText, 1500);
                } catch (err) {
                    alert('Please copy the link manually: ' + link);
                }
            });
        });
    </script>
    </body>
    </html>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
        return c;
    });
}

(async () => {
    const images = await getImageLinks();
    const htmlContent = generateHtml(images, query, new Date().toLocaleString());
    fs.writeFileSync('index.html', htmlContent, 'utf-8');
    console.log('index.html generated successfully.');
})();
