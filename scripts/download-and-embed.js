const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const pageUrl = process.env.PAGE_URL;
if (!pageUrl) {
  console.error('PAGE_URL environment variable is not set');
  process.exit(1);
}

// Headers طبیعی برای شبیه‌سازی مرورگر واقعی
const getHeaders = () => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,fa;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0'
});

// دانلود یک تصویر و برگرداندن base64
async function downloadImageAsBase64(url, referer = pageUrl) {
  try {
    const imageHeaders = {
      ...getHeaders(),
      'Referer': referer,
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site'
    };

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: imageHeaders,
      maxRedirects: 5
    });

    const contentType = response.headers['content-type'];
    let mimeType = contentType?.split(';')[0] || 'image/jpeg';
    
    // تنظیم mimeType بر اساس پسوند اگر تشخیص داده نشد
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = path.extname(url).toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.svg') mimeType = 'image/svg+xml';
      else mimeType = 'image/jpeg';
    }

    const base64 = Buffer.from(response.data).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error(`Failed to download ${url}: ${error.message}`);
    return null;
  }
}

// تبدیل آدرس نسبی به مطلق
function getAbsoluteUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return null;
  }
}

// فیلتر کردن تصاویر تکراری و نامعتبر
function isValidImageUrl(url) {
  if (!url) return false;
  const invalidPatterns = ['data:image', 'blob:', 'javascript:', 'mailto:', 'tel:', 'spacer', 'pixel', '1x1', 'placeholder'];
  return !invalidPatterns.some(pattern => url.toLowerCase().includes(pattern.toLowerCase()));
}

async function main() {
  console.log(`📥 Fetching page: ${pageUrl}`);
  
  // مرحله 1: دریافت صفحه HTML
  const response = await axios.get(pageUrl, {
    headers: getHeaders(),
    timeout: 30000,
    maxRedirects: 5
  });
  
  const $ = cheerio.load(response.data);
  const imageUrls = new Set();

  // استخراج تصاویر از تگ‌های img
  $('img').each((_, img) => {
    let src = $(img).attr('src');
    if (src) {
      const absoluteUrl = getAbsoluteUrl(pageUrl, src);
      if (absoluteUrl && isValidImageUrl(absoluteUrl)) {
        imageUrls.add(absoluteUrl);
      }
    }
  });

  // استخراج تصاویر از background-image در style و css
  $('[style]').each((_, el) => {
    const style = $(el).attr('style');
    if (style) {
      const bgMatch = style.match(/background(?:-image)?\s*:\s*url\(['"]?([^'"()]+)['"]?\)/i);
      if (bgMatch && bgMatch[1]) {
        const absoluteUrl = getAbsoluteUrl(pageUrl, bgMatch[1]);
        if (absoluteUrl && isValidImageUrl(absoluteUrl)) {
          imageUrls.add(absoluteUrl);
        }
      }
    }
  });

  // استخراج از picture > source
  $('source[srcset]').each((_, source) => {
    const srcset = $(source).attr('srcset');
    if (srcset) {
      const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
      urls.forEach(url => {
        const absoluteUrl = getAbsoluteUrl(pageUrl, url);
        if (absoluteUrl && isValidImageUrl(absoluteUrl)) {
          imageUrls.add(absoluteUrl);
        }
      });
    }
  });

  const uniqueImages = Array.from(imageUrls);
  console.log(`🔍 Found ${uniqueImages.length} unique images`);

  if (uniqueImages.length === 0) {
    console.log('⚠️ No images found on the page');
    // ایجاد یک صفحه HTML خالی با پیام
    const emptyHtml = generateGalleryHtml([], pageUrl);
    fs.writeFileSync('output/gallery.html', emptyHtml);
    fs.writeFileSync('output/metadata.json', JSON.stringify({
      sourceUrl: pageUrl,
      totalFound: 0,
      downloaded: 0,
      timestamp: new Date().toISOString(),
      error: 'No images found'
    }, null, 2));
    return;
  }

  // مرحله 2: دانلود تصاویر و تبدیل به base64 (حداکثر 30 تصویر برای جلوگیری از timeout)
  const downloadLimit = 30;
  const imagesToDownload = uniqueImages.slice(0, downloadLimit);
  const downloadedImages = [];

  console.log(`📸 Downloading up to ${downloadLimit} images and converting to base64...`);

  for (let i = 0; i < imagesToDownload.length; i++) {
    const imgUrl = imagesToDownload[i];
    const filename = `img_${i + 1}${path.extname(imgUrl).split('?')[0] || '.jpg'}`;
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    console.log(`  [${i + 1}/${imagesToDownload.length}] Downloading: ${imgUrl.substring(0, 80)}...`);
    
    const base64Data = await downloadImageAsBase64(imgUrl);
    
    if (base64Data) {
      downloadedImages.push({
        originalUrl: imgUrl,
        filename: sanitizedFilename,
        base64: base64Data,
        index: i + 1
      });
      
      // همچنین فایل اصلی را برای استفاده در آینده ذخیره می‌کنیم (اختیاری)
      try {
        const base64Buffer = Buffer.from(base64Data.split(',')[1], 'base64');
        fs.writeFileSync(path.join('downloaded_images', sanitizedFilename), base64Buffer);
      } catch (err) {
        console.error(`    Failed to save file: ${err.message}`);
      }
    } else {
      console.log(`    ❌ Failed to download`);
    }
    
    // کمی تاخیر برای جلوگیری از مسدود شدن
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`✅ Successfully downloaded ${downloadedImages.length} images`);

  // مرحله 3: تولید HTML با تصاویر base64
  const htmlContent = generateGalleryHtml(downloadedImages, pageUrl);
  fs.writeFileSync('output/gallery.html', htmlContent);
  console.log('📄 Gallery saved to output/gallery.html');

  // ذخیره متادیتا
  fs.writeFileSync('output/metadata.json', JSON.stringify({
    sourceUrl: pageUrl,
    totalFound: uniqueImages.length,
    downloaded: downloadedImages.length,
    failed: imagesToDownload.length - downloadedImages.length,
    timestamp: new Date().toISOString(),
    images: downloadedImages.map(img => ({
      filename: img.filename,
      originalUrl: img.originalUrl
    }))
  }, null, 2));
  
  console.log('📊 Metadata saved to output/metadata.json');
}

// تابع تولید HTML با تصاویر base64
function generateGalleryHtml(images, sourceUrl) {
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
      <div style="text-align: center; padding: 50px; background: #fff3cd; border-radius: 12px;">
        <h2>⚠️ No Images Found</h2>
        <p>The page "${sourceUrl}" does not contain any downloadable images, or they could not be accessed.</p>
      </div>
    `;
  } else {
    images.forEach((img, idx) => {
      imagesHtml += `
        <div class="card">
          <img src="${img.base64}" alt="Image ${img.index}" loading="lazy" onclick="openModal(this.src)">
          <div class="info">
            <div class="filename">${img.filename}</div>
            <div class="url"><a href="${img.originalUrl}" target="_blank">View original</a></div>
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
    <title>Image Gallery - ${hostname}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        .header {
            background: white;
            border-radius: 16px;
            padding: 24px 32px;
            margin-bottom: 32px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        h1 {
            font-size: 2rem;
            margin-bottom: 8px;
            color: #333;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        h1:before {
            content: "🖼️";
            font-size: 2rem;
        }
        .meta {
            color: #666;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            gap: 24px;
            flex-wrap: wrap;
        }
        .meta-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .meta-item strong {
            color: #333;
        }
        .source-link {
            color: #667eea;
            text-decoration: none;
            word-break: break-all;
        }
        .source-link:hover {
            text-decoration: underline;
        }
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 24px;
        }
        .card {
            background: white;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            cursor: pointer;
        }
        .card:hover {
            transform: translateY(-8px);
            box-shadow: 0 12px 28px rgba(0,0,0,0.2);
        }
        .card img {
            width: 100%;
            height: 250px;
            object-fit: cover;
            display: block;
            background: #f5f5f5;
        }
        .card .info {
            padding: 16px;
            background: white;
        }
        .card .filename {
            font-size: 0.85rem;
            color: #555;
            font-family: 'Courier New', monospace;
            word-break: break-all;
            margin-bottom: 8px;
        }
        .card .url a {
            color: #667eea;
            text-decoration: none;
            font-size: 0.8rem;
        }
        .card .url a:hover {
            text-decoration: underline;
        }
        .footer {
            margin-top: 48px;
            text-align: center;
            color: rgba(255,255,255,0.9);
            font-size: 0.85rem;
            padding: 24px;
        }
        
        /* Modal for full-size viewing */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.95);
            cursor: pointer;
        }
        .modal-content {
            margin: auto;
            display: block;
            max-width: 90%;
            max-height: 90%;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }
        .close {
            position: absolute;
            top: 20px;
            right: 35px;
            color: #f1f1f1;
            font-size: 40px;
            font-weight: bold;
            cursor: pointer;
            z-index: 1001;
        }
        .close:hover {
            color: #bbb;
        }
        
        @media (max-width: 768px) {
            .gallery {
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 16px;
            }
            .card img {
                height: 180px;
            }
            .header {
                padding: 16px 20px;
            }
            h1 {
                font-size: 1.5rem;
            }
        }
        @media (max-width: 480px) {
            .gallery {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Image Gallery</h1>
            <div class="meta">
                <div class="meta-item">📎 <strong>Source:</strong> <a href="${sourceUrl}" class="source-link" target="_blank">${sourceUrl}</a></div>
                <div class="meta-item">📸 <strong>Total Images:</strong> ${images.length}</div>
                <div class="meta-item">📅 <strong>Generated:</strong> ${new Date().toLocaleString()}</div>
                <div class="meta-item">💾 <strong>Format:</strong> Base64 Embedded (Offline Ready)</div>
            </div>
        </div>
        <div class="gallery">
            ${imagesHtml}
        </div>
        <div class="footer">
            Generated by GitHub Actions • Images are embedded as base64 (full offline HTML)<br>
            Click on any image to view full size
        </div>
    </div>
    
    <!-- Modal -->
    <div id="imageModal" class="modal" onclick="closeModal()">
        <span class="close">&times;</span>
        <img class="modal-content" id="modalImage">
    </div>
    
    <script>
        function openModal(src) {
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImage');
            modal.style.display = "block";
            modalImg.src = src;
        }
        
        function closeModal() {
            document.getElementById('imageModal').style.display = "none";
        }
        
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    </script>
</body>
</html>`;
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
