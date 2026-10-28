# Acervo de telas das CLIs

`<cli>.<esperado>.<nome>.txt`: o texto da tela (como `vt100::Screen::contents()` devolve) e o que o engine tem
de reconhecer nela. `esperado`: `aprovacao` (pedido de permissão), `escolha` (menu/pergunta que vira cartão) ou
`nada` (nenhum dos dois). O teste `telas_do_acervo` (`src/interaction.rs`) roda todos.

Quando uma CLI atualizar, capture a tela nova com a sonda e veja se ainda casa:

```bash
OMNI_SONDA=claude OMNI_SONDA_SALVAR=aprovacao.comando-<versao> cargo test -p omni-engine sonda_aprovacao -- --ignored --nocapture
cargo test -p omni-engine telas_do_acervo
```

Põe a versão da CLI no nome. Tirando `claude.nada.resposta-cita-pergunta.txt` (sintético: resposta que cita a
frase de aprovação), todas são capturas reais.
