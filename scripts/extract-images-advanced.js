const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const pageUrl = process.env.PAGE_URL;
const waitTime = parseInt(process.env.WAIT_TIME) || 3;
const enableScroll = process.env.ENABLE_SCROLL === 'true';

if (!pageUrl) {
  console.error('❌ PAGE_URL environment variable is required');
  process.exit(1);
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScroll(page) {
  console.log('📜 Auto-scrolling to load lazy images...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
  await sleep(2000);
}

async function getAllImagesWithLinks(page) {
  const imagesData = await page.evaluate(() => {
    const images = new Map();
    
    // تابع کمکی برای پیدا کردن لینک مرتبط با یک عنصر
    function findAssociatedLink(element) {
      // چک کن اگر خود عنصر داخل لینک است
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        if (parent.tagName === 'A' && parent.href) {
          return parent.href;
        }
        parent = parent.parentElement;
      }
      
      // چک کردن sibling ها
      const parentContainer = element.closest('.gallery-item, .product-item, .post-item, article, .card, figure');
      if (parentContainer) {
        const linkInContainer = parentContainer.querySelector('a:not([href^="javascript"]):not([href^="#"])');
        if (linkInContainer && linkInContainer.href) {
          return linkInContainer.href;
        }
      }
      
      // چک کردن attribute های مختلف
      const dataLink = element.getAttribute('data-link') || 
                      element.getAttribute('data-url') || 
                      element.getAttribute('data-href') ||
                      element.getAttribute('data-page-url');
      if (dataLink) return dataLink;
      
      return null;
    }
    
    // 1. استخراج از تگ‌های img با بررسی لینک والد
    document.querySelectorAll('img').forEach(img => {
      let src = img.src || img.getAttribute('src');
      let dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original');
      let srcset = img.srcset || img.getAttribute('data-srcset');
      
      // پیدا کردن لینک مرتبط
      let associatedLink = findAssociatedLink(img);
      
      // اگر لینک پیدا نشد، چک کن آیا خود تصویر لینک دارد
      if (!associatedLink && img.closest('a')) {
        associatedLink = img.closest('a').href;
      }
      
      const imgInfo = {
        type: 'img',
        alt: img.alt || img.getAttribute('title') || '',
        link: associatedLink,
        width: img.width,
        height: img.height
      };
      
      if (src && src.startsWith('http') && !images.has(src)) {
        images.set(src, { src, ...imgInfo });
      }
      if (dataSrc && dataSrc.startsWith('http') && !images.has(dataSrc)) {
        images.set(dataSrc, { src: dataSrc, ...imgInfo });
      }
      if (srcset) {
        const srcsetUrls = srcset.split(',').map(s => s.trim().split(' ')[0]);
        srcsetUrls.forEach(url => {
          if (url.startsWith('http') && !images.has(url)) {
            images.set(url, { src: url, ...imgInfo });
          }
        });
      }
    });
    
    // 2. تصاویر background - معمولاً لینک ندارن ولی میتونن از parent بگیرن
    document.querySelectorAll('[style*="background"], [style*="background-image"]').forEach(el => {
      const style = el.style.backgroundImage || el.style.cssText;
      if (style) {
        const match = style.match(/url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          let url = match[1];
          if (url.startsWith('http') && !images.has(url)) {
            let associatedLink = findAssociatedLink(el);
            images.set(url, { 
              src: url, 
              type: 'background', 
              alt: '', 
              link: associatedLink,
              width: 0,
              height: 0
            });
          }
        }
      }
    });
    
    // 3. تصاویر داخل آلبوم‌ها یا گالری‌ها
    document.querySelectorAll('a:has(img), a[href$=".jpg"], a[href$=".png"], a[href$=".jpeg"], a[href$=".gif"], a[href$=".webp"]').forEach(link => {
      const imgInside = link.querySelector('img');
      if (imgInside && imgInside.src) {
        let imgUrl = imgInside.src;
        if (!images.has(imgUrl)) {
          images.set(imgUrl, {
            src: imgUrl,
            type: 'image-link',
            alt: imgInside.alt || '',
            link: link.href,
            width: imgInside.width,
            height: imgInside.height
          });
        }
      }
    });
    
    return Array.from(images.values());
  });
  
  return imagesData;
}

// تبدیل تصاویر مختلف به base64 (همون تابع قبلی)
async function downloadImageAsBase64(page, imageUrl, referer) {
  try {
    const response = await page.goto(imageUrl, {
      waitUntil: 'networkidle',
      timeout: 10000
    });
    
    if (response && response.ok()) {
      const buffer = await response.body();
      const contentType = response.headers()['content-type'];
      let mimeType = contentType?.split(';')[0] || 'image/jpeg';
      const base64 = buffer.toString('base64');
      return `data:${mimeType};base64,${base64}`;
    }
    return null;
  } catch (error) {
    try {
      const base64 = await page.evaluate(async (url) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL());
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
      }, imageUrl);
      return base64;
    } catch (err) {
      return null;
    }
  }
}

async function main() {
  console.log('🚀 Starting advanced image extraction with link detection...');
  console.log(`📍 Target URL: ${pageUrl}`);
  console.log(`⏱️  Wait time: ${waitTime}s`);
  console.log(`📜 Auto scroll: ${enableScroll}`);
  console.log('🌐 Launching browser...\n');
  
  let browser;
  let page;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });
    
    page = await browser.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,fa;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    });
    
    console.log(`📖 Loading page...`);
    await page.goto(pageUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log(`⏳ Waiting ${waitTime} seconds for dynamic content...`);
    await sleep(waitTime * 1000);
    
    if (enableScroll) {
      await autoScroll(page);
    }
    
    console.log(`🔍 Extracting images with their associated links...`);
    const images = await getAllImagesWithLinks(page);
    console.log(`📸 Found ${images.length} unique images with potential links\n`);
    
    if (images.length === 0) {
      console.log('⚠️ No images found on the page');
      const emptyHtml = generateHtml([], pageUrl);
      fs.writeFileSync('output/gallery.html', emptyHtml);
      fs.writeFileSync('output/metadata.json', JSON.stringify({
        sourceUrl: pageUrl,
        totalFound: 0,
        downloaded: 0,
        timestamp: new Date().toISOString()
      }, null, 2));
      return;
    }
    
    const maxImages = 20;
    const imagesToDownload = images.slice(0, maxImages);
    const downloadedImages = [];
    
    console.log(`💾 Processing up to ${maxImages} images...\n`);
    
    for (let i = 0; i < imagesToDownload.length; i++) {
      const img = imagesToDownload[i];
      console.log(`  [${i + 1}/${imagesToDownload.length}] Processing: ${img.src.substring(0, 80)}...`);
      console.log(`      🔗 Associated link: ${img.link ? img.link.substring(0, 70) : 'No link found'}`);
      
      const base64 = await downloadImageAsBase64(page, img.src, pageUrl);
      
      if (base64) {
        downloadedImages.push({
          originalUrl: img.src,
          base64: base64,
          alt: img.alt || '',
          type: img.type,
          link: img.link || null,
          index: i + 1
        });
        console.log(`    ✅ Extracted successfully`);
      } else {
        console.log(`    ❌ Failed to extract`);
      }
      
      await sleep(300);
    }
    
    console.log(`\n✅ Successfully extracted ${downloadedImages.length} images\n`);
    
    console.log(`📄 Generating HTML gallery with links...`);
    const html = generateHtml(downloadedImages, pageUrl);
    fs.writeFileSync('output/gallery.html', html);
    
    const metadata = {
      sourceUrl: pageUrl,
      totalFound: images.length,
      extracted: downloadedImages.length,
      failed: imagesToDownload.length - downloadedImages.length,
      timestamp: new Date().toISOString(),
      userAgent: randomUA,
      waitTime: waitTime,
      autoScroll: enableScroll,
      images: downloadedImages.map(img => ({
        url: img.originalUrl,
        type: img.type,
        alt: img.alt,
        associatedLink: img.link
      }))
    };
    
    fs.writeFileSync('output/metadata.json', JSON.stringify(metadata, null, 2));
    
    console.log('✨ Done! Gallery saved to output/gallery.html');
    console.log(`📊 Metadata saved to output/metadata.json`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function generateHtml(images, sourceUrl) {
  const hostname = (() => {
    try {
      return new URL(sourceUrl).hostname;
    } catch {
      return 'unknown';
    }
  })();
  
  let imagesHtml = '';
  
  if (images.length === 0) {
    imagesHtml = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h2>No Images Found</h2>
        <p>The page could not be loaded or contains no extractable images.</p>
        <p><small>URL: ${escapeHtml(sourceUrl)}</small></p>
      </div>
    `;
  } else {
    images.forEach((img, idx) => {
      const hasLink = img.link && img.link !== '';
      imagesHtml += `
        <div class="gallery-item" data-index="${idx}">
          <div class="image-container">
            <img src="${img.base64}" alt="${escapeHtml(img.alt) || `Image ${idx + 1}`}" loading="lazy">
            <div class="image-overlay">
              <button class="view-btn" onclick="viewOriginal('${escapeHtml(img.originalUrl)}')">🔗 View Original Image</button>
              ${hasLink ? `<button class="link-btn" onclick="viewOriginal('${escapeHtml(img.link)}')">🌐 Open Associated Link</button>` : ''}
              <button class="copy-btn" onclick="copyToClipboard('${escapeHtml(img.originalUrl)}')">📋 Copy Image URL</button>
            </div>
          </div>
          <div class="image-info">
            <div class="image-url">
              <strong>🖼️ Image URL:</strong>
              <a href="${escapeHtml(img.originalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(img.originalUrl.substring(0, 80))}${img.originalUrl.length > 80 ? '...' : ''}</a>
            </div>
            ${hasLink ? `
            <div class="image-link">
              <strong>🔗 Associated Link:</strong>
              <a href="${escapeHtml(img.link)}" target="_blank" rel="noopener noreferrer" class="link-value">
                ${escapeHtml(img.link.length > 80 ? img.link.substring(0, 80) + '...' : img.link)}
              </a>
              <button class="copy-link-btn" onclick="copyToClipboard('${escapeHtml(img.link)}')">📋</button>
            </div>
            ` : `
            <div class="image-link no-link">
              <strong>🔗 Associated Link:</strong>
              <span class="no-link-text">No associated link found for this image</span>
            </div>
            `}
            ${img.alt ? `<div class="image-alt"><strong>📝 Alt Text:</strong> ${escapeHtml(img.alt)}</div>` : ''}
            <div class="image-type"><strong>📎 Source Type:</strong> ${img.type}</div>
          </div>
        </div>
      `;
    });
  }
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Gallery with Links - ${escapeHtml(hostname)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            background: rgba(255,255,255,0.95);
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        
        h1 {
            font-size: 2.5rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 15px;
        }
        
        .badge {
            display: inline-block;
            background: #48bb78;
            color: white;
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            margin-left: 10px;
            vertical-align: middle;
        }
        
        .meta-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
        }
        
        .meta-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 10px;
        }
        
        .source-link {
            color: #667eea;
            text-decoration: none;
            word-break: break-all;
        }
        
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
            gap: 25px;
        }
        
        .gallery-item {
            background: white;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .gallery-item:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }
        
        .image-container {
            position: relative;
            overflow: hidden;
            background: #f5f5f5;
            cursor: pointer;
        }
        
        .image-container img {
            width: 100%;
            height: 250px;
            object-fit: cover;
            display: block;
            transition: transform 0.3s ease;
        }
        
        .gallery-item:hover .image-container img {
            transform: scale(1.05);
        }
        
        .image-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 12px;
            opacity: 0;
            transition: opacity 0.3s ease;
            flex-wrap: wrap;
            padding: 10px;
        }
        
        .image-container:hover .image-overlay {
            opacity: 1;
        }
        
        .view-btn, .link-btn, .copy-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        
        .view-btn {
            background: #667eea;
            color: white;
        }
        
        .link-btn {
            background: #ed8936;
            color: white;
        }
        
        .copy-btn {
            background: #48bb78;
            color: white;
        }
        
        .view-btn:hover, .link-btn:hover, .copy-btn:hover {
            transform: scale(1.05);
            filter: brightness(1.1);
        }
        
        .image-info {
            padding: 16px;
            background: white;
        }
        
        .image-url, .image-link {
            margin-bottom: 12px;
            font-size: 0.85rem;
            word-break: break-all;
            padding: 8px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .image-link {
            background: #fff5e6;
            border-left: 3px solid #ed8936;
        }
        
        .image-link.no-link {
            background: #f0f0f0;
            border-left-color: #999;
        }
        
        .image-link .link-value {
            color: #ed8936;
            text-decoration: none;
            display: inline-block;
            margin-right: 8px;
        }
        
        .image-link .link-value:hover {
            text-decoration: underline;
        }
        
        .copy-link-btn {
            background: #ed8936;
            color: white;
            border: none;
            padding: 4px 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 8px;
        }
        
        .copy-link-btn:hover {
            background: #dd6b20;
        }
        
        .no-link-text {
            color: #999;
            font-style: italic;
        }
        
        .image-url a, .image-link a {
            color: #667eea;
            text-decoration: none;
        }
        
        .image-url a:hover, .image-link a:hover {
            text-decoration: underline;
        }
        
        .image-alt, .image-type {
            font-size: 0.85rem;
            color: #666;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #f0f0f0;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            background: white;
            border-radius: 20px;
        }
        
        .footer {
            margin-top: 40px;
            text-align: center;
            color: rgba(255,255,255,0.9);
            font-size: 0.85rem;
            padding: 20px;
        }
        
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        }
        
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @media (max-width: 768px) {
            .gallery {
                grid-template-columns: 1fr;
            }
            h1 {
                font-size: 1.8rem;
            }
            .meta-grid {
                grid-template-columns: 1fr;
            }
            .image-overlay {
                gap: 8px;
            }
            .view-btn, .link-btn, .copy-btn {
                padding: 6px 12px;
                font-size: 11px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🖼️ Image Gallery with Links <span class="badge">${images.filter(i => i.link).length} linked images</span></h1>
            <div class="meta-grid">
                <div class="meta-item">🌐 <strong>Source:</strong> <a href="${escapeHtml(sourceUrl)}" class="source-link" target="_blank">${escapeHtml(sourceUrl)}</a></div>
                <div class="meta-item">📸 <strong>Images Found:</strong> ${images.length}</div>
                <div class="meta-item">🔗 <strong>With Links:</strong> ${images.filter(i => i.link).length}</div>
                <div class="meta-item">📅 <strong>Generated:</strong> ${new Date().toLocaleString()}</div>
            </div>
        </div>
        
        <div class="gallery">
            ${imagesHtml}
        </div>
        
        <div class="footer">
            <p>🤖 Extracted using Playwright (Headless Browser) • All images embedded as Base64</p>
            <p>💡 Hover over images for quick actions • Click on any link to open in new tab</p>
            <p>🔗 Associated links are automatically detected from parent &lt;a&gt; tags, containers, or data attributes</p>
        </div>
    </div>
    
    <script>
        function viewOriginal(url) {
            window.open(url, '_blank');
        }
        
        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('✓ Copied to clipboard!');
            }).catch(() => {
                showToast('Failed to copy');
            });
        }
        
        function showToast(message) {
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.remove();
            }, 2000);
        }
    </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

main();
