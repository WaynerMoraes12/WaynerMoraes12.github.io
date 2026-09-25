#!/usr/bin/env python3
"""Vigia a sua atividade no GitHub e atualiza o portfólio na hora.

O agendamento do GitHub Actions é "melhor esforço": às vezes passa horas sem rodar.
Este script roda no seu PC (pelo Agendador de Tarefas do Windows, a cada 2 minutos),
olha se apareceu commit, push ou PR novo seu, inclusive em repositórios privados,
e só então dispara o workflow "Atividade do GitHub" do portfólio.

Usa o login do GitHub CLI (gh) deste PC. Nada é enviado para fora do GitHub.
Guarda só uma "impressão digital" da última atividade em %LOCALAPPDATA%.

Instalar:   python scripts/watch_github.py --instalar
Remover:    python scripts/watch_github.py --remover
Rodar agora (teste): python scripts/watch_github.py --verbose
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

USER = "WaynerMoraes12"
REPO = f"{USER}/{USER}.github.io"
WORKFLOW = "github-activity.yml"
TASK = "Portfolio - GitHub ao vivo"
STATE = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "portfolio-github-watch.json"
HEARTBEAT = 30 * 60        # mesmo sem novidade, atualiza a cada 30 min enquanto o PC estiver ligado
MIN_GAP = 60               # nunca dispara mais de uma vez por minuto
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
GH = shutil.which("gh") or r"C:\Program Files\GitHub CLI\gh.exe"
VERBOSE = "--verbose" in sys.argv


def log(*a):
    if VERBOSE:
        print(*a)


def gh(*args: str) -> str:
    res = subprocess.run([GH, *args], capture_output=True, text=True, timeout=60, creationflags=NO_WINDOW)
    return res.stdout.strip() if res.returncode == 0 else ""


def fingerprint() -> str:
    # Autenticado como você, a API de eventos inclui os eventos privados
    events = gh("api", f"users/{USER}/events?per_page=5", "--jq", "[.[].id] | join(\",\")")
    prs = gh("api", f"search/issues?q=author:{USER}+is:pr&sort=updated&order=desc&per_page=1", "--jq", ".items[0].updated_at")
    commits = gh("api", f"search/commits?q=author:{USER}&sort=author-date&order=desc&per_page=1", "--jq", ".items[0].sha")
    return "|".join([events, prs, commits])


def check() -> None:
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    fp, now = fingerprint(), time.time()
    if not fp.strip("|"):
        log("Sem resposta do GitHub (sem internet ou gh deslogado).")
        return
    changed = fp != state.get("fingerprint")
    stale = now - state.get("dispatched_at", 0) > HEARTBEAT
    if (changed or stale) and now - state.get("dispatched_at", 0) > MIN_GAP:
        ok = subprocess.run([GH, "workflow", "run", WORKFLOW, "-R", REPO], capture_output=True, text=True,
                            timeout=60, creationflags=NO_WINDOW).returncode == 0
        log("Disparado" if ok else "Falhou ao disparar", "(novidade)" if changed else "(rotina)")
        if ok:
            state["dispatched_at"] = now
    else:
        log("Nada novo.")
    state["fingerprint"] = fp
    state["checked_at"] = now
    STATE.write_text(json.dumps(state), encoding="utf-8")


def install() -> None:
    pyw = Path(sys.executable).with_name("pythonw.exe")
    cmd = f'"{pyw if pyw.exists() else sys.executable}" "{Path(__file__).resolve()}"'
    res = subprocess.run(["schtasks", "/Create", "/F", "/SC", "MINUTE", "/MO", "2", "/TN", TASK, "/TR", cmd],
                         capture_output=True, text=True)
    print(res.stdout or res.stderr)


def uninstall() -> None:
    res = subprocess.run(["schtasks", "/Delete", "/F", "/TN", TASK], capture_output=True, text=True)
    print(res.stdout or res.stderr)


if __name__ == "__main__":
    if "--instalar" in sys.argv:
        install()
    elif "--remover" in sys.argv:
        uninstall()
    else:
        check()
