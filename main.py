import sys
import os
import subprocess
import zipfile
from playwright.sync_api import sync_playwright

def get_cookies_from_browser(video_url):
    """Shows a browser page, logs in (if needed) and returns cookies in Netscape format."""
    print("🚀 Starting browser...")
    with sync_playwright() as p:
        # Launch a visible browser (non-headless) for GitHub Actions environment
        browser = p.chromium.launch(headless=False, args=['--no-sandbox'])
        context = browser.new_context()
        page = context.new_page()
        page.goto(video_url)

        # --- Automatic Login (if credentials are provided) ---
        # Check if we are on a YouTube page that requires login
        if "youtube.com" in video_url:
            # Check if login is needed (look for the 'SIGN IN' button)
            sign_in_button = page.query_selector('a[aria-label="Sign in"]')
            if sign_in_button:
                print("🔑 Login required. Starting automatic login...")
                sign_in_button.click()
                page.wait_for_load_state('networkidle')

                # Step 1: Enter Email
                email_input = page.wait_for_selector('input[type="email"]', timeout=5000)
                if email_input:
                    email_input.fill(os.getenv('YT_EMAIL'))
                    page.click('#identifierNext')
                    page.wait_for_load_state('networkidle')

                # Step 2: Enter Password
                password_input = page.wait_for_selector('input[type="password"]', timeout=5000)
                if password_input:
                    password_input.fill(os.getenv('YT_PASSWORD'))
                    page.click('#passwordNext')
                    page.wait_for_load_state('networkidle')
                    print("✅ Login successful!")
                # ... (optional: phone recovery step) ...
            else:
                print("✅ Already logged in or login not required.")
        # --- End of Automatic Login ---

        # After login, wait a bit for the page to fully settle
        page.wait_for_timeout(3000)

        # Get all cookies from the browser context
        cookies = context.cookies()
        
        # Convert cookies to Netscape format
        netscape_cookies = []
        for cookie in cookies:
            if cookie.get('domain', '').startswith('.'):
                domain = cookie['domain']
            else:
                domain = f".{cookie['domain']}"

            netscape_cookies.append(
                f"{domain}\tTRUE\t{cookie.get('path', '/')}\t"
                f"{'TRUE' if cookie.get('secure', False) else 'FALSE'}\t"
                f"{cookie.get('expires', 0)}\t{cookie['name']}\t{cookie['value']}"
            )

        browser.close()
        return "\n".join(netscape_cookies)

def download_video(url, quality, cookies_content):
    """Downloads the video using yt-dlp with the provided cookies."""
    # Save cookies to a temporary file
    with open("cookies.txt", "w") as f:
        f.write(cookies_content)

    # Determine format based on quality
    if quality == "audio":
        cmd = [
            "yt-dlp",
            "--cookies", "cookies.txt",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--output", "video.%(ext)s",
            url
        ]
    elif quality == "best":
        cmd = [
            "yt-dlp",
            "--cookies", "cookies.txt",
            "--format", "bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
            "--output", "video.%(ext)s",
            url
        ]
    else:
        # For specific qualities like 1080p, 720p, etc.
        cmd = [
            "yt-dlp",
            "--cookies", "cookies.txt",
            "--format", f"bestvideo[height<={quality[:-1]}]+bestaudio/best[height<={quality[:-1]}]",
            "--merge-output-format", "mp4",
            "--output", "video.%(ext)s",
            url
        ]

    # Execute yt-dlp
    print(f"🚀 Downloading video with yt-dlp...")
    subprocess.run(cmd, check=True)

def create_zip():
    """Creates a ZIP archive of the downloaded video."""
    # Find the downloaded video file (could be .mp4, .webm, .mkv, .mp3, etc.)
    video_files = [f for f in os.listdir('.') if os.path.isfile(f) and f.startswith('video.') and not f.endswith('.zip')]
    
    if not video_files:
        raise FileNotFoundError("No video file found to zip.")
    
    video_file = video_files[0]
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

    try:
        # Step 1: Get fresh cookies via Playwright
        cookies = get_cookies_from_browser(video_url)
        
        # Step 2: Download video using yt-dlp with those cookies
        download_video(video_url, quality, cookies)
        
        # Step 3: Create ZIP archive
        create_zip()
        
        print("\n🎉 All steps completed successfully!")
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        sys.exit(1)
