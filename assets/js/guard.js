/* Impede que o site seja exibido dentro de outra página (clickjacking).
   O GitHub Pages não deixa configurar o cabeçalho frame-ancestors, então a proteção é feita aqui. */
(function () {
  if (window.top === window.self) return;
  document.documentElement.classList.add("framed");
  try { window.top.location.replace(window.self.location.href); } catch (e) { /* o navegador bloqueou: a página fica oculta */ }
})();
