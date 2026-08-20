@echo off
echo.
echo  PDF to Markdown - Modo Desenvolvimento
echo  =======================================
echo.
echo  Instala dependencias e abre o app no modo dev (com hot-reload).
echo.
pause

powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" -DevOnly

pause
