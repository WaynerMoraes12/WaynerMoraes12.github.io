#!/usr/bin/env python3
"""Gera activity.json com a atividade recente no GitHub (feed, contadores e competências).

O que faz:
  1. Lê os commits do usuário nos repositórios PÚBLICOS dele (sem forks) e as
     pull requests públicas mergeadas, com título e descrição.
  2. Se houver um token com acesso privado (GH_PRIVATE_TOKEN), lê também os
     commits e PRs mergeadas em repositórios PRIVADOS. Deles só sai "commit em
     repositório privado" e a data: nome do repositório, mensagem, arquivos e
     link nunca são gravados, nem no arquivo de estado.
  3. Remove de títulos públicos qualquer texto que pareça segredo (tokens, chaves,
     senhas, e-mails, IPs, links). Na dúvida, troca por uma descrição genérica.
  4. Detecta as ferramentas usadas em cada commit (extensões, dependências,
     imports) e conta os usos. Ao atingir o limite (3 por padrão), a ferramenta
     entra nas competências do site.
  5. Conta commits (30 dias e ano), PRs abertas, PRs mergeadas e repositórios ativos.

Uso: GH_TOKEN=... [GH_PRIVATE_TOKEN=...] [ACTIVITY_OUT=pasta] python scripts/github_activity.py
Só usa a biblioteca padrão do Python.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = json.loads((DATA / "github-config.json").read_text(encoding="utf-8"))
CATALOG = json.loads((DATA / "tech-catalog.json").read_text(encoding="utf-8"))
OUT_DIR = Path(os.environ.get("ACTIVITY_OUT") or DATA)
STATE_PATH = OUT_DIR / "github-state.json"
OUT_PATH = OUT_DIR / "activity.json"

USER = CONFIG["username"]
THRESHOLD = int(CONFIG.get("skill_threshold", 3))
FEED_SIZE = int(CONFIG.get("feed_size", 6))
BACKFILL_DAYS = int(CONFIG.get("backfill_days", 365))
MAX_DETAILS = int(CONFIG.get("max_commit_details_per_run", 250))
EXCLUDED = {r.lower() for r in CONFIG.get("excluded_repos", [])}
TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
PRIVATE_TOKEN = os.environ.get("GH_PRIVATE_TOKEN") or None
API = "https://api.github.com"
NOW = dt.datetime.now(dt.timezone.utc)


# ---------------------------------------------------------------- HTTP
def gh(path: str, params: dict | None = None, token: str | None = None):
    token = token or TOKEN
    url = path if path.startswith("http") else API + path
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": f"{USER}-portfolio-activity",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        if err.code in (403, 404, 409, 422, 451):  # sem acesso, repo vazio, removido ou busca inválida
            return None
        raise


def iso(s: str | None) -> dt.datetime | None:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


# ---------------------------------------------------------------- Sanitização
# Palavras inteiras (\b), para "Redesenha" não ser confundido com "senha"
SENSITIVE_WORDS = re.compile(
    r"\b(senhas?|passwords?|passwd|pwd|secrets?|segredos?|tokens?|api[\s_-]?keys?|apikey|chaves?|"
    r"credenc\w*|credentials?|private[\s_-]?keys?|ssh|dotenv|cpf|cnpj|rg|"
    r"cart[aã]o|cart[oõ]es|cards?|cvv|pix|sal[aá]rios?|clientes?|confidencia\w*|sigil\w*|internos?|internal)\b"
    r"|\.env\b",
    re.I,
)
SECRET_PATTERNS = [
    r"gh[pousr]_[A-Za-z0-9]{20,}", r"github_pat_\w{20,}", r"sk-[A-Za-z0-9_-]{16,}",
    r"AKIA[0-9A-Z]{16}", r"AIza[0-9A-Za-z_-]{30,}", r"xox[abprs]-[A-Za-z0-9-]{10,}",
    r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", r"-----BEGIN",
    r"[A-Za-z0-9+/_=-]{32,}",                      # qualquer string longa com cara de chave
    r"[\w.+-]+@[\w-]+\.[\w.-]+",                   # e-mails
    r"\b\d{1,3}(\.\d{1,3}){3}\b",                  # IPs
    r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b",    # CNPJ
    r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b",           # CPF
    r"\(?\d{2}\)?\s?9?\d{4}-?\d{4}",               # telefone
    r"https?://\S+",                               # links
]
SECRET_RE = re.compile("|".join(SECRET_PATTERNS))

KINDS = {
    "feat": "Nova funcionalidade", "fix": "Correção", "docs": "Documentação",
    "refactor": "Refatoração", "test": "Testes", "perf": "Performance",
    "style": "Ajuste visual", "chore": "Manutenção", "build": "Build",
    "ci": "Automação", "revert": "Reversão",
}


def clean_title(raw: str | None) -> tuple[str, str | None]:
    """Retorna (tipo, título seguro). Título None = descartado por segurança."""
    if not raw:
        return "Atualização", None
    line = raw.strip().splitlines()[0].strip()
    kind = "Atualização"
    m = re.match(r"^(\w+)(\([^)]*\))?!?:\s*(.+)$", line)
    if m and m.group(1).lower() in KINDS:
        kind, line = KINDS[m.group(1).lower()], m.group(3)
    line = re.sub(r"\s+", " ", line)
    if SENSITIVE_WORDS.search(line) or SECRET_RE.search(line):
        return kind, None
    line = re.sub(r"[<>`]", "", line)
    if len(line) > 110:
        line = line[:107].rstrip() + "..."
    return kind, (line[:1].upper() + line[1:]) if line else None


# ---------------------------------------------------------------- Detecção de ferramentas
MANIFEST_RE = re.compile(
    r"(^|/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|setup\.cfg|"
    r"package\.json|environment\.ya?ml)$"
)
PY_IMPORT = re.compile(r"^\+\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))")
JS_IMPORT = re.compile(r"""^\+.*?(?:from\s+|require\(\s*|import\s+)['"]([@\w./-]+)['"]""")
CPP_INCLUDE = re.compile(r"""^\+\s*#\s*include\s*[<"]([\w./-]+)[>"]""")
PKG_JSON_DEP = re.compile(r"""^\+\s*"(@?[\w.\-/]+)"\s*:\s*"[~^<>=*\d]""")
PY_DEP = re.compile(r"""^\+\s*["']?([A-Za-z0-9][A-Za-z0-9_.\-]*)""")


def prefixes(mod: str) -> list[str]:
    parts = re.split(r"[./]", mod)
    out = [mod]
    for i in range(1, len(parts)):
        sep_pos = len(".".join(parts[:i]))
        out.append(mod[:sep_pos])
    return out


def detect(files: list[dict]) -> set[str]:
    found: set[str] = set()
    for f in files:
        path = f.get("filename", "")
        if f.get("status") == "removed":
            continue
        low = path.lower()
        added = [l for l in (f.get("patch") or "").splitlines() if l.startswith("+") and not l.startswith("+++")]
        deps, mods = set(), set()
        if MANIFEST_RE.search(path):
            for l in added:
                m = (PKG_JSON_DEP if path.endswith("package.json") else PY_DEP).match(l)
                if m:
                    deps.add(re.split(r"[\[<>=~!;\s]", m.group(1))[0].lower())
        for l in added:
            for rx in (PY_IMPORT, JS_IMPORT, CPP_INCLUDE):
                m = rx.match(l)
                if m:
                    mod = next(g for g in m.groups() if g)
                    mods.update(prefixes(mod))
        for t in CATALOG:
            if any(low.endswith(e) for e in t.get("ext", [])):
                found.add(t["id"])
            elif any(re.search(p, path) for p in t.get("files", [])):
                found.add(t["id"])
            elif deps & {d.lower() for d in t.get("deps", [])}:
                found.add(t["id"])
            elif mods & set(t.get("imports", [])):
                found.add(t["id"])
    return found


# ---------------------------------------------------------------- Principal
PRIVATE_LABEL = "privado"


def load_state() -> dict:
    state = {"processed_commits": [], "processed_prs": [], "counts": {}, "recent": [], "last_run": None}
    if STATE_PATH.exists():
        state.update(json.loads(STATE_PATH.read_text(encoding="utf-8")))
    return state


def bump(state: dict, tech_ids: set[str], when: str, repo: str):
    for tid in tech_ids:
        c = state["counts"].setdefault(tid, {"count": 0, "first_seen": when, "last_seen": when, "repos": []})
        c["count"] += 1
        c["first_seen"] = min(c["first_seen"], when)
        c["last_seen"] = max(c["last_seen"], when)
        if repo not in c["repos"]:
            c["repos"].append(repo)


def plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def private_repos() -> list[dict]:
    """Repositórios privados que o token enxerga, só se o token for do próprio usuário."""
    if not PRIVATE_TOKEN:
        return []
    me = gh("/user", token=PRIVATE_TOKEN) or {}
    if (me.get("login") or "").lower() != USER.lower():
        print("GH_PRIVATE_TOKEN não pertence ao usuário configurado; ignorando repositórios privados.")
        return []
    repos: list[dict] = []
    for page in range(1, 6):
        batch = gh("/user/repos", {"visibility": "private", "affiliation": "owner,collaborator,organization_member",
                                   "sort": "pushed", "per_page": 100, "page": page}, token=PRIVATE_TOKEN) or []
        repos += batch
        if len(batch) < 100:
            break
    return [r for r in repos if r.get("private") and r["full_name"].lower() not in EXCLUDED]


def count(q: str, kind: str = "issues") -> int | None:
    res = gh(f"/search/{kind}", {"q": q, "per_page": 1}, token=PRIVATE_TOKEN or TOKEN)
    return res.get("total_count") if res else None


def stats() -> dict:
    """Contadores gerais. Com o token privado, incluem repositórios privados (só números)."""
    d30 = (NOW - dt.timedelta(days=30)).date().isoformat()
    year = f"{NOW.year}-01-01"
    repos30: set[str] = set()
    for page in (1, 2, 3):
        res = gh("/search/commits", {"q": f"author:{USER} author-date:>={d30}", "per_page": 100, "page": page},
                 token=PRIVATE_TOKEN or TOKEN) or {}
        items = res.get("items", [])
        repos30.update(i["repository"]["full_name"].lower() for i in items if i.get("repository"))
        if len(items) < 100:
            break
    repos30 -= EXCLUDED
    return {
        "commits_30d": count(f"author:{USER} author-date:>={d30}", "commits"),
        "commits_year": count(f"author:{USER} author-date:>={year}", "commits"),
        "prs_open": count(f"author:{USER} is:pr is:open"),
        "prs_merged_30d": count(f"author:{USER} is:pr is:merged merged:>={d30}"),
        "prs_merged_total": count(f"author:{USER} is:pr is:merged"),
        "repos_30d": len(repos30),
        "includes_private": bool(PRIVATE_TOKEN),
    }


def main() -> int:
    state = load_state()
    processed = set(state["processed_commits"])
    processed_prs = set(state["processed_prs"])
    last_run = iso(state.get("last_run"))
    since = (last_run - dt.timedelta(days=3)) if last_run else (NOW - dt.timedelta(days=BACKFILL_DAYS))
    budget = MAX_DETAILS
    complete = True

    repos = gh(f"/users/{USER}/repos", {"type": "owner", "per_page": 100, "sort": "pushed"}) or []
    public = [
        r for r in repos
        if not r.get("private") and r.get("visibility", "public") == "public"
        and not r.get("fork") and r["full_name"].lower() not in EXCLUDED
    ]
    public_names = {r["full_name"].lower() for r in public}
    privates = private_repos()

    for repo, is_private in [(r, False) for r in public] + [(r, True) for r in privates]:
        if iso(repo.get("pushed_at")) and iso(repo["pushed_at"]) < since:
            continue
        full = repo["full_name"]
        token = PRIVATE_TOKEN if is_private else None
        commits = gh(f"/repos/{full}/commits", {"author": USER, "since": since.isoformat(), "per_page": 100},
                     token=token) or []
        for c in reversed(commits):  # do mais antigo para o mais novo
            sha = c["sha"]
            if sha in processed:
                continue
            if len(c.get("parents", [])) > 1:  # merge commit: a PR já aparece no feed
                processed.add(sha)
                continue
            if budget <= 0:
                complete = False
                break
            detail = gh(f"/repos/{full}/commits/{sha}", token=token)
            budget -= 1
            processed.add(sha)
            if not detail:
                continue
            when = detail["commit"]["author"]["date"]
            techs = detect(detail.get("files", []))
            if is_private:
                # Só a data sai daqui. Nome do repo, mensagem, arquivos e link ficam de fora.
                bump(state, techs, when, PRIVATE_LABEL)
                state["recent"].append({
                    "type": "commit", "private": True, "repo": PRIVATE_LABEL, "kind": "Commit",
                    "title": "Commit em repositório privado",
                    "description": "Os detalhes ficam ocultos porque o repositório é privado.",
                    "techs": [], "url": None, "date": when,
                })
                continue
            bump(state, techs, when, full)
            kind, title = clean_title(detail["commit"].get("message"))
            st = detail.get("stats", {})
            nfiles = len(detail.get("files", []))
            state["recent"].append({
                "type": "commit", "repo": full, "kind": kind,
                "title": title or f"{kind} no código",
                "description": f"{kind} em {repo['name']}: {plural(nfiles, 'arquivo alterado', 'arquivos alterados')}.",
                "additions": st.get("additions", 0), "deletions": st.get("deletions", 0),
                "techs": sorted(techs), "url": detail.get("html_url"), "date": when,
            })

    # Pull requests públicas mergeadas (inclusive em projetos de terceiros)
    prs = gh("/search/issues", {"q": f"author:{USER} is:pr is:merged is:public", "sort": "updated", "per_page": 30}) or {}
    for pr in prs.get("items", []):
        full = "/".join(pr["repository_url"].split("/")[-2:])
        key = f"{full}#{pr['number']}"
        if full.lower() in EXCLUDED:
            continue
        merged_at = (pr.get("pull_request") or {}).get("merged_at") or pr.get("closed_at")
        own_repo = full.lower() in public_names
        techs: set[str] = set()
        if key not in processed_prs and budget > 0:
            files = gh(f"/repos/{full}/pulls/{pr['number']}/files", {"per_page": 100}) or []
            budget -= 1
            techs = detect(files)
            # Em repositórios próprios os commits já foram contados; em terceiros a PR conta como uso.
            if not own_repo:
                bump(state, techs, merged_at, full)
            processed_prs.add(key)
        elif key in processed_prs:
            old = next((r for r in state["recent"] if r.get("type") == "pr" and r.get("key") == key), None)
            techs = set(old["techs"]) if old else set()
        else:
            complete = False
            continue
        kind, title = clean_title(pr.get("title"))
        state["recent"] = [r for r in state["recent"] if r.get("key") != key]
        state["recent"].append({
            "type": "pr", "key": key, "repo": full, "kind": kind,
            "title": title or f"{kind} via pull request",
            "description": f"Pull request #{pr['number']} mergeada em {full}.",
            "techs": sorted(techs), "url": pr["html_url"], "date": merged_at,
        })

    # Pull requests mergeadas em repositórios privados: só a data.
    # A chave é o node_id do GitHub, que não revela o nome do repositório.
    if privates:
        prs = gh("/search/issues", {"q": f"author:{USER} is:pr is:merged is:private", "sort": "updated",
                                    "per_page": 30}, token=PRIVATE_TOKEN) or {}
        for pr in prs.get("items", []):
            full = "/".join(pr["repository_url"].split("/")[-2:])
            if full.lower() in EXCLUDED:
                continue
            key = "p:" + pr["node_id"]
            if key in processed_prs:
                continue
            processed_prs.add(key)
            state["recent"].append({
                "type": "pr", "private": True, "key": key, "repo": PRIVATE_LABEL, "kind": "Pull request",
                "title": "Pull request mergeada em repositório privado",
                "description": "Os detalhes ficam ocultos porque o repositório é privado.",
                "techs": [], "url": None,
                "date": (pr.get("pull_request") or {}).get("merged_at") or pr.get("closed_at"),
            })

    # Remove do feed repos excluídos e públicos que deixaram de ser públicos
    state["recent"] = [
        r for r in state["recent"]
        if r["repo"].lower() not in EXCLUDED
        and (r.get("private") or r["type"] == "pr" or r["repo"].lower() in public_names)
    ]
    state["recent"].sort(key=lambda r: r["date"], reverse=True)
    state["recent"] = state["recent"][:80]
    state["processed_commits"] = sorted(processed)[-10000:]
    state["processed_prs"] = sorted(processed_prs)
    if complete:
        state["last_run"] = NOW.isoformat()

    by_id = {t["id"]: t for t in CATALOG}
    skills = []
    for tid, c in state["counts"].items():
        t = by_id.get(tid)
        if not t:
            continue
        skills.append({
            "id": tid, "name": t["name"], "group": t["group"], "icon": t.get("icon"),
            "uses": c["count"], "promoted": c["count"] >= THRESHOLD,
            "first_seen": c["first_seen"], "last_seen": c["last_seen"],
        })
    skills.sort(key=lambda s: (-s["uses"], s["name"]))

    feed = [{k: v for k, v in r.items() if k != "key"} for r in state["recent"][:FEED_SIZE]]
    out = {
        "generated_at": NOW.isoformat(),
        "username": USER,
        "threshold": THRESHOLD,
        "stats": stats(),
        "feed": feed,
        "skills": skills,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"feed={len(feed)} skills={len(skills)} promovidas={sum(s['promoted'] for s in skills)} "
          f"privados={len(privates)} detalhes_usados={MAX_DETAILS - budget} completo={complete} stats={out['stats']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
