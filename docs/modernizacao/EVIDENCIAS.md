# Evidências da primeira entrega

15/11/2026. Todas as execuções financeiras abaixo usam dados sintéticos em VM
Node, sem DOM real, navegador, conexão a banco ou dados dos operadores.

Comando: `node docs/modernizacao/verificar-diagnostico.cjs`

```text
CONFIRMADO: exclusão aprovada deixa caixa em 700 e razão em 1000.
CONFIRMADO: parser aceita valor negativo e interpreta 1.234 como fração.
CONFIRMADO: obterObras regrava o JSON durante leitura.
VERIFICADO: exportador preserva strings/chaves desconhecidas e hash; storage intacto (VM).
```

Saída 0. A confirmação dos defeitos é um teste de diagnóstico do legado:
não significa que o aplicativo atual atende aos requisitos ou foi corrigido.
O teste do exportador simula links e Blobs; download real ainda não verificado.

`node --check docs/modernizacao/exportar-localstorage.js`: saída 0.

Modelo: extração dos blocos delimitados por `sql` em MODELO-SQL-REVISADO.md
e análise com `pglast.parse_sql` instalado no ambiente Python existente:

```text
SQL: 3 blocos; 45 comandos analisados sem erro sintático
```

Não houve instalação de pacote. Parser valida sintaxe, não resolução de nomes,
FKs, RLS, comportamento de função/trigger ou grants em execução. O modelo é
deliberadamente preliminar; contratos ainda não são funções implementadas.

Conexões de leitura:

- GitHub get_user_login: Brandao1974.
- GitHub get_repo: repositório público app-criativaMC, main, admin/push/pull true.
- GitHub fetch_file: js/obras.js em main, linhas 530–558; conteúdo igual ao
  trecho local de exclusão, blob SHA `6015b66014126d96cda384d4339110c6b54e602b`.
- Supabase list_projects: sete projetos, sem app-criativaMC; não foram lidas
  tabelas, dados, chaves ou logs dos outros aplicativos.
- git ls-remote pelo shell: falha de conexão; não confundir origin/main local
  com prova do HEAD remoto vigente.
- Leitura de Pages via pesquisa web: indisponível; nenhum teste funcional feito.

Pendentes: todos os casos da matriz em PRESERVACAO-E-TESTES.md, aprovação do
modelo, revisão de Zyra, orçamento/provisionamento e consentimento de importação
e publicação. Nenhum resultado remoto financeiro/Auth/RLS foi declarado aprovado.
