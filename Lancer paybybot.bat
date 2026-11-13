@echo off
rem Double-click this file (Windows) to open paybybot in your browser.
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul || (
  echo Python 3 est necessaire. Installez-le depuis https://www.python.org/downloads/ puis relancez ce fichier.
  start https://www.python.org/downloads/
  pause
  exit /b 1
)

venv\Scripts\python -c "import paybybot3.web" >nul 2>nul || (
  echo Premiere installation, patientez une minute...
  py -3 -m venv venv && venv\Scripts\python -m pip install --quiet -e . || (
    echo L'installation a echoue. Verifiez votre connexion internet puis reessayez.
    pause
    exit /b 1
  )
)

echo paybybot est ouvert dans votre navigateur. Laissez cette fenetre ouverte (fermez-la pour arreter).
venv\Scripts\python -m paybybot3 web
pause
