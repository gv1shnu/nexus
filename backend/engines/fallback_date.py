import sys
import json
from goose3 import Goose
import dateparser

def extract_date(url):
    try:
        g = Goose({'browser_user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        article = g.extract(url=url)
        
        raw_date = article.publish_date
        
        if raw_date:
            parsed = dateparser.parse(raw_date)
            if parsed:
                return parsed.isoformat()
                
        return None
    except Exception as e:
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)
        
    url = sys.argv[1]
    date = extract_date(url)
    
    print(json.dumps({"url": url, "publishedDate": date}))
