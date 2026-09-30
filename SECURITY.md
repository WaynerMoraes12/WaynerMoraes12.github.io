# Segurança

## Como reportar um problema

Achou uma falha de segurança neste site? Use o botão **Report a vulnerability** na aba
[Security](https://github.com/WaynerMoraes12/WaynerMoraes12.github.io/security) deste repositório
ou escreva para **waynerbusiness@outlook.com**. Por favor, não abra uma issue pública.

## Como o site é protegido

- **Sem código de terceiros.** Fontes, ícones, CSS e JavaScript são servidos pelo próprio site.
  As únicas conexões externas são a API pública do GitHub e o `raw.githubusercontent.com`,
  para ler os dados de atividade.
- **Content Security Policy estrita** (`default-src 'none'`), sem `unsafe-inline`, sem
  `eval` e com **Trusted Types**: o navegador recusa injeção de HTML fora da única política
  do site.
- **Todo dado dinâmico entra como texto** (`textContent`), e links e ícones são validados
  antes de usar.
- **Proteção contra iframe (clickjacking)**, `rel="noopener noreferrer"` em links externos e
  política de referrer restrita.
- **Nenhum token guardado no GitHub.** Os dados de atividade são gerados no PC do dono pelo
  `scripts/watch_github.py`, com o login local do GitHub CLI.
- **Repositórios privados:** deles só se publica contagem e data. O gerador tem uma trava que
  cancela a publicação se algum nome de repositório privado aparecer nos dados.
