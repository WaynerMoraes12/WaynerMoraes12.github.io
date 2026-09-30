#!/usr/bin/env python3
"""Vigia a sua atividade no GitHub e atualiza o portfólio, tudo a partir do seu PC.

Roda pelo Agendador de Tarefas do Windows a cada 2 minutos, enquanto você está logado:
  1. olha se apareceu commit, push ou PR novo seu (inclusive em repositórios privados);
  2. se apareceu, ou se faz mais de 30 minutos, roda o gerador (github_activity.py);
  3. publica só o activity.json na branch activity-data, que o site lê.

Segurança:
  - Nenhum token fica guardado no GitHub. O gerador usa o login do GitHub CLI (gh) deste
    PC, passado em memória só para o processo do gerador.
  - O estado interno (commits já analisados etc.) fica só neste PC.
  - Na instalação, o script, o gerador, a config e o catálogo são COPIADOS para
    %LOCALAPPDATA%\\PortfolioWatch. Mudanças no repositório não passam a rodar sozinhas no
    seu PC: só depois de você rodar --instalar de novo.
  - O gerador tem uma trava que cancela a publicação se algum nome de repositório privado
    aparecer nos dados.

Comandos (rodar de dentro do repositório):
  python scripts/watch_github.py --instalar   copia os arquivos e cria a tarefa
  python scripts/watch_github.py --remover    remove a tarefa e a pasta
  python scripts/watch_github.py --agora      gera e publica agora (mostra o log)
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

USER = "WaynerMoraes12"
REPO = f"{USER}/{USER}.github.io"
BRANCH = "activity-data"
TASK = "Portfolio - GitHub ao vivo"
HOME = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PortfolioWatch"
OUT = HOME / "out"
STATE = HOME / "watch.json"
LOCK = HOME / "lock"
LOG = HOME / "watch.log"
HEARTBEAT = 30 * 60          # sem novidade, republica a cada 30 min (o "atualizado há" não envelhece)
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
# Caminho absoluto do gh: não depende do PATH, que poderia ser adulterado
GH = r"C:\Program Files\GitHub CLI\gh.exe"
if not Path(GH).exists():
    GH = shutil.which("gh") or GH
VERBOSE = "--agora" in sys.argv


def log(msg: str) -> None:
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
    if VERBOSE:
        print(line)
    try:
        old = LOG.read_text(encoding="utf-8").splitlines()[-300:] if LOG.exists() else []
        LOG.write_text("\n".join(old + [line]) + "\n", encoding="utf-8")
    except OSError:
        pass


def gh(*args: str, stdin: str | None = None) -> str:
    res = subprocess.run([GH, *args], input=stdin, capture_output=True, text=True, timeout=120,
                         creationflags=NO_WINDOW)
    if res.returncode != 0:
        raise RuntimeError(f"gh {args[0]} {args[1] if len(args) > 1 else ''} falhou")  # sem ecoar a saída
    return res.stdout.strip()


def fingerprint() -> str:
    parts = []
    for args in (["api", f"users/{USER}/events?per_page=5", "--jq", '[.[].id] | join(",")'],
                 ["api", f"search/issues?q=author:{USER}+is:pr&sort=updated&order=desc&per_page=1",
                  "--jq", ".items[0].updated_at"],
                 ["api", f"search/commits?q=author:{USER}&sort=author-date&order=desc&per_page=1",
                  "--jq", ".items[0].sha"]):
        try:
            parts.append(gh(*args))
        except Exception:
            parts.append("")
    return "|".join(parts)


def generate() -> bool:
    token = gh("auth", "token")
    env = {**os.environ, "GH_TOKEN": token, "GH_PRIVATE_TOKEN": token,
           "ACTIVITY_OUT": str(OUT), "ACTIVITY_CONFIG_DIR": str(HOME), "PYTHONIOENCODING": "utf-8"}
    python = Path(sys.executable).with_name("python.exe")
    res = subprocess.run([str(python if python.exists() else sys.executable), str(HOME / "github_activity.py")],
                         env=env, capture_output=True, text=True, timeout=1800, creationflags=NO_WINDOW)
    del env, token
    tail = (res.stdout or "").strip().splitlines()[-1:] + (res.stderr or "").strip().splitlines()[-1:]
    log(("gerador ok: " if res.returncode == 0 else "gerador falhou: ") + " | ".join(tail)[:400])
    return res.returncode == 0


def content_key(path: Path) -> str:
    d = json.loads(path.read_text(encoding="utf-8"))
    d.pop("generated_at", None)
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


def publish() -> None:
    """Um commit sem histórico, só com activity.json, e a branch aponta para ele."""
    body = (OUT / "activity.json").read_bytes()
    blob = json.loads(gh("api", "-X", "POST", f"repos/{REPO}/git/blobs", "--input", "-",
                         stdin=json.dumps({"content": base64.b64encode(body).decode(), "encoding": "base64"})))["sha"]
    tree = json.loads(gh("api", "-X", "POST", f"repos/{REPO}/git/trees", "--input", "-",
                         stdin=json.dumps({"tree": [{"path": "activity.json", "mode": "100644", "type": "blob", "sha": blob}]})))["sha"]
    commit = json.loads(gh("api", "-X", "POST", f"repos/{REPO}/git/commits", "--input", "-",
                           stdin=json.dumps({"message": "Atividade do GitHub", "tree": tree, "parents": []})))["sha"]
    try:
        gh("api", "-X", "PATCH", f"repos/{REPO}/git/refs/heads/{BRANCH}", "--input", "-",
           stdin=json.dumps({"sha": commit, "force": True}))
    except RuntimeError:
        gh("api", "-X", "POST", f"repos/{REPO}/git/refs", "--input", "-",
           stdin=json.dumps({"ref": f"refs/heads/{BRANCH}", "sha": commit}))


def check(force: bool = False) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    # uma execução por vez (a primeira contagem completa leva alguns minutos)
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 40 * 60:
        return
    LOCK.write_text(str(os.getpid()), encoding="utf-8")
    try:
        state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
        fp, now = fingerprint(), time.time()
        if not fp.strip("|"):
            log("sem resposta do GitHub (sem internet ou gh deslogado)")
            return
        changed = fp != state.get("fingerprint")
        stale = now - state.get("published_at", 0) > HEARTBEAT
        if not (force or changed or stale):
            return
        if not generate():
            return
        key = content_key(OUT / "activity.json")
        if force or key != state.get("content_key") or stale:
            publish()
            state.update(content_key=key, published_at=now)
            log("publicado" + (" (novidade)" if changed else " (rotina)"))
        state["fingerprint"] = fp
        STATE.write_text(json.dumps(state), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 - a tarefa agendada não pode quebrar
        log(f"erro: {type(e).__name__}: {str(e)[:200]}")
    finally:
        LOCK.unlink(missing_ok=True)


def install() -> None:
    repo = Path(__file__).resolve().parent.parent
    HOME.mkdir(parents=True, exist_ok=True)
    for src in ("scripts/github_activity.py", "scripts/watch_github.py", "data/tech-catalog.json", "data/github-config.json"):
        shutil.copy2(repo / src, HOME / Path(src).name)
    pyw = Path(sys.executable).with_name("pythonw.exe")
    cmd = f'"{pyw if pyw.exists() else sys.executable}" "{HOME / "watch_github.py"}"'
    res = subprocess.run(["schtasks", "/Create", "/F", "/SC", "MINUTE", "/MO", "2", "/TN", TASK, "/TR", cmd],
                         capture_output=True, text=True)
    print(res.stdout or res.stderr)
    print(f"Arquivos copiados para {HOME}")


def uninstall() -> None:
    res = subprocess.run(["schtasks", "/Delete", "/F", "/TN", TASK], capture_output=True, text=True)
    print(res.stdout or res.stderr)
    shutil.rmtree(HOME, ignore_errors=True)


if __name__ == "__main__":
    if "--instalar" in sys.argv:
        install()
    elif "--remover" in sys.argv:
        uninstall()
    else:
        check(force="--agora" in sys.argv)
