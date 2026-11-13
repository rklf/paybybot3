#!/bin/bash
# Double-click this file (macOS) to open paybybot in your browser.
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display dialog "Python 3 est nécessaire. La page de téléchargement va s'"'"'ouvrir : installez-le puis relancez ce fichier." buttons {"OK"}'
  open "https://www.python.org/downloads/"
  exit 1
fi

if [ ! -x venv/bin/python ] || ! venv/bin/python -c "import paybybot3.web" >/dev/null 2>&1; then
  echo "Première installation, patientez une minute..."
  python3 -m venv venv && venv/bin/pip install --quiet --upgrade pip && venv/bin/pip install --quiet -e . || {
    echo "L'installation a échoué. Vérifiez votre connexion internet puis réessayez."
    read -r -p "Appuyez sur Entrée pour fermer."
    exit 1
  }
fi

echo "paybybot est ouvert dans votre navigateur. Laissez cette fenêtre ouverte (fermez-la pour arrêter)."
venv/bin/python -m paybybot3 web
