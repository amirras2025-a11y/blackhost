const { imageSearch, closeBrowser } = require('imgsearch-api');
const fs = require('fs');

// دریافت ورودی‌ها از محیط گیت‌هاب
const query = process.env.SEARCH_QUERY;
let limit = parseInt(process.env.SEARCH_LIMIT, 10);
const enginesRaw = process.env.SEARCH_ENGINES || 'bing,ddg';
const engines = enginesRaw.split(',').map(e => e.trim().toLowerCase());

// اعتبارسنجی
if (!query) {
  console.error('❌ عبارت جستجو وارد نشده است');
  process.exit(1);
}
if (isNaN(limit) || limit < 1) limit = 30;
limit = Math.min(limit, 100);  // سقف ۱۰۰ تصویر

// فهرست موتورهای پشتیبانی شده (بر اساس مستندات imgsearch-api)
const validEngines = ['google', 'bing', 'ddg', 'yandex'];
const selectedEngines = engines.filter(e => validEngines.includes(e));
if (selectedEngines.length === 0) {
  console.error(`❌ موتور جستجوی نامعتبر. گزینه‌های مجاز: ${validEngines.join(', ')}`);
  process.exit(1);
}

console.log(`🔍 جستجوی عبارت: "${query}"`);
console.log(`⚙️ موتورهای انتخاب شده: ${selectedEngines.join(', ')}`);
console.log(`📸 حداکثر تصاویر: ${limit}`);

(async () => {
  let imageUrls = [];
  try {
    // فراخوانی تابع جستجو
    imageUrls = await imageSearch(query, {
      engines: selectedEngines,
      n: limit
    });
  } catch (err) {
    console.error('❌ خطا در حین جستجو:', err.message);
    await closeBrowser();
    process.exit(1);
  }

  if (!imageUrls || imageUrls.length === 0) {
    console.warn('⚠️ هیچ تصویری یافت نشد.');
    fs.writeFileSync('index.html', `<html><body><h1>تصویری برای "${query}" یافت نشد.</h1></body></html>`);
    await closeBrowser();
    process.exit(0);
  }

  console.log(`✅ ${imageUrls.length} تصویر پیدا شد. در حال ساخت صفحه گالری...`);

  // ساخت کارت‌های HTML
  let cards = '';
  imageUrls.forEach((url, idx) => {
    cards += `
      <div class="card">
        <div class="img-wrapper">
          <img src="${escapeHtml(url)}" alt="Image ${idx+1}" loading="lazy"
               onerror="this.parentElement.innerHTML='<div class=\\'broken\\'>⚠️ بارگذاری نشد</div>'">
        </div>
        <div class="info">
          <div class="link">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(url.length > 70 ? url.substring(0,70)+'…' : url)}
            </a>
            <button class="copy-btn" data-link="${escapeHtml(url)}">📋 کپی لینک</button>
          </div>
        </div>
      </div>
    `;
  });

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
    .card { background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 8px 18px rgba(0,0,0,0.1); transition: all 0.25s ease; }
    .card:hover { transform: translateY(-5px); box-shadow: 0 16px 28px rgba(0,0,0,0.15); }
    .img-wrapper { aspect-ratio: 16/9; background: #eef2f5; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .img-wrapper img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
    .card:hover .img-wrapper img { transform: scale(1.02); }
    .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #e67e22; background: #fff3e0; font-size: 0.85rem; }
    .info { padding: 1rem; }
    .link { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.75rem; background: #f8f9fc; padding: 0.5rem 0.8rem; border-radius: 40px; margin-top: 0.25rem; direction: ltr; text-align: left; }
    .link a { color: #2c6e9e; text-decoration: none; word-break: break-all; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .link a:hover { text-decoration: underline; }
    .copy-btn { background: #e9ecef; border: none; padding: 0.3rem 0.9rem; border-radius: 30px; font-size: 0.7rem; cursor: pointer; transition: 0.2s; flex-shrink: 0; color: #1e4668; font-weight: 500; }
    .copy-btn:hover { background: #cdd4dc; }
    footer { text-align: center; margin-top: 2.5rem; font-size: 0.75rem; color: #5a6e7c; border-top: 1px solid #dce5ef; padding-top: 1.2rem; direction: ltr; }
  </style>
</head>
<body>
<div class="container">
  <h1>🖼️ گالری تصاویر</h1>
  <div class="sub">🔍 جستجو: "${escapeHtml(query)}" &nbsp;|&nbsp; 📸 تعداد: ${imageUrls.length}</div>
  <div class="gallery">${cards}</div>
  <footer>حق نشر تصاویر متعلق به صاحبان آنهاست - لینک مستقیم تصاویر</footer>
</div>
<script>
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const link = btn.getAttribute('data-link');
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        const original = btn.innerText;
        btn.innerText = '✅ کپی شد';
        setTimeout(() => btn.innerText = original, 1500);
      } catch (err) {
        prompt('لینک را دستی کپی کنید:', link);
      }
    });
  });
</script>
</body>
</html>`;

  fs.writeFileSync('index.html', html);
  console.log('✨ فایل index.html با موفقیت ساخته شد.');
  await closeBrowser();
})();

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : m);
}
