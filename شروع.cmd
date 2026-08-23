@echo off
title ایجنت ویس فارسی
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0serve.ps1"
pause