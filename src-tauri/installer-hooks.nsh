; Encerra o OMNI Engine antes de copiar os arquivos.
;
; O engine roda destacado (DETACHED_PROCESS) e **sobrevive ao fechamento da janela** — é o que
; permite o acesso pelo celular com o app fechado. O efeito colateral é que, numa atualização, o
; `omni-engine.exe` continua em uso e o NSIS não consegue substituí-lo: a instalação termina "com
; sucesso" e deixa o engine da versão anterior no lugar.
;
; Foi exatamente isso que aconteceu na 0.3.1: app de 10/09 instalado por cima de um engine de
; 09/09, que não conhecia `mobile_settings` nem `account_usage`. O acesso pelo celular parecia
; "não implementado" por uma versão inteira, quando o código estava todo lá.
;
; `taskkill` sem `/T`: mata só o engine. As PTYs filhas morrem junto quando o ConPTY fecha, que é
; o comportamento esperado numa atualização. Falha (engine não estava rodando) é ignorada.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM omni-engine.exe'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM omni-engine.exe'
  Pop $0
!macroend
