# WhatsApp Number Checker

Standalone tool: upload a CSV of leads, it checks each number against WhatsApp, and gives you a CSV of only the numbers that are actually on WhatsApp — ready to import into your bulk messaging app.

## How it works

It runs a real WhatsApp Web session in the background (via `whatsapp-web.js`, which drives headless Chromium). You link it to a WhatsApp account once by scanning a QR code, exactly like linking WhatsApp Web on a new browser. After that it stays logged in.

**Important — read before using:**
- This uses an **unofficial** method (not Meta's Business API), because the official API has no "check if a number exists" endpoint. This means it technically runs against WhatsApp's terms of service.
- **Use a spare/secondary number**, not your main personal or business number. If WhatsApp flags the account for automated behavior, that account can be banned.
- The tool deliberately checks numbers **one at a time with a 2.5-5.5 second random delay** between each. Do not remove this — checking too fast is what gets accounts banned. For 1,000 numbers, expect ~45-75 minutes.
- Run this on a schedule (e.g. a few hundred numbers a day) rather than blasting your whole list at once if you want to minimize risk further.

## Local setup

```bash
cd whatsapp-checker
npm install
npm start
```

Open `http://localhost:3000`, scan the QR code with WhatsApp (Settings → Linked Devices → Link a Device), then upload your CSV.

## CSV format

- Any CSV with a phone-number column works. The tool auto-detects a column named something like `phone`, `number`, `mobile`, or `whatsapp` — or you can type the exact column name in the UI.
- Numbers should ideally include the country code (e.g. `2348012345678`). If your list has local numbers without a country code, enter the default country code in the UI (e.g. `234` for Nigeria) and it'll be prefixed automatically for short numbers.

## Output

The downloaded CSV contains all original columns for numbers confirmed on WhatsApp, plus:
- `normalized_number` — the cleaned number actually checked
- `whatsapp_id` — WhatsApp's internal ID for that number (proof it's registered)

## Deploying to Railway

1. Push this folder to a GitHub repo, connect it in Railway (same flow you already use).
2. Railway will build using the included `Dockerfile` (needed for Chromium).
3. **Add a persistent volume** mounted at `/app/wa-session`. Without this, every redeploy wipes your WhatsApp login and you'll need to re-scan the QR code.
4. Since the QR code only appears in the web UI, you'll need to visit the deployed URL once after each fresh login to scan it.

## Known limitations

- In-memory job store — if the server restarts mid-job, progress is lost (fine for a personal single-user tool; let me know if you want job persistence added).
- `whatsapp-web.js` reverse-engineers WhatsApp Web's protocol, so a WhatsApp update can occasionally break it until the library is patched. Keep an eye on the [whatsapp-web.js GitHub](https://github.com/pedroslopez/whatsapp-web.js) if checks suddenly start failing.
