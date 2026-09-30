/* ---------- Ícones do Stack (arquivos locais em assets/icons) ---------- */
document.querySelectorAll(".ic[data-icon]").forEach(el => {
  // Endereço absoluto: dentro de uma variável CSS, url() relativo seria lido a partir da pasta do CSS
  if (/^[a-z0-9]+$/.test(el.dataset.icon)) el.style.setProperty("--i", `url("${new URL(`assets/icons/si/${el.dataset.icon}.svg`, document.baseURI).href}")`);
});

/* ---------- Ano ---------- */
document.getElementById("year").textContent = new Date().getFullYear();

/* ---------- Braço da guitarra ---------- */
(function () {
  const neck = document.getElementById("neck");
  const canvas = document.getElementById("neckCanvas");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (matchMedia("(pointer: coarse)").matches) {
    document.getElementById("neckHint").textContent = "Toque nas cordas. O som sai de um amp de metal sintetizado no navegador: Karplus-Strong, distorção e gabinete.";
  }

  // Afinação padrão vista por quem toca: Mizona (E2) em cima, Mizinha (E4) embaixo
  const tuning = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
  const gauges = [3.2, 2.6, 2.1, 1.5, 1.2, 1];
  const FRETS = 15;
  const strings = tuning.map((f, i) => ({ f, amp: 0, phase: 0, w: gauges[i], y: 0 }));
  let W = 0, H = 0, dpr = 1, frets = [];

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = neck.clientWidth; H = neck.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Espaçamento real de trastes (regra 2^(1/12)), da casa 0 à 15, esticado na largura
    const scale = W / (1 - Math.pow(2, -FRETS / 12)) * 1.0;
    frets = [];
    for (let n = 0; n <= FRETS; n++) frets.push(scale * (1 - Math.pow(2, -n / 12)));
    const pad = H * 0.12;
    strings.forEach((s, i) => { s.y = pad + (H - 2 * pad) * (i / (strings.length - 1)); });
    draw(performance.now());
  }

  function fretMid(n) { return (frets[n - 1] + frets[n]) / 2; }

  function draw(t) {
    // Espelhado: pestana à direita e casas crescendo para a esquerda,
    // como um guitarrista destro de frente para quem assiste
    ctx.setTransform(-dpr, 0, 0, dpr, W * dpr, 0);
    ctx.clearRect(0, 0, W, H);
    // trastes
    for (let n = 1; n <= FRETS; n++) {
      ctx.fillStyle = "#9aa1aa";
      ctx.fillRect(frets[n] - 1.5, 0, 3, H);
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fillRect(frets[n] - 1.5, 0, 1, H);
    }
    // pestana
    ctx.fillStyle = "#e9e2d4";
    ctx.fillRect(0, 0, 6, H);
    // marcações
    const r = Math.max(5, H * 0.045);
    [3, 5, 7, 9, 15].forEach(n => {
      if (n > FRETS) return;
      ctx.fillStyle = "#efe6d6";
      ctx.beginPath(); ctx.arc(fretMid(n), H / 2, r, 0, Math.PI * 2); ctx.fill();
    });
    const red = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || "#ff4d3d";
    ctx.fillStyle = red;
    [H * 0.3, H * 0.7].forEach(y => { ctx.beginPath(); ctx.arc(fretMid(12), y, r * 1.15, 0, Math.PI * 2); ctx.fill(); });

    // cordas
    strings.forEach((s, i) => {
      const wound = i <= 2;
      ctx.lineWidth = s.w;
      ctx.strokeStyle = s.amp > 0.3 ? "#ffffff" : (wound ? "#c9c2b4" : "#dfe2e6");
      ctx.beginPath();
      if (s.amp < 0.05) {
        ctx.moveTo(0, s.y); ctx.lineTo(W, s.y);
      } else {
        // modo fundamental: senoide presa nas duas pontas, oscilando no tempo
        const osc = Math.sin(t * 0.06 * (1 + i * 0.18) + s.phase);
        for (let x = 0; x <= W; x += 6) {
          ctx.lineTo(x, s.y + s.amp * osc * Math.sin(Math.PI * x / W));
        }
      }
      ctx.stroke();
      // sombra da corda
      ctx.strokeStyle = "rgba(0,0,0,.35)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, s.y + s.w + 1.5); ctx.lineTo(W, s.y + s.w + 1.5); ctx.stroke();
    });
  }

  let running = false;
  function loop(t) {
    let active = false;
    strings.forEach(s => { s.amp *= 0.955; if (s.amp > 0.05) active = true; else s.amp = 0; });
    draw(t);
    if (active) requestAnimationFrame(loop); else running = false;
  }
  function kick() { if (!running && !reduced) { running = true; requestAnimationFrame(loop); } }

  /* ---- Som: Karplus-Strong passando por um amp de metal ----
     corda -> ganho -> distorção (waveshaper) -> equalização com médios cavados
     -> simulação de gabinete 4x12 -> delay curto -> saída */
  let audio = null, soundOn = false;
  const soundBtn = document.getElementById("soundBtn");
  const soundLabel = document.getElementById("soundLabel");

  function distortionCurve(amount) {
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // assimétrico, como um pré de válvula saturado
      curve[i] = Math.tanh(amount * x + 0.25 * amount * x * x * (x > 0 ? 1 : 0.6)) / Math.tanh(amount);
    }
    return curve;
  }

  function buildAmp() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const input = ctx.createGain();
    const tight = ctx.createBiquadFilter(); tight.type = "highpass"; tight.frequency.value = 110;
    const drive = ctx.createGain(); drive.gain.value = 26;
    const shaper = ctx.createWaveShaper(); shaper.curve = distortionCurve(9); shaper.oversample = "4x";
    const scoop = ctx.createBiquadFilter(); scoop.type = "peaking"; scoop.frequency.value = 650; scoop.Q.value = 0.9; scoop.gain.value = -7;
    const low = ctx.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 180; low.gain.value = 5;
    const presence = ctx.createBiquadFilter(); presence.type = "peaking"; presence.frequency.value = 2600; presence.Q.value = 1.2; presence.gain.value = 5;
    const cab1 = ctx.createBiquadFilter(); cab1.type = "lowpass"; cab1.frequency.value = 5200; cab1.Q.value = 0.8;
    const cab2 = ctx.createBiquadFilter(); cab2.type = "lowpass"; cab2.frequency.value = 6500; cab2.Q.value = 0.5;
    const post = ctx.createGain(); post.gain.value = 0.16;
    // delay estilo solo: repetições discretas
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.2;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    input.connect(tight).connect(drive).connect(shaper).connect(scoop).connect(low).connect(presence).connect(cab1).connect(cab2).connect(post);
    post.connect(comp);
    post.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(comp);
    comp.connect(ctx.destination);
    ctx.amp = input;
    return ctx;
  }

  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    window.portfolioSound = soundOn;
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundLabel.textContent = soundOn ? "Som ativado" : "Ativar som";
    if (soundOn) {
      if (!audio) audio = buildAmp();
      if (!audio) return;
      window.portfolioAudio = audio;
      audio.resume();
      // power chord de Mi na abertura: E2 + B2 + E3
      pluck(0, 0, 0.9); pluck(1, 2, 0.9); pluck(2, 2, 0.9);
    }
  });

  function pluck(stringIdx, fret, vel) {
    if (!soundOn || !audio) return;
    const freq = tuning[stringIdx] * Math.pow(2, fret / 12);
    const sr = audio.sampleRate;
    const N = Math.max(2, Math.round(sr / freq));
    const len = Math.floor(sr * 2.6);
    const buf = audio.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const ring = new Float32Array(N);
    // ataque de palheta: ruído levemente filtrado
    let lp = 0;
    for (let i = 0; i < N; i++) { lp = lp * 0.35 + (Math.random() * 2 - 1) * 0.65; ring[i] = lp * vel; }
    const decay = 0.9985 - (5 - stringIdx) * 0.0003;
    let p = 0;
    for (let i = 0; i < len; i++) {
      const next = (p + 1) % N;
      const v = ring[p];
      out[i] = v;
      ring[p] = decay * 0.5 * (v + ring[next]);
      p = next;
    }
    // fade no fim para não estalar
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.amp);
    src.start();
  }

  function fretAt(x) {
    for (let n = 1; n <= FRETS; n++) if (x < frets[n]) return n;
    return FRETS;
  }

  function hit(i, x, strength) {
    const s = strings[i];
    s.amp = Math.min(H * 0.06, s.amp + H * 0.05 * strength);
    s.phase = Math.random() * 6.28;
    pluck(i, fretAt(W - x), 0.5 + 0.5 * strength);  // desenho espelhado
    if (reduced) draw(performance.now()); else kick();
  }

  // Detecta quando o ponteiro cruza uma corda
  let lastY = null, lastT = 0;
  function onMove(clientX, clientY) {
    const rect = neck.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const now = performance.now();
    if (lastY !== null) {
      const lo = Math.min(lastY, y), hi = Math.max(lastY, y);
      const speed = Math.min(1, Math.abs(y - lastY) / Math.max(1, now - lastT) / 1.5);
      strings.forEach((s, i) => {
        if (s.y > lo && s.y <= hi) hit(i, x, 0.35 + 0.65 * speed);
      });
    }
    lastY = y; lastT = now;
  }
  neck.addEventListener("pointermove", e => onMove(e.clientX, e.clientY));
  neck.addEventListener("pointerleave", () => { lastY = null; });
  neck.addEventListener("pointerdown", e => {
    const rect = neck.getBoundingClientRect();
    const y = e.clientY - rect.top, x = e.clientX - rect.left;
    let best = 0, d = Infinity;
    strings.forEach((s, i) => { const dd = Math.abs(s.y - y); if (dd < d) { d = dd; best = i; } });
    hit(best, x, 0.9);
  });

  // Palhetada inicial da Mizona até a Mizinha, só visual
  window.addEventListener("resize", layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  layout();
  if (!reduced) {
    strings.forEach((s, k) => setTimeout(() => {
      s.amp = H * 0.045; s.phase = Math.random() * 6.28; kick();
    }, 500 + k * 70));
  }
})();

/* ---------- Atividade do GitHub ao vivo, MAW, empresa, contadores e competências ----------
   Duas fontes:
   1. activity.json, gerado pelo GitHub Action e publicado na branch activity-data:
      feed (públicos com nome, privados só com a data), contadores, empresa, MAW e competências.
   2. A API pública de eventos do GitHub, consultada daqui, para pushes e PRs públicos
      aparecerem quase na hora. */
(function () {
  const USER = "WaynerMoraes12";
  const RAW = `https://raw.githubusercontent.com/${USER}/${USER}.github.io/activity-data/activity.json`;
  const EVENTS = `https://api.github.com/users/${USER}/events/public?per_page=40`;
  const MAX_GROUPS = 8;
  const $ = id => document.getElementById(id);
  const list = $("liveList"), meta = $("liveMeta"), statsBox = $("ghStats");
  const ICONS = new URL("assets/icons/si/", document.baseURI).href;
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const nf = new Intl.NumberFormat("pt-BR");

  let base = null, liveItems = [], excluded = new Set(), lastFresh = 0, eventsEtag = null;

  function ago(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    const steps = [[60, "second"], [3600, "minute"], [86400, "hour"], [2592000, "day"], [31536000, "month"], [Infinity, "year"]];
    let prev = 1;
    for (const [lim, unit] of steps) {
      if (Math.abs(s) < lim) return rtf.format(Math.round(s / prev), unit);
      prev = lim;
    }
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;

  /* ---- eventos públicos: chegam segundos ou poucos minutos depois do push ---- */
  async function loadEvents() {
    try {
      const r = await fetch(EVENTS, { headers: eventsEtag ? { "If-None-Match": eventsEtag } : {} });
      if (r.status === 304) { lastFresh = Date.now(); return false; }
      if (!r.ok) return false;
      eventsEtag = r.headers.get("ETag");
      const items = [];
      for (const ev of await r.json()) {
        const repoFull = ev.repo && ev.repo.name;
        if (!repoFull || excluded.has(repoFull.toLowerCase())) continue;
        const repo = repoFull.split("/")[1];
        const p = ev.payload || {};
        if (ev.type === "PushEvent" && p.head) {
          items.push({ type: "commit", push: true, repo, repoFull, sha: p.head,
            url: `https://github.com/${repoFull}/commit/${p.head}`, date: ev.created_at, techs: [] });
        } else if (ev.type === "PullRequestEvent") {
          const pr = p.pull_request || {};
          const number = p.number || pr.number;
          const merged = p.action === "merged" || (p.action === "closed" && pr.merged);
          if (!number || (!merged && p.action !== "opened")) continue;
          items.push({ type: "pr", state: merged ? "merged" : "open", number, repo, repoFull,
            url: pr.html_url || `https://github.com/${repoFull}/pull/${number}`,
            date: (merged && pr.merged_at) || ev.created_at, techs: [] });
        }
      }
      // o push que é só o merge de uma PR já aparece como "PR mergeada"
      const merges = items.filter(i => i.type === "pr" && i.state === "merged").map(i => [i.repoFull, new Date(i.date).getTime()]);
      liveItems = items.filter(i => !(i.push && merges.some(([r, t]) => r === i.repoFull && Math.abs(new Date(i.date) - t) < 90 * 1000)));
      lastFresh = Date.now();
      return true;
    } catch (e) { return false; }
  }

  /* ---- junta as duas fontes, sem repetir, e agrupa: "3 commits em clerk-estudo" ---- */
  const shaOf = it => it.sha || ((it.url || "").match(/\/commit\/([0-9a-f]{7,40})/) || [])[1] || null;
  const repoFullOf = it => it.repoFull || ((it.url || "").match(/github\.com\/([^/]+\/[^/]+)\//) || [])[1] || null;
  const dayOf = d => new Date(d).toLocaleDateString("pt-BR");

  function pool() {
    const items = [...((base && base.feed) || []), ...liveItems];
    const seenSha = new Set(), bestPr = new Map();
    for (const it of items) {
      if (it.type === "pr" && it.url) {
        const k = it.url.replace(/#.*$/, ""), cur = bestPr.get(k);
        if (!cur || (cur.state !== "merged" && it.state === "merged")) bestPr.set(k, it);  // mergeada esconde a "aberta"
      }
    }
    return items.filter(it => {
      if (it.type === "pr" && it.url) return bestPr.get(it.url.replace(/#.*$/, "")) === it;
      const s = it.type === "commit" && shaOf(it);
      if (s) { const k = s.slice(0, 12); if (seenSha.has(k)) return false; seenSha.add(k); }
      return true;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function groups() {
    const out = [];
    for (const it of pool()) {
      const prev = out[out.length - 1];
      const same = prev && prev.type === it.type && (prev.state || "") === (it.state || "") &&
        prev.repo === it.repo && !!prev.private === !!it.private && dayOf(prev.date) === dayOf(it.date) &&
        (it.type === "commit" || !it.repo);  // PR com nome fica sozinha: cada uma tem número
      if (same) {
        prev.count++;
        if (it.push) prev.pushes++; else prev.commits++;
        (it.techs || []).forEach(t => prev.techs.add(t));
        continue;
      }
      out.push({ ...it, count: 1, commits: it.push ? 0 : 1, pushes: it.push ? 1 : 0, techs: new Set(it.techs || []) });
      if (out.length > MAX_GROUPS) break;
    }
    return out.slice(0, MAX_GROUPS);
  }

  function titleOf(g) {
    const where = g.repo || (g.count > 1 ? "repositórios privados" : "repositório privado");
    if (g.type === "commit") {
      if (!g.commits) return g.pushes > 1 ? `${g.pushes} pushes em ${where}` : `Novo push em ${where}`;
      return `${plural(g.commits, "commit", "commits")} em ${where}`;
    }
    const verb = g.state === "open" ? (g.count > 1 ? "abertas" : "aberta") : (g.count > 1 ? "mergeadas" : "mergeada");
    if (g.repo && g.number) return `PR #${g.number} ${verb} em ${g.repo}`;
    return g.count > 1 ? `${g.count} PRs ${verb} em ${where}` : `PR ${verb} em ${where}`;
  }
  function typeOf(g) {
    const t = g.type === "commit" ? (g.count > 1 ? "Commits" : "Commit") : g.state === "open" ? "PR aberta" : "PR mergeada";
    return g.private ? (g.type === "commit" ? `${t} ${g.count > 1 ? "privados" : "privado"}` : "PR privada") : t;
  }
  function linkOf(g) {
    if (g.private) return null;
    if (g.type === "pr") return g.url;
    if (g.count === 1 && g.url) return g.url;
    const full = repoFullOf(g);
    return full ? `https://github.com/${full}/commits` : null;
  }

  function renderFeed(names) {
    const gs = groups();
    list.replaceChildren();
    if (!gs.length) { meta.textContent = "Nenhuma atividade recente."; return; }
    for (const g of gs) {
      const li = el("li"), url = linkOf(g);
      const safe = /^https:\/\/github\.com\//.test(url || "") ? url : null;
      const row = el(safe ? "a" : "div", "lv-row" + (g.private ? " private" : ""));
      if (safe) { row.href = safe; row.target = "_blank"; row.rel = "noopener noreferrer"; }
      row.append(el("span", "lv-type" + (g.type === "pr" ? " pr" : "") + (g.private ? " priv" : ""), typeOf(g)));
      const body = el("span");
      body.append(el("span", "lv-title", titleOf(g)));
      if (g.techs.size) {
        const tags = el("span", "lv-tags");
        [...g.techs].slice(0, 5).forEach(t => tags.append(el("span", null, names[t] || t)));
        body.append(tags);
      }
      row.append(body, el("span", "lv-when", ago(g.date)));
      li.append(row);
      list.append(li);
    }
  }

  function renderMeta() {
    const fresh = Math.max(lastFresh, base ? new Date(base.generated_at).getTime() : 0);
    meta.textContent = fresh ? "Atualizado " + ago(new Date(fresh).toISOString()) : "Carregando a atividade mais recente...";
  }

  function stat(parent, value, label, cls) {
    const d = el("div", cls);
    d.append(el("b", null, typeof value === "number" ? nf.format(value) : value), el("span", null, label));
    parent.append(d);
  }

  function renderStats() {
    const s = base && base.stats;
    if (!s) return;
    statsBox.replaceChildren();
    [[s.commits_30d, "commits nos últimos 30 dias"], [s.commits_year, `commits em ${new Date().getFullYear()}`],
     [s.prs_open, "pull requests abertas agora"], [s.prs_merged_30d, "PRs mergeadas em 30 dias"],
     [s.repos_30d, "repositórios ativos em 30 dias"]]
      .filter(([v]) => typeof v === "number").forEach(([v, l]) => stat(statsBox, v, l, "gh-stat"));
    statsBox.hidden = !statsBox.children.length;
    $("ghStatsNote").textContent = s.includes_private
      ? "Os números somam repositórios públicos e privados. Dos privados aparece só a contagem e a data, nunca o nome ou o conteúdo."
      : "Por enquanto os números contam só os repositórios públicos.";
  }

  /* ---- Agora: atividade na empresa, só números ---- */
  function renderCompany() {
    const c = base && base.company, box = $("companyLive");
    if (!box || !c) return;
    box.replaceChildren();
    const t = el("span", "cl-title");
    t.append(el("span", "live-dot"), document.createTextNode(`Ao vivo na ${c.name}`));
    box.append(t);
    const item = (value, label) => { const s = el("span", "cl-item"); s.append(el("b", null, value), document.createTextNode(" " + label)); box.append(s); };
    if (c.last_commit) item(ago(c.last_commit), "foi o último commit");
    if (typeof c.commits_30d === "number") item(nf.format(c.commits_30d), "commits em 30 dias");
    if (typeof c.prs_merged_30d === "number") item(nf.format(c.prs_merged_30d), "PRs mergeadas em 30 dias");
    if (typeof c.prs_open === "number") item(nf.format(c.prs_open), c.prs_open === 1 ? "PR aberta agora" : "PRs abertas agora");
    box.hidden = false;
  }

  /* ---- MAW: resumo do TCC, números e últimas entregas, tudo vindo do repositório ---- */
  let mawOpen = false;
  function paragraphs(text) {
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/);
    const target = Math.max(1, Math.round(text.length / 700)), per = Math.ceil(sentences.length / target), out = [];
    for (let i = 0; i < sentences.length; i += per) out.push(sentences.slice(i, i + per).join(" "));
    return out;
  }
  function renderMaw() {
    const m = base && base.showcase;
    if (!m || !$("maw")) return;
    if (m.pushed_at) $("mawUpdated").textContent = "atualizada " + ago(m.pushed_at);
    const st = $("mawStats");
    st.replaceChildren();
    if (typeof m.merged_prs === "number") stat(st, m.merged_prs, "PRs mergeadas", "maw-stat");
    if (typeof m.commits === "number") stat(st, m.commits, "commits", "maw-stat");
    if (m.created_at) stat(st, Math.max(1, Math.round((Date.now() - new Date(m.created_at)) / 86400000)), "dias de desenvolvimento", "maw-stat");
    (m.highlights || []).forEach(h => stat(st, h.value, h.label, "maw-stat hl"));
    st.hidden = !st.children.length;

    if (m.summary) {
      const box = $("mawSummary"), ps = paragraphs(m.summary);
      box.replaceChildren();
      ps.forEach((p, i) => { const e = el("p", i >= 2 ? "more" : null, p); if (i >= 2) e.hidden = !mawOpen; box.append(e); });
      if (ps.length > 2) {
        const b = el("button", "maw-more", mawOpen ? "Mostrar menos" : "Continuar lendo");
        b.type = "button"; b.setAttribute("aria-expanded", String(mawOpen));
        b.addEventListener("click", () => { mawOpen = !mawOpen; renderMaw(); });
        box.append(b);
      }
      $("mawNote").textContent = "Texto do resumo do meu TCC, lido direto do repositório da MAW" +
        (m.summary_updated_at ? `. Última revisão ${ago(m.summary_updated_at)}.` : ".");
      const tags = $("mawTags");
      tags.replaceChildren();
      (m.keywords || []).forEach(k => tags.append(el("span", null, k)));
    }
    if (m.recent && m.recent.length) {
      const ol = $("mawRecent");
      ol.replaceChildren();
      m.recent.forEach(r => {
        const li = el("li");
        if (r.scope) li.append(el("span", "scope", r.scope));
        li.append(el("span", "t", r.title), el("time", null, ago(r.date)));
        li.lastChild.dateTime = r.date;
        ol.append(li);
      });
      $("mawRecentBox").hidden = false;
    }
  }

  // Ícones neutros para ferramentas sem logo em nenhum repositório de ícones
  const GLYPHS = {
    code: "<path d='M8 6 2 12l6 6M16 6l6 6-6 6' fill='none' stroke='#000' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/>",
    db: "<ellipse cx='12' cy='5.5' rx='8' ry='3' fill='none' stroke='#000' stroke-width='2.2'/><path d='M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' fill='none' stroke='#000' stroke-width='2.2'/>",
    audio: "<path d='M3 10v4M7 6v12M11 3v18M15 7v10M19 10v4' stroke='#000' stroke-width='2.4' stroke-linecap='round'/>",
    doc: "<path d='M6 2h8l5 5v15H6z' fill='none' stroke='#000' stroke-width='2.2' stroke-linejoin='round'/><path d='M14 2v5h5M9 13h7M9 17h7' fill='none' stroke='#000' stroke-width='2'/>",
  };
  const glyphUrl = g => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${GLYPHS[g] || GLYPHS.code}</svg>`)}")`;

  // Ferramenta detectada nos commits e PRs entra no Stack quando passa do limite (hoje, mais de 10 usos).
  // A contagem continua sendo registrada no activity.json; na tela só aparece quem passou.
  function renderSkills(d) {
    const manual = new Set();
    document.querySelectorAll("[data-skill]:not(.auto)").forEach(li => li.dataset.skill.split(" ").forEach(id => manual.add(id)));
    const columns = {};
    document.querySelectorAll(".stack > div").forEach(col => { columns[col.querySelector("h3").textContent.trim()] = col.querySelector("ul"); });
    document.querySelectorAll(".stack li.auto").forEach(li => li.remove());
    for (const sk of d.skills) {
      if (manual.has(sk.id) || !sk.promoted) continue;
      const ul = columns[sk.group];
      if (!ul) continue;
      const li = el("li", "auto");
      li.dataset.skill = sk.id;
      const ic = el("span", "ic");
      ic.setAttribute("aria-hidden", "true");
      const url = /^[a-z0-9]+$/.test(sk.icon || "") ? `url("${ICONS}${sk.icon}.svg")`
        : /^assets\/icons\/dev\/[a-z0-9]+\.svg$/.test(sk.icon_url || "") ? `url("${new URL(sk.icon_url, document.baseURI).href}")` : glyphUrl(sk.glyph);
      ic.style.setProperty("--i", url);
      li.append(ic, document.createTextNode(sk.name));
      ul.append(li);
    }
  }

  function render() {
    const names = base ? Object.fromEntries(base.skills.map(s => [s.id, s.name])) : {};
    renderFeed(names);
    renderMeta();
    renderCompany();
  }

  async function loadBase() {
    for (const url of [RAW + "?t=" + Date.now()]) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const d = await r.json();
        if (base && new Date(d.generated_at) < new Date(base.generated_at)) return;  // nunca volta para dados mais velhos
        base = d;
        renderStats();
        renderSkills(d);
        renderMaw();
        return;
      } catch (e) { /* tenta a próxima fonte */ }
    }
  }

  async function start() {
    try {
      const cfg = await (await fetch("data/github-config.json", { cache: "no-store" })).json();
      excluded = new Set((cfg.excluded_repos || []).map(r => r.toLowerCase()));
    } catch (e) { /* sem config, sem exclusões extras */ }
    await Promise.all([loadBase(), loadEvents()]);
    if (!base && !liveItems.length) {
      meta.textContent = "Não consegui carregar a atividade agora.";
      const li = el("li"), a = el("a", "lv-row");
      a.href = `https://github.com/${USER}`; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.append(el("span", "lv-type", "GitHub"), el("span", "lv-title", "Ver a atividade direto no meu perfil"));
      li.append(a); list.replaceChildren(li);
      return;
    }
    render();
  }

  start();
  // Ao vivo: dados do Action a cada 45 s, eventos públicos a cada 60 s, horários a cada 20 s
  setInterval(async () => { if (!document.hidden) { await loadBase(); render(); } }, 45 * 1000);
  setInterval(async () => { if (!document.hidden && await loadEvents()) render(); }, 60 * 1000);
  setInterval(() => { if (!document.hidden) { render(); renderMaw(); } }, 20 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadBase().then(render); loadEvents().then(render); } });
})();

/* ---------- Sites que desenvolvi (data/sites.json) ---------- */
(function () {
  const grid = document.getElementById("sitesGrid");
  if (!grid) return;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  fetch("data/sites.json", { cache: "no-store" }).then(r => r.json()).then(d => {
    const sites = (d.sites || []).filter(s => s && s.nome && /^https:\/\//.test(s.url || ""));
    if (!sites.length) return;  // mantém o espaço reservado
    grid.replaceChildren();
    sites.forEach(s => {
      const a = el("a", "site-card");
      a.href = s.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      if (s.imagem && /^assets\/[\w./-]+$/.test(s.imagem)) {
        const img = el("img"); img.src = s.imagem; img.alt = `Página inicial de ${s.nome}`; img.loading = "lazy";
        a.append(img);
      }
      const body = el("div", "site-body");
      body.append(el("h3", null, s.nome), el("span", "site-domain", new URL(s.url).hostname.replace(/^www\./, "")));
      if (s.descricao) body.append(el("p", null, s.descricao));
      if (Array.isArray(s.tecnologias) && s.tecnologias.length) {
        const tags = el("div", "site-tags");
        s.tecnologias.slice(0, 6).forEach(t => tags.append(el("span", null, t)));
        body.append(tags);
      }
      body.append(el("span", "site-open", "Abrir site"));
      a.append(body);
      grid.append(a);
    });
  }).catch(() => { /* sem arquivo: fica o espaço reservado */ });
})();

/* ---------- Tênis de mesa ---------- */
(function () {
  const cv = document.getElementById("pongCanvas");
  const ctx = cv.getContext("2d");
  const msg = document.getElementById("pongMsg");
  const msgText = document.getElementById("pongMsgText");
  const elYou = document.getElementById("scoreYou");
  const elCpu = document.getElementById("scoreCpu");

  // Mundo em centímetros: mesa oficial de 274 x 152,5
  const TW = 274, TH = 152.5, NET = TW / 2;
  const PX = -16, CX = TW + 16;      // posição das raquetes, atrás de cada fundo
  const REACH = 17;                   // meia-altura da área de rebatida
  let W = 0, H = 0, sc = 1, ox = 0, oy = 0;
  const you = { y: TH / 2, target: TH / 2, v: 0 };
  const cpu = { y: TH / 2, v: 0, err: 0 };
  const ball = { x: 0, y: 0, vx: 0, vy: 0 };
  let score = [0, 0], server = 0, servesLeft = 2, state = "idle", visible = false, last = 0, raf = 0;

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc = Math.min((W * 0.8) / TW, (H * 0.78) / TH);
    ox = (W - TW * sc) / 2; oy = (H - TH * sc) / 2;
    draw();
  }
  const X = x => ox + x * sc, Y = y => oy + y * sc;

  function blip(freq) {
    const a = window.portfolioAudio;
    if (!window.portfolioSound || !a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = freq; o.type = "triangle";
    g.gain.setValueAtTime(0.12, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.06);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.07);
  }

  function paddle(x, y, side, red) {
    const r = 8.5 * sc;
    ctx.save();
    ctx.translate(X(x), Y(y));
    // cabo
    ctx.fillStyle = "#c89a62";
    ctx.fillRect(side < 0 ? -r - 9 * sc : r - 1, -2.2 * sc, 10 * sc, 4.4 * sc);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(side < 0 ? -r - 9 * sc : r - 1, 0.6 * sc, 10 * sc, 1.6 * sc);
    // lâmina
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.92, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = red ? "#d81f2f" : "#1c1c22"; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 1.2 * sc); ctx.strokeStyle = red ? "#8e0f1b" : "#5b5b66"; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.12)";
    ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.35, r * 0.22, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // piso
    ctx.fillStyle = "#0b1424"; ctx.fillRect(0, 0, W, H);
    // sombra e mesa
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(X(0) + 6, Y(0) + 10, TW * sc, TH * sc);
    ctx.fillStyle = "#1f4f8f"; ctx.fillRect(X(0), Y(0), TW * sc, TH * sc);
    const line = Math.max(1.5, 2 * sc);
    ctx.strokeStyle = "#f4f6fa"; ctx.lineWidth = line;
    ctx.strokeRect(X(0) + line / 2, Y(0) + line / 2, TW * sc - line, TH * sc - line);
    ctx.lineWidth = Math.max(1, 0.6 * sc);
    ctx.beginPath(); ctx.moveTo(X(0), Y(TH / 2)); ctx.lineTo(X(TW), Y(TH / 2)); ctx.stroke();
    // rede
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(X(NET) + 3, Y(-8), 3, (TH + 16) * sc);
    ctx.fillStyle = "#e9ecf2"; ctx.fillRect(X(NET) - 1.5, Y(-8), 3, (TH + 16) * sc);
    ctx.fillStyle = "#2a2a33"; ctx.fillRect(X(NET) - 3, Y(-10), 6, 5); ctx.fillRect(X(NET) - 3, Y(TH + 8) - 3, 6, 5);
    // bola: altura visual quica uma vez em cada lado da mesa
    if (state === "rally" || state === "serve") {
      const z = Math.abs(Math.sin(((ball.x + 34) / NET) * Math.PI)) * 14;
      const br = 2 * sc * (1 + z / 30);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath(); ctx.ellipse(X(ball.x) + z * sc * 0.5, Y(ball.y) + z * sc * 0.7, 2 * sc, 1.4 * sc, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fbf7ee";
      ctx.beginPath(); ctx.arc(X(ball.x), Y(ball.y), Math.max(3, br), 0, Math.PI * 2); ctx.fill();
    }
    paddle(PX, you.y, -1, true);
    paddle(CX, cpu.y, 1, false);
  }

  function setMsg(t) { if (t) { msgText.textContent = t; msg.hidden = false; } else msg.hidden = true; }

  function readyServe() {
    state = "serve";
    ball.x = server === 0 ? PX + 6 : CX - 6;
    ball.vx = ball.vy = 0;
    if (server === 0) setMsg("Seu saque: clique na mesa ou aperte espaço");
    else { setMsg(null); setTimeout(() => { if (state === "serve" && server === 1) launch(); }, 900); }
  }

  function launch() {
    const dir = server === 0 ? 1 : -1;
    ball.vx = dir * 150;
    ball.vy = (Math.random() - 0.5) * 90;
    state = "rally";
    setMsg(null);
    blip(1500);
  }

  function point(winner) {
    score[winner]++;
    elYou.textContent = score[0]; elCpu.textContent = score[1];
    const [a, b] = score;
    if ((a >= 11 || b >= 11) && Math.abs(a - b) >= 2) {
      state = "over";
      setMsg(a > b ? `Você venceu por ${a} a ${b}! Clique para jogar de novo` : `A CPU venceu por ${b} a ${a}. Clique para a revanche`);
      return;
    }
    // troca de saque a cada 2 pontos, e a cada ponto no 10 a 10
    servesLeft--;
    if (servesLeft <= 0 || (a >= 10 && b >= 10)) { server = 1 - server; servesLeft = 2; }
    readyServe();
  }

  function step(dt) {
    // sua raquete segue o alvo
    const prev = you.y;
    you.y += (you.target - you.y) * Math.min(1, dt * 18);
    you.v = (you.y - prev) / Math.max(dt, 0.001);
    // CPU: acompanha com velocidade limitada e um erro que muda a cada rebatida
    const aim = ball.vx > 0 ? ball.y + cpu.err : TH / 2;
    const maxV = 150;
    cpu.y += Math.max(-maxV * dt, Math.min(maxV * dt, aim - cpu.y));
    if (state === "serve") { ball.y = server === 0 ? you.y : cpu.y; return; }
    if (state !== "rally") return;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    if (ball.y < 2 && ball.vy < 0) { ball.y = 2; ball.vy *= -1; }
    if (ball.y > TH - 2 && ball.vy > 0) { ball.y = TH - 2; ball.vy *= -1; }
    if (ball.vx < 0 && ball.x <= PX + 4 && ball.x > PX - 6) {
      if (Math.abs(ball.y - you.y) < REACH) {
        ball.x = PX + 4;
        ball.vx = Math.min(380, -ball.vx * 1.05);
        ball.vy = (ball.y - you.y) * 5 + you.v * 0.25;
        cpu.err = (Math.random() - 0.5) * 34;
        blip(1300);
      }
    } else if (ball.vx > 0 && ball.x >= CX - 4 && ball.x < CX + 6) {
      if (Math.abs(ball.y - cpu.y) < REACH) {
        ball.x = CX - 4;
        ball.vx = Math.max(-380, -ball.vx * 1.04);
        ball.vy = (ball.y - cpu.y) * 5 + (Math.random() - 0.5) * 40;
        blip(1100);
      }
    }
    if (ball.x < PX - 40) point(1);
    else if (ball.x > CX + 40) point(0);
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    step(dt);
    draw();
    if (visible && state !== "idle" && state !== "over") raf = requestAnimationFrame(frame);
    else raf = 0;
  }
  function run() { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function start() {
    if (state === "idle" || state === "over") {
      score = [0, 0]; elYou.textContent = elCpu.textContent = "0";
      server = 0; servesLeft = 2; readyServe(); run();
    } else if (state === "serve" && server === 0) { launch(); run(); }
  }

  function toWorldY(clientY) {
    const r = cv.getBoundingClientRect();
    return Math.max(0, Math.min(TH, ((clientY - r.top) - oy) / sc));
  }
  cv.addEventListener("pointermove", e => {
    you.target = toWorldY(e.clientY);
    if (!raf) { you.y = you.target; draw(); }  // fora do rali a raquete acompanha mesmo parada
  });
  cv.addEventListener("pointerdown", e => { you.target = toWorldY(e.clientY); cv.focus({ preventScroll: true }); start(); });
  cv.addEventListener("keydown", e => {
    if (e.key === "ArrowUp" || e.key === "w") { you.target = Math.max(0, you.target - 14); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "s") { you.target = Math.min(TH, you.target + 14); e.preventDefault(); }
    else if (e.key === " " || e.key === "Enter") { start(); e.preventDefault(); }
  });

  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) run(); }, { threshold: 0.2 }).observe(cv);
  window.addEventListener("resize", layout);
  layout();
})();
/* ---------- Rosa costurando ----------
   Uma rosa de verdade (foto) deitada na página. O próprio caule é a linha e a agulha:
   entra e sai do fundo em poucos pontos e a ponta fura o tecido no fim. */
(function () {
  const seam = document.getElementById("seam");
  const svg = document.getElementById("seamSvg");
  if (!seam || !svg) return;
  const H = 190, Y = 100;
  const seamPolicy = window.trustedTypes && window.trustedTypes.createPolicy
    ? window.trustedTypes.createPolicy("seam", { createHTML: html => html })
    : null;
  const TEX_W = 72.5, TEX_H = 16;            // textura real do caule (assets/caule.webp, em 2x)
  const BUD_W = 210, BUD_H = 186, BUD_STEM_Y = 87.4;

  const hole = x => `<ellipse cx="${x}" cy="${Y + 1.5}" rx="10" ry="4.2" fill="url(#holeG)"/>`;

  // trecho reto do caule, preenchido com a textura da foto
  function straight(x1, x2, mask) {
    return `<rect x="${x1}" y="0" width="${x2 - x1}" height="${TEX_H}" fill="url(#stemTex)" mask="url(#${mask})" transform="translate(0 ${Y - TEX_H / 2})"/>`;
  }
  // trecho curvo: fatias finas da mesma textura seguindo a curva, afinando até virar agulha
  function needle(x1, x2) {
    const n = 44, c1x = x1 + 18, c2x = x2 - 70, cy = Y - 34;
    const pt = t => {
      const u = 1 - t;
      return [u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2,
              u * u * u * Y + 3 * u * u * t * cy + 3 * u * t * t * cy + t * t * t * Y];
    };
    let out = "", L = 0, prev = pt(0);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, p0 = prev, p1 = pt(t1);
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
      const tm = (t0 + t1) / 2;
      const k = tm < .5 ? 1 : Math.max(.08, Math.pow(1 - (tm - .5) / .5, 1.15));  // afina
      const op = Math.min(1, Math.pow(tm / .14, 1.4));                              // sai do furo aos poucos
      out += `<rect x="${L.toFixed(2)}" y="0" width="${(len + .9).toFixed(2)}" height="${TEX_H}" fill="url(#stemTex)" opacity="${op.toFixed(2)}"
        transform="translate(${p0[0].toFixed(2)} ${p0[1].toFixed(2)}) rotate(${ang.toFixed(2)}) scale(1 ${k.toFixed(3)}) translate(${(-L).toFixed(2)} ${-TEX_H / 2})"/>`;
      L += len; prev = p1;
    }
    return out;
  }
  // espinho pequeno, discreto, nas cores de um espinho de rosa
  function thorn(x, y, flip, s) {
    return `<path d="M-4 0C-3 -3 .5 -6.5 5.5 -8C3.5 -5 3 -2.5 3.5 0Z" fill="url(#thornG)" transform="translate(${x} ${y}) scale(${s} ${flip ? -s : s})"/>`;
  }

  function build() {
    const W = seam.clientWidth;
    if (!W) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const small = W < 600;
    const budW = small ? 150 : BUD_W, k = budW / BUD_W;
    const budH = BUD_H * k, stemY = BUD_STEM_Y * k;
    const G = 34, F = small ? 120 : 190, L0 = small ? 70 : 130;
    const start = budW - 4;
    const avail = W - 12 - start - L0 - F;
    const stitches = avail > 3 * G + 2 * 90 ? 2 : avail > 2 * G + 70 ? 1 : 0;
    const V = stitches ? (avail - (stitches + 1) * G) / stitches : 0;

    let holes = "", stem = "", thorns = "";
    let x = start;
    stem += straight(x, x + L0, "fadeRight");
    thorns += thorn(x + L0 * .55, Y - 6, false, 1.25);
    x += L0; holes += hole(x);
    for (let i = 0; i < stitches; i++) {
      x += G; holes += hole(x);
      stem += straight(x, x + V, "fadeBoth");
      thorns += thorn(x + V * (i % 2 ? .35 : .6), i % 2 ? Y + 6 : Y - 6, i % 2 === 1, 1.15);
      x += V; holes += hole(x);
    }
    x += stitches ? G : G;
    holes += hole(x) + hole(W - 12);
    stem += needle(x, W - 12);

    const markup = `
      <defs>
        <pattern id="stemTex" patternUnits="userSpaceOnUse" width="${TEX_W}" height="${TEX_H}">
          <image href="assets/caule.webp" width="${TEX_W}" height="${TEX_H}" preserveAspectRatio="none"/>
        </pattern>
        <linearGradient id="fadeBothG"><stop offset="0" stop-color="#000"/><stop offset=".07" stop-color="#fff"/><stop offset=".93" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
        <linearGradient id="fadeRightG"><stop offset="0" stop-color="#fff"/><stop offset=".93" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
        <mask id="fadeBoth" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fadeBothG)"/></mask>
        <mask id="fadeRight" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fadeRightG)"/></mask>
        <linearGradient id="thornG" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8ea13d"/><stop offset=".5" stop-color="#8a5a34"/><stop offset="1" stop-color="#d9b48c"/></linearGradient>
        <radialGradient id="holeG"><stop offset="0" stop-color="#000" stop-opacity=".9"/><stop offset=".6" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      </defs>
      <g>${holes}</g>
      <g class="seam-stem">${stem}${thorns}</g>
      <image href="assets/rosa-botao.webp" x="0" y="${(Y - stemY).toFixed(1)}" width="${budW}" height="${budH.toFixed(1)}" class="seam-bud"/>`;
    // Único innerHTML do site. O texto é montado só com números calculados aqui, e passa
    // pela política "seam" do Trusted Types (a CSP recusa innerHTML sem ela).
    svg.innerHTML = seamPolicy ? seamPolicy.createHTML(markup) : markup;
  }

  build();
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 150); });

  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  seam.classList.add("armed");
  new IntersectionObserver((entries, obs) => {
    if (entries[0].isIntersecting) {
      seam.classList.add("sew");
      obs.disconnect();
    }
  }, { threshold: 0.6 }).observe(seam);
})();
