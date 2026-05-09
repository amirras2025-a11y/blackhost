import sys
import os
import re
import base64
from urllib.parse import urljoin, urlparse
from PIL import Image
import io
from playwright.sync_api import sync_playwright

# ---------------------------
#  تنظیمات قابل شخصی‌سازی
# ---------------------------
MIN_IMAGE_WIDTH = 120          # حداقل عرض تصویر (پیکسل)
MIN_IMAGE_HEIGHT = 90          # حداقل ارتفاع
IDEAL_RATIO_RANGE = (1.2, 2.2) # نسبت ابعاد ایده‌آل برای تام‌نیل (عرض/ارتفاع)
THUMB_KEYWORDS = ['thumb', 'thumbnail', 'poster', 'cover', 'preview', 'frame', 'still', 'screen', 'vid', 'cap', 'shot']
IGNORE_KEYWORDS = ['logo', 'icon', 'avatar', 'button', 'sprite', 'spinner', 'loading', 'ad', 'banner']

def get_image_candidates(page, site_url, max_items):
    """
    استخراج نامزدهای تصویر با استفاده از JS در مرورگر.
    برگرداندن لیستی از دیکشنری‌ها با کلیدهای:
        imgUrl, pageLink, width, height, ratio, score
    """
    # اسکرول کامل برای لود lazy images
    for _ in range(5):
        page.evaluate("window.scrollBy(0, window.innerHeight)")
        page.wait_for_timeout(800)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(1500)

    # آماده سازی پارامترها برای ارسال به JS
    params = {
        "siteOrigin": site_url,
        "minW": MIN_IMAGE_WIDTH,
        "minH": MIN_IMAGE_HEIGHT,
        "ratioMin": IDEAL_RATIO_RANGE[0],
        "ratioMax": IDEAL_RATIO_RANGE[1],
        "thumbKw": THUMB_KEYWORDS,
        "ignoreKw": IGNORE_KEYWORDS,
        "maxItems": max_items,
        "videoUrlPatterns": [
            r'/watch\?v=', r'/video/', r'/v/', r'/embed/', r'/episode/', r'/clip/',
            r'/play/', r'/media/', r'/show/', r'/program/', r'/vod/', r'/stream/',
            r'/movie/', r'/series/', r'/tv/'
        ]
    }

    candidates = page.evaluate("""
        (params) => {
            // helper: check if URL looks like a video page
            function isVideoPageUrl(url) {
                if (!url) return false;
                let lower = url.toLowerCase();
                return params.videoUrlPatterns.some(pattern => {
                    let regex = new RegExp(pattern, 'i');
                    return regex.test(lower);
                });
            }

            const results = [];
            const allImages = document.querySelectorAll('img');
            
            for (let img of allImages) {
                let src = img.src;
                if (!src) {
                    src = img.getAttribute('data-src') || img.getAttribute('data-original');
                }
                if (!src || src.startsWith('data:')) continue;
                
                let absoluteImgUrl = new URL(src, window.location.href).href;
                let urlLower = absoluteImgUrl.toLowerCase();
                
                // رد لوگو/آیکون
                let isIgnored = params.ignoreKw.some(kw => urlLower.includes(kw));
                if (isIgnored) continue;
                
                let width = img.naturalWidth;
                let height = img.naturalHeight;
                if (width === 0 || height === 0) continue; // هنوز لود نشده
                if (width < params.minW || height < params.minH) continue;
                
                let ratio = width / height;
                if (ratio < params.ratioMin || ratio > params.ratioMax) continue;
                
                // پیدا کردن لینک والد یا مجاور
                let linkElem = img.closest('a');
                let href = linkElem ? linkElem.href : null;
                if (!href && img.parentElement && img.parentElement.tagName === 'A') {
                    href = img.parentElement.href;
                }
                if (href) {
                    href = new URL(href, window.location.href).href;
                }
                
                // امتیازدهی
                let score = 0;
                if (href && isVideoPageUrl(href)) score += 50;
                let hasThumbKw = params.thumbKw.some(kw => urlLower.includes(kw));
                if (hasThumbKw) score += 30;
                if (Math.abs(ratio - 16/9) < 0.2) score += 20;
                else if (Math.abs(ratio - 4/3) < 0.2) score += 15;
                score += Math.min(20, (width - params.minW) / 30);
                
                results.push({
                    imgUrl: absoluteImgUrl,
                    pageLink: href,
                    width: width,
                    height: height,
                    ratio: ratio,
                    score: score
                });
                if (results.length >= params.maxItems * 2) break;
            }
            // مرتب‌سازی بر اساس نمره نزولی
            results.sort((a,b) => b.score - a.score);
            return results.slice(0, params.maxItems);
        }
    """, params)  # فقط یک آرگومان (params)

    return candidates

def download_image_as_webp_bytes(page, img_url):
    """دانلود تصویر و تبدیل به WebP bytes"""
    try:
        response = page.goto(img_url, timeout=8000)
        if response and response.ok:
            img_data = response.body()
            pil_img = Image.open(io.BytesIO(img_data))
            if pil_img.mode not in ('RGB', 'RGBA'):
                pil_img = pil_img.convert('RGB')
            output = io.BytesIO()
            pil_img.save(output, format='webp', quality=80)
            return output.getvalue()
        else:
            print(f"⚠️ Failed: {img_url} (status {response.status if response else 'no response'})")
            return None
    except Exception as e:
        print(f"⚠️ Error: {img_url} - {e}")
        return None

def generate_html(thumbnails_data, site_url):
    rows = []
    for idx, item in enumerate(thumbnails_data):
        img_b64 = base64.b64encode(item['webp_bytes']).decode('utf-8')
        link = item['page_link'] if item['page_link'] else '#'
        rows.append(f"""
        <div class="card">
            <img src="data:image/webp;base64,{img_b64}" alt="Thumb {idx+1}">
            <div class="info">
                <div class="link">
                    <span>🎬 Page:</span>
                    <a href="{link}" target="_blank">{link[:80]}{'...' if len(link)>80 else ''}</a>
                    <button class="copy-btn" data-link="{link}">📋 Copy</button>
                </div>
            </div>
        </div>
        """)
    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Video Thumbnails</title><style>
body {{ font-family: Arial, sans-serif; background: #121212; color: #ddd; margin: 20px; }}
h1 {{ color: #f66; text-align: center; }}
.gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap: 20px; }}
.card {{ background: #1e1e1e; border-radius: 10px; overflow: hidden; }}
.card img {{ width: 100%; aspect-ratio: 16/9; object-fit: cover; }}
.info {{ padding: 10px; }}
.link {{ display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.8rem; }}
.link a {{ color: #8af; word-break: break-all; flex:1; }}
.copy-btn {{ background: #333; border: none; color: white; padding: 5px 12px; border-radius: 20px; cursor: pointer; }}
.copy-btn:hover {{ background: #555; }}
footer {{ text-align: center; margin-top: 30px; opacity: 0.6; }}
</style></head>
<body>
<h1>🎬 Video Thumbnails from <a href="{site_url}" target="_blank">{site_url}</a></h1>
<div class="gallery">{''.join(rows)}</div>
<footer>Total: {len(thumbnails_data)} | Click Copy for video page URL</footer>
<script>
document.querySelectorAll('.copy-btn').forEach(btn => {{
    btn.onclick = () => {{
        navigator.clipboard.writeText(btn.getAttribute('data-link'));
        let old = btn.innerText;
        btn.innerText = '✅ Copied!';
        setTimeout(() => btn.innerText = old, 1500);
    }};
}});
</script>
</body>
</html>"""
    return html

def main():
    if len(sys.argv) < 2:
        print("Usage: python scrape_thumbnails.py <URL> [max_items]")
        sys.exit(1)

    site_url = sys.argv[1]
    max_items = int(sys.argv[2]) if len(sys.argv) > 2 else 30

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--no-sandbox'])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (Chrome/120)"
        )
        page = context.new_page()
        page.goto(site_url, wait_until="networkidle")
        page.wait_for_timeout(2000)

        candidates = get_image_candidates(page, site_url, max_items)
        print(f"🔍 Found {len(candidates)} candidate images after scoring.")

        if not candidates:
            print("❌ No suitable image found. Try adjusting MIN_IMAGE_SIZE or ratio range in script.")
            browser.close()
            sys.exit(1)

        final = []
        for idx, cand in enumerate(candidates):
            print(f"[{idx+1}/{len(candidates)}] Downloading: {cand['imgUrl'][:70]} (score={cand['score']:.0f})")
            webp_data = download_image_as_webp_bytes(page, cand['imgUrl'])
            if webp_data:
                final.append({
                    'page_link': cand['pageLink'],
                    'webp_bytes': webp_data
                })
            if len(final) >= max_items:
                break
            page.wait_for_timeout(300)

        if final:
            with open("index.html", "w", encoding="utf-8") as f:
                f.write(generate_html(final, site_url))
            print(f"✅ Success! {len(final)} thumbnails embedded in index.html")
        else:
            print("❌ Failed to download any images.")
        browser.close()

if __name__ == "__main__":
    main()
