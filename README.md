# AgriSense PH — Smart Disease Detector

AI-powered crop disease detection para sa mga magsasaka ng Central Luzon.

## Folder Structure

```
agrisense-ph/
├── index.html          ← Pangunahing HTML (shell lang, walang logic)
├── analytics.html      ← Analytics dashboard
├── manifest.json       ← PWA config
├── README.md           ← Ito
│
├── css/
│   ├── app.css         ← Base styles at layout
│   ├── weather.css     ← Weather card styles
│   ├── result.css      ← Detection result styles
│   └── analytics.css   ← Analytics page styles
│
├── js/
│   ├── config.js       ← Settings at constants (dito mag-edit)
│   ├── state.js        ← Global app state
│   ├── diseases.js     ← Disease database at treatments
│   ├── weather-rules.js← Weather risk rules
│   ├── language.js     ← FIL/EN translations
│   ├── voice.js        ← Text-to-speech
│   ├── history.js      ← Detection history
│   ├── camera.js       ← Camera at upload
│   ├── model.js        ← AI model loading at detection
│   ├── weather.js      ← Weather API
│   ├── results.js      ← Results display
│   └── app.js          ← App initialization (HULI)
│
├── libs/
│   ├── tf.min.js                    ← I-download mula sa jsdelivr
│   └── teachablemachine-image.min.js← I-download mula sa jsdelivr
│
├── models/
│   ├── rice/           ← Ilagay ang rice model files dito
│   │   ├── model.json
│   │   ├── weights.bin
│   │   └── metadata.json
│   └── tomato/         ← Ilagay ang tomato model files dito
│
└── assets/
    └── icons/
        ├── icon-192.png
        └── icon-512.png
```

## Para Mag-run

```bash
cd agrisense-ph
python -m http.server 8000 --bind 0.0.0.0
```

Buksan sa browser: http://localhost:8000

## Para sa Phone (same WiFi)

1. Hanapin ang IP ng laptop: `ipconfig` (Windows)
2. Buksan sa phone: http://[IP-ADDRESS]:8000

## Para mag-deploy sa GitHub Pages

1. I-upload ang buong folder sa GitHub
2. Settings → Pages → main branch
3. URL: https://[username].github.io/agrisense-ph
