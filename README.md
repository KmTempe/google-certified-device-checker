# Google Certified Device Checker

**What this does:** This tool helps you check if an Android device is certified by Google Play. It searches through Google's official list of approved devices and shows you the results.

**How it works:** You get a website (the frontend) where you can type in a device name, and a service (the backend) that searches the database and sends back the answers.

---

## For People Forking This

If you're making your own copy of this project, you **must** change these files or your site won't work:

### 1. Deploy Your Own Backend (`render.yaml`)

**What to change:**
```yaml
name: google-certified-device-checker-api  # Optional: Change to YOUR service name
```

**Why:** When you deploy to Render, you'll get your own unique URL (like `https://my-device-checker-api.onrender.com`). Changing the service name just helps you identify it in your Render dashboard—it won't conflict with anyone else's service since each Render account is separate.

**Example:**
```yaml
name: my-device-checker-api
```

### 2. Update Frontend API URLs (`.github/workflows/pages.yml`)

**What to change:**
```yaml
env:
  VITE_API_BASE_URL: https://google-certified-device-checker-api.onrender.com  # Change to YOUR Render URL
  VITE_BASE_PATH: /google-certified-device-checker/  # Change to YOUR repo name
```

**Why:** This tells your website where to find YOUR backend service, not the original one. If you don't change this, your site will try to use someone else's API and fail due to browser security (CORS).

**Example:**
```yaml
env:
  VITE_API_BASE_URL: https://my-device-checker-api.onrender.com
  VITE_BASE_PATH: /my-repo-name/
```

### 3. Update CORS Allowed Origins (`app/main.py`)

**What to change:**
```python
allow_origins=[
    "https://kmtempe.github.io",  # Change to YOUR GitHub Pages URL
    "http://localhost:5173",
    "http://127.0.0.1:5173",
],
```

**Why:** This controls which websites can access your API through a browser. Without updating this, your deployed site won't be able to talk to your API.

**Example:**
```python
allow_origins=[
    "https://yourname.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
],
```

**Key takeaway:** If you skip these changes, your forked site will either not work at all (CORS errors) or accidentally use someone else's backend service. Always update these three places!

---

## How We Keep the API Safe

We protect our service from being overused or abused:

### Rate Limiting (Token Bucket Algorithm)
**Simple explanation:** Think of it like having a bucket of tokens. Each time someone asks our service for information, they use one token. We refill the bucket slowly over time.

- **Main limit:** 50 requests per 30 minutes *(you get 50 tokens that refill over half an hour)*
- **Burst allowance:** 20 requests per 5 minutes *(you can use up to 20 tokens quickly, but can't keep doing it)*

**Everyday example:** It's like a coffee shop giving you a punch card with 50 punches that resets every 30 minutes. You can get 20 coffees really fast if you want, but once you hit 50 total in half an hour, you need to wait.

**Key takeaway:** This prevents someone from hammering our service with thousands of requests and slowing it down for everyone else.

### Browser Protection
**Simple explanation:** We only let requests from our official website and local development computers access the service through a web browser.

- Only these websites can use the service:
  - `https://kmtempe.github.io` *(our official site)*
  - `http://localhost:5173` and `http://127.0.0.1:5173` *(for developers testing locally)*

**Everyday example:** It's like a restaurant that only accepts reservations from their own website, not from random third-party booking sites.

**Note:** People can still use tools like `curl` or Postman to access the API directly—that's okay because Google's device list is public information anyway. The rate limiting still protects us from abuse.

### Read-Only Access
**Simple explanation:** You can only look up information, not change or delete anything.

**Key takeaway:** The service is view-only, like a library where you can read books but not write in them.

---

## Setting Up the Backend (Python Service)

This is the part that searches the device database and responds to requests.

**Requirements:** Python 3.14.0

### Steps:

1. **Turn on your Python environment:**
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```
   *(This keeps your project's tools separate from other projects)*

2. **Install what you need:**
   ```powershell
   pip install -r requirements.txt
   ```
   *(Downloads all the helper libraries the service needs)*

3. **Start the service:**
   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
   ```
   *(Starts the service running on your computer)*

4. **Check it's working:**
   Open your browser and go to: `http://127.0.0.1:8000/health`
   
   You should see: `{"status": "ok"}`

---

## Setting Up the Frontend (Website)

This is the website where users type in device names and see results.

**Requirements:** Node.js 25.0.0 or newer

### Steps:

1. **Go to the frontend folder:**
   ```powershell
   cd frontend
   ```

2. **Install what you need:**
   ```powershell
   npm install
   ```
   *(Downloads all the website building tools)*

3. **Optional - Point to your local backend:**
   ```powershell
   Copy-Item .env.example .env.local
   ```
   *(This tells the website to use your local Python service instead of the live one)*

4. **Start the website:**
   ```powershell
   npm run dev
   ```
   *(Starts a local web server)*

5. **Open it in your browser:**
   The terminal will show you a URL, usually: `http://127.0.0.1:5173`

**How they connect:** The website (frontend) talks to the Python service (backend) to get device information. When you deploy to production, the website is hosted on GitHub Pages and talks to the backend hosted on Render.

---

## Running Tests

Tests make sure everything works correctly before you publish changes.

### Steps:

1. **Install testing tools (first time only):**
   ```powershell
   pip install -r requirements-dev.txt
   ```

2. **Run the tests:**
   ```powershell
   pytest
   ```
   *(This checks that the backend service works correctly)*

You should see all tests pass with green checkmarks ✅

---

## Keeping the Device List Up-to-Date

Google updates their certified device list regularly. We have automation to keep our copy fresh.

### Manual Update:
```powershell
python scripts/refresh_dataset.py
```
*(Downloads the latest device list from Google)*

Add `--force` to re-download even if nothing changed.

### Automatic Updates:
Every day at 8:00 AM (UTC), a robot automatically checks if Google updated their list. If they did, it downloads the new version and saves it to the `dataset-refresh` branch.
