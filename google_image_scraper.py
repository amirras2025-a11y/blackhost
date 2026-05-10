import sys
import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs, quote_plus
import re
import json

def search_google_images(query, limit=50, safe='active'):
    """
    Searches Google Images and returns a list of image URLs and source page URLs.
    """
    images = []
    start = 0
    # Define the safe parameter correctly: 'active' (filter on) or 'off' (filter off)
    safe_value = 'active' if safe == 'true' else 'off'
    
    while len(images) < limit:
        # Build the Google Images search URL
        url = f"https://www.google.com/search?q={quote_plus(query)}&tbm=isch&safe={safe_value}&start={start}"
        
        try:
            # Send a request with a common user-agent to avoid being blocked
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
            response = requests.get(url, headers=headers)
            response.raise_for_status()  # Raise an exception for bad status codes
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Find all image containers (this is a heuristic and may need adjustment)
            # We're looking for <img> tags that have a 'data-src' attribute (high-res)
            img_tags = soup.find_all('img', {'data-src': re.compile(r'^https?://')})
            
            if not img_tags:
                # Fallback: try to find standard 'src' attributes
                img_tags = soup.find_all('img', {'src': re.compile(r'^https?://')})
            
            for img_tag in img_tags:
                if len(images) >= limit:
                    break
                
                img_url = img_tag.get('data-src') or img_tag.get('src')
                
                # Try to get the source page URL (parent link)
                # This part is more complex as Google's HTML structure changes frequently
                # We'll attempt to find a parent <a> tag that contains a link to the original page
                source_url = None
                parent = img_tag.find_parent('a')
                if parent and parent.get('href'):
                    href = parent.get('href')
                    # Google's links are in the format '/url?q=SOURCE_URL&...'
                    if '/url?q=' in href:
                        parsed_url = urlparse(href)
                        query_params = parse_qs(parsed_url.query)
                        if 'q' in query_params:
                            source_url = query_params['q'][0]
                    else:
                        source_url = href
                
                if img_url and img_url not in [img['url'] for img in images]:
                    images.append({
                        'url': img_url,
                        'source': source_url
                    })
            
            # Move to the next page of results
            start += 20
            if start > 200:  # Google usually shows up to 10-20 pages (200-400 images)
                break
                
        except Exception as e:
            print(f"Error during search: {e}")
            break
    
    return images[:limit]

def generate_html(images, query):
    """
    Generates an HTML file with the scraped images.
    """
    if not images:
        return f"<html><body><h1>No images found for '{query}'.</h1></body></html>"
    
    cards = ''
    for i, img in enumerate(images):
        source_url = img.get('source', '#')
        img_url = img.get('url', '#')
        if img_url == '#':
            continue
        cards += f"""
        <div class="card">
            <div class="img-wrapper">
                <img src="{img_url}" alt="Image {i+1}" loading="lazy" onerror="this.style.opacity='0.2'">
            </div>
            <div class="info">
                <div class="source">
                    🔗 <a href="{source_url}" target="_blank" rel="noopener noreferrer">{source_url[:70]}{'...' if len(source_url) > 70 else ''}</a>
                    <button class="copy-btn" data-link="{source_url}">📋 Copy</button>
                </div>
            </div>
        </div>
        """
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Image Gallery: {query}</title>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{ font-family: system-ui, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; padding: 20px; }}
    .container {{ max-width: 1400px; margin: 0 auto; }}
    h1 {{ text-align: center; margin-bottom: 10px; color: #1a1a2e; }}
    .sub {{ text-align: center; margin-bottom: 30px; color: #4a4a6a; }}
    .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; }}
    .card {{ background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); transition: transform 0.2s, box-shadow 0.2s; }}
    .card:hover {{ transform: translateY(-4px); box-shadow: 0 12px 20px rgba(0,0,0,0.1); }}
    .img-wrapper {{ aspect-ratio: 16/9; background: #e9ecef; display: flex; align-items: center; justify-content: center; overflow: hidden; }}
    .img-wrapper img {{ width: 100%; height: 100%; object-fit: contain; background: #f0f0f0; }}
    .info {{ padding: 12px 15px; }}
    .source {{ display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.75rem; background: #f8f9fa; padding: 6px 10px; border-radius: 30px; }}
    .source a {{ color: #0066cc; text-decoration: none; word-break: break-all; flex: 1; }}
    .source a:hover {{ text-decoration: underline; }}
    .copy-btn {{ background: #e9ecef; border: none; padding: 4px 12px; border-radius: 20px; cursor: pointer; font-size: 0.7rem; font-weight: 500; transition: background 0.2s; }}
    .copy-btn:hover {{ background: #dee2e6; }}
    .title {{ font-size: 0.7rem; color: #6c757d; margin-top: 8px; word-break: break-word; }}
    footer {{ text-align: center; margin-top: 40px; color: #6c757d; font-size: 0.75rem; border-top: 1px solid #dee2e6; padding-top: 20px; }}
    @media (max-width: 640px) {{ .gallery {{ gap: 15px; }} }}
  </style>
</head>
<body>
<div class="container">
  <h1>🖼️ Google Image Gallery</h1>
  <div class="sub">🔍 "{query}" — {len(images)} images</div>
  <div class="gallery">{cards}</div>
  <footer>Images belong to their respective owners. Source links point to original webpages.</footer>
</div>
<script>
document.querySelectorAll('.copy-btn').forEach(btn => {{
  btn.addEventListener('click', async () => {{
    const link = btn.getAttribute('data-link');
    if (!link) return;
    try {{
      await navigator.clipboard.writeText(link);
      const old = btn.innerText;
      btn.innerText = '✅ Copied!';
      setTimeout(() => btn.innerText = old, 1500);
    }} catch(e) {{
      prompt('Copy manually:', link);
    }}
  }});
}});
</script>
</body>
</html>"""
    return html

def main():
    query = os.environ.get('SEARCH_QUERY')
    limit = int(os.environ.get('IMAGE_LIMIT', '30'))
    safe_mode = os.environ.get('SAFE_MODE', 'true')
    
    if not query:
        print("❌ Error: SEARCH_QUERY not set.")
        sys.exit(1)
    
    print(f"🔍 Searching Google Images for '{query}' (limit: {limit}, safe: {safe_mode})...")
    
    images = search_google_images(query, limit, safe_mode)
    
    if not images:
        print("⚠️ No images found. This could be due to Google's scraping protections.")
        print("🔄 Consider trying the alternative Node.js method or using a service like Apify.")
        # Generate an HTML stating that no images were found
        with open('index.html', 'w', encoding='utf-8') as f:
            f.write(f"<html><body><h1>No images found for '{query}'. Please try the alternative method.</h1></body></html>")
    else:
        print(f"✅ Found {len(images)} images. Generating HTML...")
        html_content = generate_html(images, query)
        with open('index.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        print("✅ index.html generated successfully.")

if __name__ == "__main__":
    main()
