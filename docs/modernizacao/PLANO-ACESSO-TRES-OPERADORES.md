# Diagnóstico e plano de acesso — Ildebrando, Edson e Ivan

15/11/2026. Estado: proposta para revisão, sem implementação funcional.
Nesta etapa foram criados somente este plano e o manifesto de preservação.
Nenhum código, teste, migração, conta, dado real ou recurso remoto foi alterado.

## 1. Diagnóstico do código atual

| Local | Situação atual | Mudança necessária |
|---|---|---|
| database/schema.sql:10 | app_membros tem lugares fixos gustavo/ivan | Autorizar três identidades individuais; Gustavo sem acesso |
| database/operations.sql:24 e :93 | Vínculo ativo e decisão por lugares distintos | Preservar vínculo e usar UUID de outro operador autorizado, sem dependência dos dois lugares |
| database/corrective.sql:89 | Solicitação e decisão exigem membros ativos do modelo de dois | Atualizar para os três operadores e manter proibição de autoaprovação |
| js/servicos.js:30; login.html:23 | signInWithPassword recebe e-mail; input type=email | Campo Usuário e resolução de identidade em endpoint servidor |
| Modelo atual | Não há administração de usuários, instalação do administrador ou ativação por código | Acrescentar controles separados de identidade, administração e ativação |
| RLS atual | Conta ativa basta; não há autorização da sessão por geração de acesso | Impedir uso de sessões anteriores ao bloqueio, inclusive após reativação |

São aproveitáveis: Supabase Auth, base financeira compartilhada, lançamentos
imutáveis, dupla participação na exclusão, estorno integral, cadeia linear de
correções, idempotência, auditoria e recuperação por UUID. Não há razão para
reescrever o financeiro ou alterar o visual.

Os 54 testes anteriores documentam a versão anterior. Não comprovam o novo
modelo de três operadores/ativação/administração. Manifesto dos arquivos atuais:
[BASELINE-54-ACESSOS.json](BASELINE-54-ACESSOS.json).

## 2. Regras de acesso propostas

| Pessoa / usuário canônico | Financeiro compartilhado | Administrar usuários |
|---|---|---|
| Ildebrando / ildebrando | Sim, quando autorizado e com credencial/sessão válidas | Exclusivamente ele |
| Edson / edson | Sim, nas mesmas condições | Não |
| Ivan / ivan | Sim, nas mesmas condições | Não |
| Gustavo / gustavo | Não | Não |
| Qualquer outra identidade | Não | Não |

Os nomes canônicos são fixos e não aceitam criação de um quarto operador ou de
Gustavo. Ildebrando administra o cadastro e o ciclo de acesso desses operadores;
isso não autoriza ampliar a lista ou promover outra pessoa a administrador.
Display name, e-mail, parâmetros de formulário e user_metadata não concedem papel.

Ildebrando também obedece à aprovação por outra pessoa no financeiro: não pode
aprovar a própria solicitação por ser administrador. Para cada solicitante,
qualquer UM dos outros dois operadores ativos pode aprovar ou rejeitar. Não se
exigem três assinaturas. Uma única decisão terminal gera no máximo um estorno.

Gustavo nunca será simplesmente renomeado para Ildebrando nem terá seu UUID
reutilizado. Se existirem perfis/autorias históricos, serão preservados sem acesso.
Qualquer desativação de conta existente será planejada e autorizada separadamente;
nenhuma conta real foi consultada ou modificada nesta etapa.

## 3. Supabase Auth com usuário e senha

Supabase Auth oferece login por e-mail/senha ou telefone/senha, não um campo
username próprio nessa API. Proposta: diretório privado de identidades e um
endpoint servidor de login por usuário, preservando o Auth como responsável
por senha, hash, verificação de credenciais, JWT e refresh.
[Referência: signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).

Fluxo:

1. Operador informa somente usuário e senha pessoal, por HTTPS.
2. Endpoint valida o identificador ASCII canônico, limites de tentativas e
   elegibilidade. Resolve o username para alias técnico de e-mail ligado ao
   UUID Auth. Não há diretório público de consulta de usuários/e-mails.
3. Um cliente Auth efêmero, com chave pública, chama signInWithPassword usando
   o alias e a senha recebida. Não usa service_role para simular autenticação.
4. Após sucesso, o servidor revalida a autorização e registra a sessão Auth
   como admitida para a geração de acesso atual. Só então retorna a sessão.
5. O SDK no navegador usa setSession e continua o refresh normal do Supabase.

Alias técnico é opaco, estável e gerado pelo servidor; não é e-mail pessoal nem
precisa ser digitado/recebido pelo operador. Proposta de domínio interno sem
entrega de mensagens, cuja aceitação pelo Auth será testada antes da implementação
final. Ele pode aparecer nos claims do JWT: não será tratado como segredo ou
como fronteira de autorização. A aplicação usa UUID, nunca domínio/nome do alias,
para conceder acesso.

Senha passa transitoriamente pelo endpoint para autenticação ou definição no
Auth, mas não é persistida, incluída em logs, analytics, filas ou relatórios.
Não será criada tabela de senhas, hashes de senha ou verificador próprio.
Autocadastro, Auth anônimo e provedores externos não necessários ficam desativados.

As operações Admin API usam um cliente separado e credencial secreta somente
no servidor. Nunca reutilizar o cliente privilegiado para signInWithPassword,
nem mandar essa credencial para o navegador. Criação/definição de senha continuam
pelas APIs oficiais, não por escrita direta em auth.users.
[createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

## 4. Modelo de autorização e sessões

Proposta de novas estruturas, sem senhas:

| Estrutura | Responsabilidade |
|---|---|
| public.operadores | UUID Auth, username único da lista permitida, autorização/bloqueio administrativo, credencial pronta e geração de acesso; leitura restrita e nenhuma escrita direta de cliente |
| private.identidades_auth | Alias técnico e UUID; somente servidor/instalação |
| private.administracao_app | Registro singleton com UUID de Ildebrando; somente instalação segura pode defini-lo |
| private.ativacoes | Destinatário, finalidade, digest do código, prazo, emissor, tentativas e estado; sem código em claro |
| private.sessoes_app | session_id do Auth admitido, usuário e geração de acesso; não guarda tokens ou senhas |
| private.operacoes_identidade | Estados/idempotência das operações distribuídas entre banco e Admin API; sem senha ou código bruto |

O ativo efetivo será calculado: cadastro permitido + autorização administrativa
+ ausência de bloqueio + senha definida + sessão admitida e válida. Somente as
rotinas administrativas de Ildebrando alteram autorização/bloqueio. O resgate
do código altera apenas a conclusão da credencial; não concede autorização
administrativa nem desbloqueia alguém.

Os helpers de acesso e todas as RPCs financeiras/administrativas verificarão
essa regra no banco. Novas tabelas expostas têm RLS; diretório/códigos/administração
ficam em private, fora da Data API. user_metadata e claims de papel editáveis
não substituem consulta ao registro administrativo.

Cada sessão admitida referencia uma sessão real do Auth e a geração atual.
Bloquear/reativar aumenta a geração e invalida admissões anteriores. Assim,
reativar não faz um JWT antigo voltar a funcionar. Login direto no Auth por
alias, se tentado fora do gateway, pode criar uma sessão Auth, mas não cria
admissão no app e não acessa financeiro/administração.

Bloqueio começa no banco: acesso é negado antes de tentar banir/revogar sessões
no Auth. Falha na Admin API não deve deixar a pessoa ativa. Revogação e banimento
serão sincronizados por operação auditada/reexecutável. Os tokens antigos não
são considerados inválidos apenas porque houve logout/bloqueio: a checagem de
sessão e geração no banco fecha essa lacuna.
[Sessões Supabase](https://supabase.com/docs/guides/auth/sessions).

O vínculo com auth.sessions/session_id será conferido na versão alvo. Refresh
mantém a mesma admissão quando a sessão e geração continuam válidas; remoção
da sessão ou mudança de geração nega acesso. Essa tabela é autorização adicional
da aplicação, não substitui a sessão criptográfica/refresh do Supabase.

O antigo app_membros será desativado como fonte de autorização após migração
explícita dos vínculos. Não basta somar novos nomes ao CHECK atual. Preservar
seus registros legados até a verificação de dependências, sem deixar helpers
antigos ou funções alternativas concederem acesso a Gustavo.

## 5. Instalação do administrador inicial

Procedimento offline/CLI do instalador autorizado, com segredo administrativo
somente no ambiente de instalação. Não haverá endpoint web público de bootstrap,
regra de primeiro cadastrado ou promoção baseada em nome/e-mail/metadado.

1. Verificar projeto alvo exclusivo, esquema e estado de instalação. Não
   selecionar/reutilizar bancos de outros aplicativos.
2. Com lock, operação idempotente e identidade do instalador auditada, preparar
   a identidade Auth de Ildebrando com alias técnico. Qualquer senha provisória
   será aleatória forte, descartada e não entregue como credencial reutilizável.
3. Vincular seu UUID ao username ildebrando e ao registro singleton administrativo.
   O papel nasce aqui, fora da ativação. Registrar a instalação como concluída.
4. Gerar um código individual de primeiro acesso para Ildebrando pelo mesmo
   mecanismo restrito de credenciais. Mesmo este código não escreve o papel:
   o vínculo administrativo já foi provisionado separadamente.
5. Encerrar a janela e remover credenciais temporárias do instalador. Reexecução
   retorna/valida o mesmo estado e não cria/promove outro administrador.

Admin API e SQL não são uma transação distribuída. Falhas entre criar Auth,
registrar UUID e finalizar instalação precisam de estados e retomada explícitos.
Identidade parcial fica sem autorização efetiva; não se abre o bootstrap para
qualquer cliente tentar reparar a falha.

Proposta: impedir autobloqueio/remoção do único administrador pelas telas normais.
Recuperação excepcional depende do procedimento offline, restaura o UUID de
Ildebrando e é auditada; não transforma Edson/Ivan em administradores.

## 6. Cadastro e primeiro acesso

1. Ildebrando autenticado e ativo solicita cadastro/autoriza Edson ou Ivan.
   Backend e banco validam o UUID administrativo; não confiam no botão da UI.
2. Servidor cria/reserva a identidade Auth e o cadastro ainda sem credencial
   pessoal pronta. Repetir a operação não cria outra identidade.
3. Ildebrando solicita o código. Proposta: token CSPRNG com pelo menos 128 bits,
   identificador aleatório do convite, validade de 15 minutos e uso único. Guardar
   apenas digest/HMAC, finalidade, alvo, geração e estado. A chave de HMAC fica
   no ambiente servidor, se adotada. Não confundir isso com hash de senha.
4. Mostrar o código bruto uma única vez a Ildebrando para entrega privada ao
   destinatário. Não enviar nada automaticamente nesta etapa; canal de entrega
   será definido. Reemitir invalida o anterior. Limitar tentativas no servidor
   por origem/usuário/convite, sem bloquear a conta inteira por tentativa anônima.
5. Operador informa usuário, código e sua senha escolhida. Endpoint valida o
   convite específico, prazo, finalidade, geração e estado administrativo.
6. Banco reserva/consome o convite atomicamente. Só um resgate pode prosseguir.
   Backend atualiza a senha por Admin API e finaliza credencial pronta sob a
   mesma versão/nonce. Código consumido nunca volta a ficar disponível.
7. Operador entra pelo login normal; só ganha sessão do app se Ildebrando já
   autorizou o acesso e a conta não está bloqueada.

Se a resposta do Auth for incerta, não afirmar atomicidade inexistente. Manter
a ativação inconclusa/sem acesso, não persistir a senha para retry e exigir
regularização/reemissão por Ildebrando. Não repetir atualização de senha apenas
reapresentando o mesmo código. Consulta idempotente de estado não redefine senha.

Bloqueio concorrente muda a geração e invalida convites. Uma chamada Admin API
já em voo pode concluir a senha, mas não poderá finalizar autorização de acesso.
Nenhum resgate escreve administracao_app, autorizado ou bloqueado. Payload com
role/admin/outro destinatário será recusado, não aceito como configuração.

Sem caixa postal pessoal, recuperação por e-mail não será pressuposta. Proposta
para revisão: eventual recuperação de senha também mediada por Ildebrando, com
finalidade própria e código novo; não autorizar funcionalidades extras nesta etapa.

## 7. Administração e financeiro

Endpoints administrativos autenticados: cadastrar, autorizar/ativar, bloquear,
reativar e emitir/revogar código. Cada ação valida sessão/geração e UUID do único
administrador, usa allowlist de campos, idempotência e auditoria. Edson/Ivan não
recebem EXECUTE que permita alterar esses estados diretamente.

Bloqueio é reversível, sem apagar Auth/profile/obras/movimentos ou autoria.
Reativação preserva o UUID e exige login novo; não revive sessão/código antigo.
Gestão de acesso não permite apagar lançamentos nem dispensar a segunda pessoa.

Manter a exigência atual de solicitante ainda autorizado e decisor ativo/distinto.
Se o solicitante estiver bloqueado, seu pedido permanece sem efeito financeiro
e sem transferência automática de autoria. A revisão pode mudar essa política
explicitamente, mas a implantação não decidirá isso silenciosamente.

## 8. Preservação dos testes e novos cenários

Os arquivos atuais foram registrados por SHA-256 e não serão apagados ou
desabilitados para acomodar o novo modelo. Na implementação futura, preservar
os 54 casos e suas asserções de segurança/financeiro; adaptar explicitamente
apenas fixtures/harness de identidade e sessão quando necessário. Ildebrando
substitui o papel positivo de teste antes chamado Gustavo; Edson entra como
terceiro autorizado; continua existindo um intruso separado.

Casos históricos de v1/v2 continuarão presos às suas migrações antigas. Os
demais deverão rodar contra a nova migração com sessões válidas, sem atalhos de
autorização para testes. Acrescentar provas específicas de Gustavo negado.
Não afirmar que execução histórica v2 comprova a política v3.

Matriz de novos cenários propostos, ainda NÃO implementados/executados:

| ID | Cenário / resultado esperado |
|---|---|
| AC01 | Instalação cria apenas Ildebrando administrador, com UUID persistido; nenhum bootstrap público |
| AC02 | Instalações simultâneas/repetidas e falha Auth/SQL não criam segundo admin nem acesso parcial |
| AC03 | Login dos três por username e senha, sem digitar e-mail; normalização ASCII definida |
| AC04 | Gustavo, inclusive com conta Auth/JWT preexistente, não acessa login do app, RPC, RLS ou administração |
| AC05 | Erros de usuário/senha/código não enumeram estado de conta; limites de tentativas aplicados no servidor |
| AC06 | Login direto no Auth por alias não concede admissão no app nem acesso financeiro |
| AC07 | user_metadata, nome, e-mail, JWT/role ou payload forjados não promovem administrador |
| AC08 | Edson/Ivan são impedidos de todas as ações administrativas pela UI, endpoint e API/SQL direta |
| AC09 | Somente Ildebrando cadastra/autoriza/bloqueia/reativa; operações repetidas são idempotentes e auditadas |
| AC10 | Cadastro de Gustavo, quarto operador, duplicata ou takeover de username/UUID é recusado |
| AC11 | Único administrador não pode ser bloqueado/removido pelas operações normais |
| AC12 | Código possui destinatário, prazo e finalidade; banco/logs não contêm código bruto |
| AC13 | Primeiro acesso define senha exclusivamente no Auth; senha provisória não serve como senha pessoal |
| AC14 | Código usado/expirado/revogado/substituído é recusado; reemitir não preserva o antigo |
| AC15 | Dois resgates simultâneos do mesmo código: um único vencedor |
| AC16 | Código ou alteração do seu payload nunca escreve papel administrativo/autorização/bloqueio |
| AC17 | Bloqueio/reativação concorrente com resgate respeita geração e não libera conta bloqueada |
| AC18 | Falha antes/depois da troca de senha não reabre código nem deixa acesso parcial; retomada segura |
| AC19 | Criação Auth parcial/timeout/retentativa não duplica usuário nem autoriza identidade órfã |
| AC20 | Credencial pronta sem autorização de Ildebrando não basta; autorização sem credencial pronta também não |
| AC21 | Bloqueio nega JWT e refresh antigos; reativar exige sessão nova e não ressuscita token antigo |
| AC22 | Refresh válido conserva sessão autorizada; logout/remoção da sessão perde admissão |
| AC23 | Todas as seis combinações ordenadas de solicitante/outro operador: aprovar/rejeitar; autoaprovação sempre negada |
| AC24 | Pedido de operador bloqueado continua sem efeito, histórico preservado e sem transferência de autoria |
| AC25 | Os três veem os mesmos IDs, saldos, estornos/correções e relatório; nenhuma base privada por usuário |
| AC26 | Recuperação após reload e troca entre três usuários preserva UUID da operação e vínculo ao ator correto |
| AC27 | Senha/código/segredo administrativo não aparecem em logs, storage, cache PWA, erros ou bundle |
| AC28 | Recuperação offline do admin restaura somente Ildebrando; código público não executa instalação/promoção |
| AC29 | Alterações de identidade/metadados do Auth não alteram o username autorizado, o UUID administrativo ou as permissões |
| AC30 | Clientes tentam escrever nas tabelas de autorização, sessões e códigos; nenhuma mutação direta permitida |

## 9. Implementação por etapas, após revisão deste plano

1. Revisar com Zyra a separação Auth/autorização, o bootstrap, a regra de código
   e os estados de falha. Confirmar prazo/canal privado de entrega e política
   excepcional de recuperação do único administrador.
2. Preparar terceira migração aditiva; manter v1/v2 intactas. Auditar dependências
   de app_membros/lugar e remover todos os caminhos antigos de autorização.
3. Implementar as rotinas SQL privadas/RLS e instalação local com fixtures.
   Validar banimento lógico, gerações e todos os pares de aprovação.
4. Implementar gateway de login, administração e ativação local, com clientes
   Auth público e administrativo separados, segredos só no servidor e rate limits.
5. Adaptar apenas login, primeiro acesso e gestão de operadores. Preservar as
   telas financeiras e os componentes existentes; não fazer redesign.
6. Executar os 54 casos preservados e os novos cenários com PostgreSQL nativo,
   Auth/PostgREST reais e concorrência. Acrescentar navegador real para os novos
   fluxos de primeiro acesso/administrador/sessão e prova de ausência de segredos.
7. Entregar diff, evidências, estados pendentes e pacote revisável. Qualquer
   operação remota, conta real, importação, push ou publicação segue bloqueada
   até autorização específica posterior.
