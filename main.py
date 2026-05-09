import sys
import os
import subprocess
import zipfile
from playwright.sync_api import sync_playwright
from http.cookiejar import MozillaCookieJar
import tempfile

def get_cookies_from_browser(video_url):
    """Shows a browser page, logs in (if needed) and returns cookies in Netscape format."""
    print("🚀 Starting browser...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--no-sandbox'])
        context = browser.new_context()
        page = context.new_page()
        page.goto(video_url)

        # --- Automatic Login for YouTube (if credentials provided) ---
        if "youtube.com" in video_url:
            yt_email = os.getenv('YT_EMAIL')
            yt_password = os.getenv('YT_PASSWORD')
            
            if yt_email and yt_password:
                sign_in_button = page.query_selector('a[aria-label="Sign in"]')
                if sign_in_button:
                    print("🔑 Login required. Starting automatic login...")
                    sign_in_button.click()
                    page.wait_for_load_state('networkidle')
                    
                    email_input = page.wait_for_selector('input[type="email"]', timeout=5000)
                    if email_input:
                        email_input.fill(yt_email)
                        page.click('#identifierNext')
                        page.wait_for_load_state('networkidle')
                    
                    password_input = page.wait_for_selector('input[type="password"]', timeout=5000)
                    if password_input:
                        password_input.fill(yt_password)
                        page.click('#passwordNext')
                        page.wait_for_load_state('networkidle')
                        print("✅ Login successful!")
                else:
                    print("✅ Already logged in or login not required.")
        
        page.wait_for_timeout(5000)
        
        cookies_list = context.cookies()
        
        cj = MozillaCookieJar()
        
        for cookie in cookies_list:
            from http.cookiejar import Cookie
            expires = cookie.get('expires', -1)
            if expires:
                try:
                    expires = int(expires)
                except:
                    expires = -1
            else:
                expires = -1
            
            c = Cookie(
                version=0,
                name=cookie['name'],
                value=cookie['value'],
                port=None,
                port_specified=False,
                domain=cookie.get('domain', ''),
                domain_specified=bool(cookie.get('domain')),
                domain_initial_dot=cookie.get('domain', '').startswith('.'),
                path=cookie.get('path', '/'),
                path_specified=True,
                secure=cookie.get('secure', False),
                expires=expires,
                discard=False,
                comment=None,
                comment_url=None,
                rest={'HttpOnly': cookie.get('httpOnly', False)},
                rfc2109=False
            )
            cj.set_cookie(c)
        
        browser.close()
        
        temp_cookie_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt')
        cj.save(filename=temp_cookie_file.name, ignore_discard=True, ignore_expires=True)
        temp_cookie_file.close()
        
        print(f"✅ Saved {len(cookies_list)} cookies to {temp_cookie_file.name}")
        return temp_cookie_file.name

def download_video(url, quality, cookie_file_path):
    """Downloads the video using yt-dlp with the provided cookies file."""
    
    # Determine format based on quality
    if quality == "audio":
        cmd = [
            "yt-dlp",
            "--cookies", cookie_file_path,
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--output", "video.%(ext)s",
            "--no-check-certificates",
            url
        ]
    elif quality == "lowest":
        # Download worst quality (lowest resolution, smallest size)
        cmd = [
            "yt-dlp",
            "--cookies", cookie_file_path,
            "--format", "worstvideo+worstaudio/worst",
            "--merge-output-format", "mp4",
            "--output", "video.%(ext)s",
            "--no-check-certificates",
            url
        ]
    elif quality == "best":
        cmd = [
            "yt-dlp",
            "--cookies", cookie_file_path,
            "--format", "bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
            "--output", "video.%(ext)s",
            "--no-check-certificates",
            url
        ]
    else:
        # For specific qualities like 1080p, 720p, etc.
        height = quality.replace('p', '')
        cmd = [
            "yt-dlp",
            "--cookies", cookie_file_path,
            "--format", f"bestvideo[height<={height}]+bestaudio/best[height<={height}]",
            "--merge-output-format", "mp4",
            "--output", "video.%(ext)s",
            "--no-check-certificates",
            url
        ]
    
    print(f"🚀 Downloading video with yt-dlp...")
    print(f"Command: {' '.join(cmd)}")
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"stderr: {result.stderr}")
        print(f"stdout: {result.stdout}")
        raise Exception(f"yt-dlp failed with return code {result.returncode}")
    
    print("✅ Download completed!")

def create_zip():
    """Creates a ZIP archive of the downloaded video."""
    possible_extensions = ['.mp4', '.webm', '.mkv', '.mp3', '.m4a', '.opus']
    video_file = None
    
    for ext in possible_extensions:
        for f in os.listdir('.'):
            if f.startswith('video.') and f.endswith(ext):
                video_file = f
                break
        if video_file:
            break
    
    if not video_file:
        raise FileNotFoundError("No video file found to zip. Checked for: video.mp4, video.webm, etc.")
    
    zip_filename = "downloads.zip"
    
    with zipfile.ZipFile(zip_filename, 'w') as zipf:
        zipf.write(video_file)
    
    print(f"✅ Video zipped as {zip_filename}")
    return zip_filename

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python main.py <URL> <QUALITY>")
        sys.exit(1)
    
    video_url = sys.argv[1]
    quality = sys.argv[2]
    cookie_file = None
    
    try:
        cookie_file = get_cookies_from_browser(video_url)
        download_video(video_url, quality, cookie_file)
        create_zip()
        print("\n🎉 All steps completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
