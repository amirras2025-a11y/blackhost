from icrawler.builtin import GoogleImageCrawler
import json
import os

def scrape_and_generate_html(query, max_num=50):
    # کرال کردن تصاویر و ذخیره در پوشه 'images'
    google_crawler = GoogleImageCrawler(storage={'root_dir': 'images'})
    google_crawler.crawl(keyword=query, max_num=max_num)

    # ساخت فایل HTML از تصاویر دانلود شده
    image_files = os.listdir('images')
    html_content = """<html>...""" # کد HTML که تصاویر و لینک‌ها را نمایش می‌دهد

    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(html_content)

if __name__ == "__main__":
    scrape_and_generate_html(os.environ.get('SEARCH_QUERY'), max_num=int(os.environ.get('IMAGE_LIMIT', 50)))
