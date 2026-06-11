# Stars of Science — AI Content Scorer

## Setup in 5 mins

### 1. Backend
```bash
cd backend
pip install -r requirements.txt

# Add your keys in data_layer.py and scorer.py
# RAPIDAPI_KEY = "your key"
# anthropic.Anthropic(api_key="your key")

uvicorn main:app --reload --port 8000
```

### 2. Frontend
```bash
cd frontend
npx create-react-app . --template minimal   # or use Vite
# Replace src/App.jsx with the provided file
npm start
```

### 3. Test it
- Open http://localhost:3000
- Paste a post → click Score
- Backend must be running on port 8000

## File Structure
```
sos-scorer/
├── backend/
│   ├── main.py          ← FastAPI app
│   ├── scorer.py        ← Claude scoring logic  
│   ├── data_layer.py    ← All RapidAPI calls
│   └── requirements.txt
└── frontend/
    └── src/
        └── App.jsx      ← React UI
```

## Keys needed
- RAPIDAPI_KEY → rapidapi.com (free tier)
- ANTHROPIC_API_KEY → console.anthropic.com
