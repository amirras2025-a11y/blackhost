import sys
import os
import re
from urllib.parse import urljoin, urlparse
from PIL import Image
import io
from playwright.sync_api import sync_playwright

def download_image_as_webp(page, img_url, save_path):
    """Download image using the same browser context and convert to WebP."""
    try:
        response = page.goto(img_url, timeout=10000)
        if response and response.ok:
            img_data = response.body()
            pil_img = Image.open(io.BytesIO(img_data))
            # Convert to RGB if necessary (WebP supports RGB/RGBA)
            if pil_img.mode == 'RGBA':
                # keep alpha, WebP supports it
                pass
            elif pil_img.mode != 'RGB':
                pil_img = pil_img.convert('RGB')
            pil_img.save(save_path, 'webp', quality=80)
            return True
        else:
            print(f"⚠️ Failed: {img_url} (status: {response.status if response else 'no response'})")
            return False
    except Exception as e:
        print(f"⚠️ Error downloading {img_url}: {e}")
        return False

def safe_filename(url):
    """Generate a safe filename from URL."""
    name = re.sub(r'[^a-zA-Z0-9]', '_', url.split('/')[-1].split('?')[0])[:50]
    if not name:
        name = "image"
    return name

def scrape_images(site_url, max_images=50):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--no-sandbox'])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (Chrome/120)"
        )
        page = context.new_page()

        print(f"🌐 Loading {site_url} ...")
        page.goto(site_url, wait_until="networkidle")

        # Scroll to trigger lazy images
        print("📜 Scrolling to reveal lazy images...")
        for _ in range(3):
            page.evaluate("window.scrollBy(0, window.innerHeight)")
            page.wait_for_timeout(800)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1500)

        # Extract images and their parent links
        print("🔍 Extracting image elements...")
        images_data = page.evaluate("""
            () => {
                const items = [];
                const imgs = document.querySelectorAll('img');
                for (let img of imgs) {
                    let src = img.src;
                    if (!src || src.startsWith('data:')) continue;
                    let parentLink = img.closest('a');
                    let href = parentLink ? parentLink.href : null;
                    items.push({
                        src: src,
                        link: href,
                        alt: img.alt || ''
                    });
                    if (items.length >= 50) break;
                }
                return items;
            }
        """)

        if not images_data:
            print("❌ No images found!")
            return

        print(f"✅ Found {len(images_data)} images. Downloading...")

        # Create images directory if not exists
        os.makedirs("images", exist_ok=True)

        downloaded = []
        for idx, img in enumerate(images_data[:max_images]):
            img_url = img['src']
            # Make absolute URL
            full_url = urljoin(site_url, img_url)
            filename = f"img_{idx+1:03d}.webp"
            save_path = os.path.join("images", filename)

            print(f"  [{idx+1}] Downloading {full_url[:80]}...")
            success = download_image_as_webp(page, full_url, save_path)
            if success:
                downloaded.append({
                    "file": filename,
                    "url": full_url,
                    "link": img['link'],
                    "alt": img['alt']
                })
            # Small delay to avoid being too aggressive
            page.wait_for_timeout(500)

        # Generate HTML gallery
        print("📄 Generating index.html...")
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Gallery from {site_url}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }}
        h1 {{ color: #333; }}
        .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }}
        .card {{ background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); overflow: hidden; }}
        .card img {{ width: 100%; height: 200px; object-fit: cover; cursor: pointer; }}
        .card-info {{ padding: 10px; }}
        .card-info a {{ word-break: break-all; color: #0066cc; text-decoration: none; }}
        .card-info a:hover {{ text-decoration: underline; }}
        .image-url {{ font-size: 0.8em; color: #666; margin-top: 5px; }}
    </style>
</head>
<body>
    <h1>📸 Image Gallery</h1>
    <p>Source: <a href="{site_url}">{site_url}</a></p>
    <p>Total images downloaded: {len(downloaded)}</p>
    <div class="gallery">
"""
        for item in downloaded:
            html_content += f"""
        <div class="card">
            <img src="images/{item['file']}" alt="{item['alt']}" loading="lazy">
            <div class="card-info">
                <strong>Image link:</strong><br>
                <a href="{item['link'] if item['link'] else '#'}" target="_blank">{item['link'] if item['link'] else 'No link'}</a>
                <div class="image-url">
                    <small>File: {item['file']}</small>
                </div>
            </div>
        </div>
"""
        html_content += """
    </div>
</body>
</html>
"""

        with open("index.html", "w", encoding="utf-8") as f:
            f.write(html_content)

        print(f"✅ Done! {len(downloaded)} images saved in 'images/' folder.")
        print("🌍 index.html created in root directory.")
        browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scrape_images.py <URL> [max_images]")
        sys.exit(1)

    url = sys.argv[1]
    max_img = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    scrape_images(url, max_img)
