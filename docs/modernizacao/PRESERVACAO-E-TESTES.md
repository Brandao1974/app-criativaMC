# Preservação, importação e aceitação

Estado: plano e ferramenta de exportação preparados; dados reais não lidos,
exportados ou importados nesta sessão. Não executar migração sem aprovação.

## Coleta antes de qualquer migração

1. Identificar todos os dispositivos, navegadores/perfis e origens utilizados
   por Gustavo e Ivan. localStorage pertence à origem, não à conta do usuário.
   Caminhos de outros sites em brandao1974.github.io podem compartilhar storage.
2. Encerrar gravações e fechar outras abas/PWAs. Abrir `login.html` na origem
   original, evitando obras/detalhe, cuja leitura normaliza e regrava o legado.
   Não limpar dados, trocar origem nem depender de cópia em localhost.
3. Executar manualmente [exportar-localstorage.js](exportar-localstorage.js)
   no console desse perfil, após revisar o script. Ele só lê storage e solicita
   download do JSON com strings originais e do SHA-256. Não carrega o código
   financeiro, não usa fetch nem envia dados. O código não é incluído no PWA.
4. Confirmar ambos os downloads. Se o navegador bloquear o segundo, liberar
   o download de checksum e repetir a coleta durante a pausa operacional.
   Calcular novamente `Get-FileHash -Algorithm SHA256 -LiteralPath <arquivo>`
   e comparar com o .sha256. Não editar/reformatar esse arquivo.
5. Guardar duas cópias privadas fora do repositório. Inclui estado da sessão e
   pode incluir dados de outros apps da origem; não anexar ao GitHub.
6. Manter o arquivo bruto imutável. Só cópias derivadas recebem conversão,
   quarentena ou redação. Registrar dispositivo/perfil e horário em manifesto
   privado; não incluir senhas, tokens ou dados reais no código.

A dupla leitura do exportador detecta algumas alterações concorrentes, mas não
é uma transação de navegador. A pausa operacional e a coleta de todas as origens
continuam obrigatórias. Download solicitado não prova que o arquivo foi salvo.

## Conversor/importador a implementar após aprovação

| Dado | Regra |
|---|---|
| obras | Preservar id legado, cliente, descrição, localização, responsável, valor contratado, autor original textual, status e agenda |
| entradas/custos | Lista define natureza; tipo do custo vira categoria; preservar autor/data originais e deleteRequest |
| histórico | Preservar ordem por índice, texto e datas originais; separar fato legado não verificado de evento autenticado novo |
| caixa | Guardar bruto e comparar com soma; não importar como saldo nem criar ajuste |
| usuarioLogado | Evidência bruta apenas, não sessão Auth e não prova de autoria |
| obraSelecionada | Estado de UI; detalhe novo usa ?id=UUID |
| chaves desconhecidas | Preservar no backup; não interpretar ou importar automaticamente |

Parsing deve ocorrer sobre cópia das strings. JSON inválido interrompe a
conversão dessa coleção, preservando a fonte; não substituir por lista vazia.
Sem cliente/descrição válida, data/status desconhecido, dinheiro zero/negativo
ou identidade ambígua: registrar quarentena com caminho original e motivo.
Não fabricar descrição, data atual, status inicial, autoria nem eventos.

Dinheiro novo: sintaxe decimal explícita, até duas casas, converter por string
para inteiro/BigInt. Nenhuma soma em reais/float. Importação: número JSON já
armazenado é número em reais, não separador de milhar; sinalizar precisão extra
ou perda prévia. String `1.234` é ambígua: quarentena para confirmação, sem
assumir R$ 1.234,00. String inequívoca `R$ 1.234,56` → 123456 centavos.
Proposta para fração de centavo: exigir decisão explícita registrada por caso,
com política de arredondamento aprovada; não arredondar silenciosamente.
BigInt serializa como string decimal em JSON. Datas sem hora continuam sem hora;
ano bissexto e calendário devem ser validados sem normalização automática de Date.

Identidade de importação: origem canônica aprovada + entidade + chave legada
(obra/tipo/id) + índice estável para colisões/ausências dentro do snapshot
congelado. Resolver colisões antes de gravar manifesto; não gerar Date.now().
Lote guarda hash e versão do conversor. Mesma fonte sob outro usuário continua
sendo a mesma identidade compartilhada. Colisão com conteúdo diferente interrompe
a entidade para revisão; não ignorar silenciosamente ou sobrescrever registros.
Reordenação/mudança do snapshot exige reconciliação com manifesto anterior.
Não deduplicar apenas por valor/data/descrição, pois repetições podem ser legítimas.

Transação por obra, incluindo filhos, manifestação de origem e auditoria;
retomada de lote apenas entre transações concluídas. Importação administrativa
temporária não deve deixar aos operadores permissão de escolher autor, data
histórica, estorno ou decisão aprovada via API.

`deleteRequest` deve ser preservado integralmente como evidência não verificada.
Zero assinaturas: movimento ativo. Uma assinatura: movimento ativo e pendência
para confirmação pelo solicitante correto. Duas assinaturas ainda presentes:
inconsistência para revisão; não excluir automaticamente. Lançamentos já apagados
não podem ser reconstruídos. Usuário confirmar uma pendência cria nova solicitação
autenticada, sem transportar assinatura local como decisão comprovada.

Reconciliação por obra e global: quantidades brutas, válidas, em quarentena,
importadas e já existentes; total entradas/custos/saldo em centavos;
contratado separado de recebido. Guardar diferença entre caixa escalar e razão
derivado sem atribuir toda divergência ao bug de exclusão: corrupção, concorrência
e bases diferentes também são possíveis. Nenhuma liberação com diferença não
explicada/aceita; nenhuma linha de ajuste artificial.

Rollback antes do corte: manter app/backup legado, descartar somente ambiente
local de ensaio. Após dados remotos: não disponibilizar DELETE geral nem desfazer
via exclusão de auditoria. Recuperação precisa de plano aprovado de restauração
ou reversões auditadas; rollback de frontend sozinho não leva lançamentos novos
ao legado. Após corte, não permitir continuar gravando nas duas versões.

## Matriz obrigatória para a próxima etapa

Todos os testes abaixo estão PENDENTES; não há ambiente implementado.

| ID | Cenário | Resultado obrigatório |
|---|---|---|
| AUTH-01 | Gustavo e Ivan em perfis de navegador distintos | Login com credenciais individuais e mesmos ids de obras/movimentos |
| AUTH-02 | Sem sessão, conta terceira, conta desativada e nome/metadata forjados | Nenhum dado financeiro nem operação autorizada |
| AUTH-03 | Logout, expiração, refresh e troca de conta | Sessão/DOM coerentes; JWT ainda emitido tratado conforme política, sem prometer revogação instantânea |
| FIN-01 | Entradas 150000 + 250050; custos 80000 + 120075 | Saldo 199975 centavos em todas as telas |
| FIN-02 | 10.000 entradas de 1 centavo | 10.000 centavos, sem deriva |
| FIN-03 | Texto inválido, >2 casas, zero/negativo; agregado grande | Rejeição explícita ou quarentena; sem perda em Number |
| DEL-01 | Gustavo solicita excluir custo 30000 após entrada 100000 | Saldo permanece 70000; pedido pendente |
| DEL-02 | Gustavo aprova ou rejeita o próprio pedido por API | Bloqueio no banco, sem decisão nem estorno |
| DEL-03 | Ivan aprova o pedido DEL-01 | Um estorno de custo, saldo 100000; original e decisão preservados |
| DEL-04 | Ivan rejeita | Saldo 70000, motivo e autor registrados, zero estornos |
| DEL-05 | Fluxo invertido (Ivan solicita/Gustavo decide) | Mesmas garantias |
| DEL-06 | Dois pedidos simultâneos, dois cliques, retry após timeout, aprovar x rejeitar concorrentes | Um estado terminal e no máximo um estorno; payload divergente recusado |
| API-01 | DML direto em tabelas, autor/data/alvo/estado forjados | Falha de privilégio; nenhuma alteração parcial |
| API-02 | Chamada direta de todas as funções, inclusive helper privado | Exige vínculo; não expõe alteração administrativa ou bypass de approval |
| REV-01 | Valor desigual, outra obra, estorno de estorno ou segundo estorno | Rejeição por regra SQL/constraint; saldo intacto |
| REV-02 | Correção de valor usada para tentar contornar aprovação | Reversão exige outro operador; original nunca editado |
| AUD-01 | Atualizar/apagar histórico, decisão ou autor de movimento | Rejeição; histórico inicial/status/agendamento gerados atomicamente |
| MIG-01 | Mesmo lote 2–3 vezes e por ambos os usuários | Mesmos ids, contagens e somas; zero duplicações |
| MIG-02 | Falha no meio, ids repetidos/ausentes, snapshot alterado | Atomicidade por obra, retomada segura, conflitos explícitos |
| MIG-03 | JSON inválido, data inválida, mojibake, pendências antigas | Evidência original preservada; quarentena e confirmação; sem invenção |
| UI-01 | Index/login/dashboard/obras/detalhe/caixa/agenda | Navegação, cadastro, status e agenda preservados; total e extrato coerentes |
| UI-02 | Cliente/descrição/categoria com markup malicioso | Exibição como texto; sem execução de HTML |
| PWA-01 | Atualização em duas abas, offline e troca de usuário | Um build consistente, aviso offline, sem gravação local de financeiro ou cache de API/Auth |
| PUB-01 | Pages após merge autorizado | HTTP, assets, manifest/SW, login e operação nos dispositivos dos dois |

Executar testes SQL com papéis/claims simulados e também via REST/RPC com tokens
reais de teste. Testar concorrência em conexões independentes. Service role ou
postgres não provam RLS. Inspecionar grants, policies, funções expostas e advisors.
Registrar script, ambiente/versões, esperado, observado e saída sem segredos.
Rotular APROVADO/REPROVADO/PENDENTE por caso. Sem aprovação funcional se algum
teste bloqueante de autorização, financeiro, importação ou PWA permanecer pendente.
