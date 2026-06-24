#!/bin/bash
echo ""
echo "  💅 nail.try — Starting local server..."
echo "  ────────────────────────────────────────"
echo ""
echo "  Open this URL in Chrome:"
echo ""
echo "    👉  http://localhost:8080/nail-tryon-poc.html"
echo ""
echo "  Press Ctrl+C to stop the server."
echo ""
cd "$(dirname "$0")"
python3 -m http.server 8080
