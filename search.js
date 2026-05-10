const { imageSearch, closeBrowser } = require('imgsearch-api');
const axios = require('axios');
const fs = require('fs');

const query = process.env.SEARCH_QUERY;
let limit = parseInt(process.env.SEARCH_LIMIT, 10);
const enginesRaw = process.env.SEARCH_ENGINES || 'bing,ddg';
const engines = enginesRaw.split(',').map(e => e.trim().toLowerCase());

if (!query) {
  console.error('❌ عبارت جستجو وارد نشده است');
  process.exit(1);
}
if (isNaN(limit) || limit < 1) limit = 30;
limit = Math.min(limit, 100); //  تصاویر رو محدود به ۱۰۰ می‌کنیم تا از محدودیت منابع عبور نکنیم.

console.log(`🔍 جستجوی عبارت: "${query}"`);
console.log(`⚙️ موتورهای انتخاب شده: ${engines.join(', ')}`);
console.log(`📸 حداکثر تصاویر: ${limit}`);

//  دریافت URL تصاویر با استفاده از چند مرحله فراخوانی
async function fetchImageUrls() {
  let allUrls = [];
  const batchLimit = 30;
  const batchesNeeded = Math.ceil(limit / batchLimit);

  for (let i = 0; i < batchesNeeded; i++) {
    const remaining = limit - allUrls.length;
    const batch = Math.min(batchLimit, remaining);

    console.log(`...دریافت دسته ${i + 1} از ${batchesNeeded} (${batch} تصویر)`);
    try {
      const urls = await imageSearch(query, {
        engines: engines,
        n: batch
      });
      allUrls.push(...urls);
      if (urls.length < batch) break; // اگر موتور جستجو نتایج کمتری برگرداند، حلقه رو متوقف می‌کنیم.
    } catch (err) {
      console.error(`خطا در مرحله ${i + 1}:`, err.message);
      break;
    }
  }

  return allUrls.slice(0, limit);
}

function getImageFormatFromUrl(url, contentType) {
  const ext = url.split('.').pop().split('?')[0].toLowerCase();

  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';

  if (contentType && contentType.startsWith('image/')) return contentType;

  return 'image/jpeg';
}

async function downloadAndEncodeImage(imgUrl, index) {
  try {
    const response = await axios.get(imgUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const mimeType = getImageFormatFromUrl(imgUrl, response.headers['content-type']);
    const base64Image = `data:${mimeType};base64,${Buffer.from(response.data, 'binary').toString('base64')}`;

    console.log(`✅ تصویر ${index + 1} دانلود و کدگذاری شد.`);
    return { index, imgUrl, base64Image };
  } catch (error) {
    if (error.response && error.response.status === 403) {
      console.warn(`⚠️ تصویر ${index + 1} برگردونده شد. لینک: ${imgUrl} (403 Forbidden)`);
    } else if (error.code === 'ECONNABORTED') {
      console.warn(`⏱️ زمان دریافت تصویر ${index + 1} به پایان رسید. (لینک: ${imgUrl})`);
    } else if (error.response && error.response.status === 429) {
      console.warn(`🚦 تصویر ${index + 1} دریافت نشد. (429 Too Many Requests: ${imgUrl})`);
    } else {
      console.warn(`⚠️ تصویر ${index + 1} دریافت نشد. (لینک: ${imgUrl}) - خطا: ${error.message}`);
    }
    return null;
  }
}

(async () => {
  console.log("🚀 شروع فرآیند جستجو و دانلود تصاویر...");

  const imageUrls = await fetchImageUrls();

  if (!imageUrls.length) {
    console.warn('⚠️ هیچ تصویری یافت نشد.');
    fs.writeFileSync('index.html', `<html><body><h1>تصویری برای "${query}" یافت نشد.</h1></body></html>`);
    await closeBrowser();
    process.exit(0);
  }

  console.log(`✅ ${imageUrls.length} لینک دریافت شد. در حال دانلود تصاویر...`);

  const downloadedImages = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const imgUrl = imageUrls[i];
    const result = await downloadAndEncodeImage(imgUrl, i);
    if (result) {
      downloadedImages.push(result);
    }
  }

  console.log(`📊 از ${imageUrls.length} لینک، ${downloadedImages.length} تصویر با موفقیت دریافت و کدگذاری شد.`);

  let cards = '';
  for (const img of downloadedImages) {
    cards += `
      <div class="card">
        <div class="img-wrapper">
          <img src="${escapeHtml(img.base64Image)}" alt="Image ${img.index + 1}" loading="lazy" style="width:100%; height:100%; object-fit: cover;">
        </div>
        <div class="info">
          <div class="link">
            <a href="${escapeHtml(img.imgUrl)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(img.imgUrl.length > 70 ? img.imgUrl.substring(0,70)+'…' : img.imgUrl)}
            </a>
            <button class="copy-btn" data-link="${escapeHtml(img.imgUrl)}">📋 کپی لینک</button>
          </div>
        </div>
      </div>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>گالری تصاویر: ${escapeHtml(query)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f4f6f9; font-family: 'Segoe UI', Tahoma, sans-serif; padding: 2rem 1rem; }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 0.5rem; color: #1e2a3a; }
    .sub { text-align: center; margin-bottom: 2rem; color: #2c3e50; font-size: 0.9rem; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.8rem; }
    .card { background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 8px 18px rgba(0,0,0,0.08); transition: all 0.25s ease; }
    .card:hover { transform: translateY(-5px); box-shadow: 0 16px 28px rgba(0,0,0,0.12); }
    .img-wrapper { aspect-ratio: 16/9; background: #eef2f5; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .info { padding: 1rem; }
    .link { display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem; font-size: 0.7rem; background: #f8f9fc; padding: 0.5rem 0.8rem; border-radius: 40px; direction: ltr; text-align: left; }
    .link a { color: #2c6e9e; text-decoration: none; word-break: break-all; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .link a:hover { text-decoration: underline; }
    .copy-btn { background: #e9ecef; border: none; padding: 0.3rem 0.9rem; border-radius: 30px; cursor: pointer; font-size: 0.7rem; font-weight: 500; transition: 0.2s; flex-shrink: 0; color: #1e4668; }
    .copy-btn:hover { background: #cdd4dc; }
    footer { text-align: center; margin-top: 2.5rem; font-size: 0.75rem; color: #5a6e7c; border-top: 1px solid #dce5ef; padding-top: 1.2rem; }
  </style>
</head>
<body>
<div class="container">
  <h1>🖼️ گالری تصاویر</h1>
  <div class="sub">🔍 جستجو: "${escapeHtml(query)}" &nbsp;|&nbsp; 📸 تعداد: ${downloadedImages.length}</div>
  <div class="gallery">${cards}</div>
  <footer>تصاویر به صورت Base64 درون فایل HTML ذخیره شده‌اند. لینک مستقیم تصاویر نیز قابل مشاهده است.</footer>
</div>
<script>
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const link = btn.getAttribute('data-link');
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        const oldText = btn.innerText;
        btn.innerText = '✅ کپی شد';
        setTimeout(() => btn.innerText = oldText, 1500);
      } catch (err) {
        prompt('لینک را دستی کپی کنید:', link);
      }
    });
  });
</script>
</body>
</html>`;

  fs.writeFileSync('index.html', html);
  console.log('✨ فایل index.html با موفقیت ساخته شد و تصاویر درون آن جاسازی شدند.');
  await closeBrowser();
})();

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : m);
}
