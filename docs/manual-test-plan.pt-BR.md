# RSVP Reader: plano de testes das 16 melhorias

Como usar: faça a preparação, depois percorra as seções. Cada caso diz o que fazer e o que deve acontecer. Os marcados com `auto` já têm teste automatizado (veja a seção 0); o que fica para você é conferir no dashboard de verdade, principalmente o visual, que nenhum teste automático enxerga.

## 0. O que já foi testado automaticamente (e o que não foi)

| Camada | Como rodar | Resultado |
|---|---|---|
| Limpeza e tokenizer (Python) | `cd backend && python3 -m pytest tests -q` | 61 passam |
| API com sessões descartáveis | `<python do gateway> backend/tests/test_server_api.py` | ok |
| Lógica pura do front (Node) | `node --test ui/tests/pure.test.mjs` | 17 passam |
| Telas reais (React 18 + jsdom) contra o backend real | `cd tests/ui-integration && npm install && bash run.sh` | 16 passam |
| Dados reais: 7.031 mensagens tokenizadas | script avulso | sem erro; 1,35% das palavras divididas; 6,9% "difíceis" |

Não coberto por nenhum teste automático: aparência (cores, espaçamento, corte de texto), o painel de 340px de verdade, o popover do chip no dashboard e o desempenho no navegador. É isso que as seções abaixo checam.

## 1. Preparação

1. Clique em **Enable** no app RSVP Reader (o app foi reinstalado) e faça **Ctrl+Shift+R** no dashboard. Sem isso o navegador usa os `.mjs` antigos.
2. Abra uma conversa com algumas respostas do agente, de preferência com listas e tabelas. Abra o painel lateral pelo `+` e escolha RSVP Reader.
3. Abra também a página cheia (menu Apps, RSVP Reader) e o chip ⚡ do composer.
4. Para os casos com texto controlado, use **Paste text** com o texto da seção 8.
5. Antes de começar, abra o console do navegador (F12). Qualquer erro vermelho `[RSVP Reader]` durante os testes deve ser anotado.

## 2. Chegar rápido na resposta certa

**F1. Só a resposta final de cada turno** (`auto`)
- 1.1 Abra o painel. O seletor deve mostrar suas mensagens e a resposta que fecha cada turno, sem as falas curtas do tipo "Vou localizar…". O botão ao lado do seletor deve dizer **Replies only**.
- 1.2 Clique em **Replies only**. Ele vira **All messages** e a lista cresce (as narrações aparecem). Recarregue a página: a escolha continua.
- 1.3 Com **Replies only**, use **↑/↓**. Deve pular só entre as mensagens listadas.
- 1.4 Selecione uma narração em **All messages** e volte para **Replies only**: essa mensagem deve continuar no seletor até você trocar de mensagem.
- 1.5 Ao abrir, deve vir selecionada a resposta mais recente do agente (não a sua pergunta).

**F2. Preview limpo, tempo de leitura e hora** (`auto`)
- 2.1 Cada item mostra `Agent · texto limpo (123w · ~1 min · 14:32)`. Não pode haver `**`, `#` nem `|` no texto.
- 2.2 Mensagens de outro dia mostram `06/10 14:32`; de hoje, só `14:32`.
- 2.3 Mensagens que levam menos de ~45 s mostram `<1 min`. Mude o WPM e reabra o seletor: o tempo estimado muda.

**F9. Aviso de resposta nova** (`auto`)
- 9.1 Com o painel aberto e parado, mande uma mensagem no chat. Quando o agente terminar e a conversa ficar ~6 s sem mudar, deve aparecer a barra **New reply in this conversation** com **Read it** e ✕.
- 9.2 **Read it** abre a resposta nova. A barra some.
- 9.3 ✕ some com a barra e ela não volta para a mesma resposta.
- 9.4 Se a resposta já é a que está aberta, a barra não aparece.
- 9.5 Limite conhecido: se o agente ficar mais de 6 s sem escrever no meio de uma tarefa longa, a barra pode aparecer por causa de uma narração. Anote se isso incomodar.
- 9.6 Com o painel em outra aba do navegador (oculta), não deve haver chamadas ao backend. Confira em Network no F12.

**F16. Primeiro uso**
- 16.1 Limpe o armazenamento (`localStorage.clear()` no console) e abra o painel. Deve aparecer o cartão **Quick tour**.
- 16.2 **Got it** fecha o cartão e ele não volta após recarregar (`auto`). **All shortcuts (?)** fecha e abre a lista de atalhos.
- 16.3 Em uma conversa sem mensagens, o painel diz "Nothing to read yet. Once the agent replies in this chat, its reply shows up here."

## 3. Conforto na leitura

**F3. Voltar algumas palavras ao retomar** (`auto`)
- 3.1 Dê play, pause com **Espaço** numa palavra qualquer, dê play de novo: a leitura recomeça 4 palavras antes.
- 3.2 Pause, clique numa palavra do Context (ou use **→**) e dê play: **não** deve voltar nada (você escolheu o ponto).
- 3.3 Em Settings, Reading display, mude "On resume, go back" para 0: não volta mais. Para 8: volta 8.
- 3.4 Pausar no começo (palavra 1) e retomar não pode dar erro nem índice negativo.

**F4. Começo mais lento** (`auto`)
- 4.1 A 600+ WPM, dê play: as primeiras 5 palavras devem sair visivelmente mais devagar que as seguintes.
- 4.2 Desmarque "Slow start after play" nas Settings: o início passa a sair na velocidade cheia.
- 4.3 A rampa vale a cada play, inclusive depois de uma pausa.

**F5. Lembrar onde parou** (`auto`)
- 5.1 Leia uma mensagem longa até ~50%, troque de mensagem e volte: deve abrir na mesma posição com a barra **Picked up where you left off (50%)**.
- 5.2 Feche o painel e reabra: continua valendo.
- 5.3 **Start over** volta ao início e apaga a posição guardada.
- 5.4 Leia até o fim (97% ou mais) e reabra: abre do início, sem barra.
- 5.5 Texto colado não guarda posição.
- 5.6 Mudar uma opção de limpeza no meio da leitura mantém a posição (mesma fração).

**F6. Tempo restante** (`auto`)
- 6.1 Junto de `word 12 / 518` (página) ou `12/518` (painel) aparece `· 1:12 left`. O tempo diminui conforme a leitura avança.
- 6.2 Mude o WPM: o tempo restante muda na hora. Pausas longas (listas, tabelas) entram na conta.

**F13. Conforto visual**
- 13.1 Settings, Reading display: troque a fonte para **Sans-serif**. A palavra central muda e continua cabendo na caixa (confira em palavra longa).
- 13.2 **Letter spacing** 0.08: as letras se afastam, sem cortar a palavra.
- 13.3 **Highlighted letter at** 20 e depois 50: a letra colorida se move dentro da palavra.
- 13.4 Navegue só com **Tab**: todo botão e controle mostra um anel de foco visível.
- 13.5 Com "Reduzir movimento" ativo no sistema, a Context box não rola com animação.
- 13.6 Passe o mouse nos botões ⟲ ⏮ ▶ ⏭ ?: cada um mostra uma dica. (Com leitor de tela, cada um tem nome.)

## 4. Navegação e descoberta

**F7. Atalhos** (`auto`)
- 7.1 **[** e **]** (ou **-** e **=**) mudam a velocidade de 20 em 20 WPM. Respeitam os limites 100 e 1000.
- 7.2 **Alt+→** pula para o início da próxima linha ou item; **Alt+←** volta ao início da linha atual e, se já estiver no início, à anterior.
- 7.3 **Home** volta ao começo.
- 7.4 **?** abre a lista de atalhos; **Esc** fecha. No painel, a lista não cita as teclas de sessão.
- 7.5 **Esc** também fecha Settings e a caixa de Paste text.
- 7.6 **Ctrl+→** e outros atalhos do navegador não são capturados.
- 7.7 Digitando na caixa de Paste text, nenhum atalho deve disparar.

**F8. Context box que não puxa a rolagem** (`auto` parcial)
- 8.1 Durante o play, role a Context box para cima com a roda do mouse: ela para de seguir e aparece **↧ Back to current word**.
- 8.2 O botão volta para a palavra atual e retoma o acompanhamento.
- 8.3 Clicar numa palavra também retoma o acompanhamento.
- 8.4 Pausado, use **→**: a caixa volta a acompanhar sozinha.
- 8.5 A rolagem acontece só dentro da caixa; a página não pula.

**F16/F7. Ajuda sempre à mão**
- 16.4 O botão **?** ao lado dos controles abre a mesma lista. Na página cheia há também a linha de atalhos sob os controles.

## 5. Dentro de listas e palavras difíceis

**F11. Palavras muito longas** (`auto`)
- 11.1 Cole o texto da seção 8. `getUserNameFromSessionStoreFactoryXYZ` aparece em três partes no campo central (`getUserNameFrom`, `SessionStoreFactory`, `XYZ`), mas **colado sem espaço** na Context box.
- 11.2 Palavras longas comuns do português (`preferencialmente`) **não** são divididas.
- 11.3 Settings, linha Long words: "Keep whole" desliga a divisão; "max letters" 12 divide mais palavras.
- 11.4 Cada parte cabe na caixa sem mudar de tamanho a cada palavra.

**F12. Pausa em números e identificadores** (`auto`)
- 12.1 `v0.7.1`, `02/09`, `spawn_run`, `panel.mjs` ficam um pouco mais lentos que palavras comuns.
- 12.2 Settings, linha Numbers / IDs, pause 1: igual às demais. 3: bem mais lento.
- 12.3 Palavras comuns e fins de frase não mudam.

**Chip de posição e item destacado (da rodada anterior, agora com a base nova)** (`auto`)
- 12.4 Dentro de uma lista, acima da palavra aparece `item 2/3 · título da lista`; em subitem, `item 2.1/3`.
- 12.5 Fora de listas e em listas de um item só, o chip não aparece.
- 12.6 Na Context box o item atual tem barra e fundo suaves; os outros itens não se mexem.

## 6. Chip do composer e desempenho

**F10. Leitura dentro do chip** (verificar só no dashboard real)
- 10.1 Clique no ⚡ do composer. A ordem dos botões é: **Open in side panel**, **Quick read here**, **Open full page**, **Close**.
- 10.2 **Quick read here** abre uma caixa pequena com a resposta mais recente, play/pause, velocidade e progresso.
- 10.3 Com **Hide quick read** a caixa some. O popover não deve ficar cortado nem fechar sozinho ao dar play (se fechar, anote: é a incerteza que ficou desta função).
- 10.4 A velocidade mexida aqui vale também no painel e na página, na próxima vez que abrirem (mesmo armazenamento).

**F14. Mesmo comportamento nas duas telas** (consequência da unificação)
- 14.1 Repita 1.2, 3.1, 7.2 e 9.1 na página cheia e no painel: o comportamento deve ser idêntico.
- 14.2 Mude uma opção de Settings no painel e abra a página cheia: ela já usa a mesma opção (e vice-versa).

**F15. Desempenho da Context box**
- 15.1 Abra uma mensagem de 2.000 palavras ou mais e dê play a 800+ WPM. A leitura não deve engasgar nem travar a rolagem.
- 15.2 Medido em jsdom com 6.400 palavras: de ~30 ms para ~0,7 ms por palavra. No navegador, o número vai variar; o que importa é não perceber travada.

## 6b. Linha de opções do agente

- O1 Abra uma resposta que termina com `[OPTIONS: A | B]` (as deste chat terminam assim). A leitura termina na última palavra do texto; a linha de opções não aparece no campo central nem na Context box. (`auto`)
- O2 Settings, linha **Options line**: **Read them** passa a ler `Options: A, B.` no fim; **Keep as is** mostra `[OPTIONS:` como texto comum; **Skip them** (padrão) volta a pular. (`auto`)
- O3 **Raw** mostra a linha, porque é o texto original.
- O4 Uma frase que só menciona `[OPTIONS: a | b]` no meio do texto não é pulada: só a linha inteira é.

## 7. Regressões (o que já funcionava)

- R1 Painel preso à conversa certa, sem seletor de sessão; página cheia com seletor de sessão e **Shift+↑/↓**.
- R2 Clean/Raw: em Raw, o texto aparece cru e mesmo assim com as quebras de linha da mensagem.
- R3 Settings: presets Minimal, Balanced e Detailed mudam o preview; **Reset to defaults** restaura limpeza e display.
- R4 Context box com títulos em negrito, listas com marcador e recuo, linhas de tabela separadas, blocos de código em uma linha.
- R5 Palavra grande cabe no painel estreito (sem quebrar nem cortar).
- R6 Paste text: cola, lê, e **Back to this conversation** volta à conversa (painel).
- R7 O chip continua abrindo a página cheia com a sessão certa.

## 8. Texto para colar (Paste text)

```
## Plano de teste

Veja o resultado. Versão v0.7.1 publicada em 02/09 com spawn_run e panel.mjs.

Para cada fonte de contato
1. Nome da fonte e sistema responsável
2. Como os dados são disponibilizados: API, webhook ou arquivo
3. Documentação técnica de conexão
   - manuais
   - especificações de API

Identificador longo: getUserNameFromSessionStoreFactoryXYZ e my-app-prod-cognito-jwt-authorizer-v2.

| Cat | Valor |
|---|---|
| Ênfase | **negrito** |
| Lista | bullet |

Fim do texto, com preferencialmente uma palavra longa comum.
```

Esperado: título lido sem `##`; `Para cada fonte de contato` como título da lista; chip `item 1/3` ... `item 3/3`, subitens com `3.1`; identificadores em partes; tabela lida como `Cat, Valor.` e `Ênfase: negrito.`; "preferencialmente" inteira.

## 9. Se algo falhar

- Barra de erro vermelha ou painel vazio: abra o console (F12) e copie o erro `[RSVP Reader]`.
- Comportamento antigo (sem chip, sem "Replies only"): é cache. Ctrl+Shift+R, ou F12, Network, "Disable cache", recarregar.
- Painel em 502: menu "..." do app, **Sync**.
- Depois de qualquer correção minha, rode de novo a seção 0 antes de repetir os testes manuais.
