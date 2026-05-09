import sys
import os
import base64
import re
from urllib.parse import urljoin, urlparse
from PIL import Image
import io
from playwright.sync_api import sync_playwright

def download_image_as_webp_bytes(page, img_url):
    """Download image and return as bytes of WebP (quality 80)."""
    try:
        response = page.goto(img_url, timeout=10000)
        if response and response.ok:
            img_data = response.body()
            pil_img = Image.open(io.BytesIO(img_data))
            # Convert to RGB if needed (WebP supports RGB/RGBA)
            if pil_img.mode not in ('RGB', 'RGBA'):
                pil_img = pil_img.convert('RGB')
            output = io.BytesIO()
            pil_img.save(output, format='webp', quality=80)
            return output.getvalue()
        else:
            print(f"⚠️ Failed to fetch {img_url}")
            return None
    except Exception as e:
        print(f"⚠️ Error downloading {img_url}: {e}")
        return None

def is_likely_video_page(link):
    """Heuristic: link contains video patterns."""
    if not link:
        return False
    patterns = [
        r'/watch\?v=', r'/video/', r'/v/', r'/embed/',
        r'/episode/', r'/clip/', r'/play/',
        r'/media/', r'/show/', r'/program/'
    ]
    link_lower = link.lower()
    return any(re.search(p, link_lower) for p in patterns)

def extract_thumbnails(page, site_url, max_items):
    """
    Find <a> elements that likely point to a video page and contain an image.
    Returns list of dicts: {'img_url': str, 'page_link': str}
    """
    # Scroll to trigger lazy loading
    print("📜 Scrolling page to load lazy thumbnails...")
    for _ in range(4):
        page.evaluate("window.scrollBy(0, window.innerHeight)")
        page.wait_for_timeout(800)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(1000)

    # Extract using JavaScript
    thumbnails = page.evaluate("""
        (siteOrigin) => {
            const results = [];
            const links = document.querySelectorAll('a[href]');
            for (let link of links) {
                let href = link.getAttribute('href');
                if (!href) continue;
                // Make absolute URL
                let absoluteHref = new URL(href, window.location.href).href;
                // Only internal links (same origin) that look like video pages
                if (!absoluteHref.startsWith(siteOrigin)) continue;
                // Check for video patterns inside href
                let isVideo = /\\/watch\\?v=|\\/video\\/|\\/v\\/|\\/embed\\/|\\/episode\\/|\\/clip\\/|\\/play\\/|\\/media\\//i.test(absoluteHref);
                if (!isVideo) continue;
                
                // Find image inside this link
                let img = link.querySelector('img');
                if (!img) continue;
                let imgSrc = img.getAttribute('src') || img.getAttribute('data-src');
                if (!imgSrc) continue;
                if (imgSrc.startsWith('data:')) continue;
                // Make absolute image URL
                let absoluteImg = new URL(imgSrc, window.location.href).href;
                results.push({
                    img_url: absoluteImg,
                    page_link: absoluteHref
                });
                if (results.length >= %s) break;
            }
            return results;
        }
    """ % (max_items,), site_url)

    return thumbnails

def generate_html(thumbnails_data, site_url):
    """Generate HTML with base64 embedded thumbnails and copy buttons."""
    rows = []
    for idx, item in enumerate(thumbnails_data):
        img_b64 = base64.b64encode(item['webp_bytes']).decode('utf-8')
        rows.append(f"""
        <div class="thumbnail-card">
            <img src="data:image/webp;base64,{img_b64}" alt="Thumbnail {idx+1}" loading="lazy">
            <div class="info">
                <div class="link">
                    <span>🎬 Page: </span>
                    <a href="{item['page_link']}" target="_blank">{item['page_link'][:80]}{'...' if len(item['page_link'])>80 else ''}</a>
                    <button class="copy-btn" data-link="{item['page_link']}">📋 Copy</button>
                </div>
            </div>
        </div>
        """)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Video Thumbnails from {site_url}</title>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #eee; margin: 0; padding: 20px; }}
        h1 {{ text-align: center; color: #ff5555; }}
        .sub {{ text-align: center; margin-bottom: 30px; opacity: 0.8; }}
        .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 25px; max-width: 1400px; margin: auto; }}
        .thumbnail-card {{ background: #1e1e1e; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: transform 0.2s; }}
        .thumbnail-card:hover {{ transform: scale(1.02); }}
        .thumbnail-card img {{ width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }}
        .info {{ padding: 12px; }}
        .link {{ word-break: break-all; font-size: 0.85rem; margin-bottom: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }}
        .link a {{ color: #88aaff; text-decoration: none; flex: 1; }}
        .link a:hover {{ text-decoration: underline; }}
        .copy-btn {{ background: #333; border: none; color: white; padding: 6px 12px; border-radius: 20px; cursor: pointer; font-size: 0.75rem; transition: 0.2s; }}
        .copy-btn:hover {{ background: #555; }}
        .copy-btn:active {{ background: #0088ff; }}
        footer {{ text-align: center; margin-top: 40px; font-size: 0.8rem; opacity: 0.6; }}
    </style>
</head>
<body>
    <h1>🎬 Video Thumbnails</h1>
    <div class="sub">Source: <a href="{site_url}" target="_blank">{site_url}</a> | Total: {len(thumbnails_data)}</div>
    <div class="gallery">
        {''.join(rows)}
    </div>
    <footer>Click on "Copy" to copy the video page URL. Thumbnails are embedded as base64 WebP.</footer>
    <script>
        document.querySelectorAll('.copy-btn').forEach(btn => {{
            btn.addEventListener('click', () => {{
                const link = btn.getAttribute('data-link');
                navigator.clipboard.writeText(link).then(() => {{
                    const originalText = btn.innerText;
                    btn.innerText = '✅ Copied!';
                    setTimeout(() => btn.innerText = originalText, 1500);
                }});
            }});
        }});
    </script>
</body>
</html>
    """
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

        print(f"🌐 Loading {site_url} ...")
        page.goto(site_url, wait_until="networkidle")
        page.wait_for_timeout(2000)

        # Extract thumbnail info (URLs only)
        thumb_items = extract_thumbnails(page, site_url, max_items)
        print(f"🔍 Found {len(thumb_items)} potential video thumbnails.")

        if not thumb_items:
            print("❌ No video thumbnails found. The site might use a different structure.")
            browser.close()
            sys.exit(1)

        # Download each image and convert to WebP bytes
        final_data = []
        for idx, item in enumerate(thumb_items):
            print(f"  [{idx+1}/{len(thumb_items)}] Downloading {item['img_url'][:70]}...")
            webp_data = download_image_as_webp_bytes(page, item['img_url'])
            if webp_data:
                final_data.append({
                    'page_link': item['page_link'],
                    'webp_bytes': webp_data
                })
            page.wait_for_timeout(300)  # polite delay

        if not final_data:
            print("❌ Failed to download any images.")
            browser.close()
            sys.exit(1)

        # Generate HTML with embedded images
        html_content = generate_html(final_data, site_url)
        with open("index.html", "w", encoding="utf-8") as f:
            f.write(html_content)

        print(f"✅ Success! {len(final_data)} thumbnails embedded in index.html")
        browser.close()

if __name__ == "__main__":
    main()
