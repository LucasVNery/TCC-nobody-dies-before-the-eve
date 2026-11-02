# Execução completa da V0.1 (primeira e única até esta data)

- Comando: `npx vite-node tools/run-v0.ts --full --reviewed-before yes --pilot experiments/v0/results/2026-10-21/hipoteses.csv` (seed 20261105, 7 agentes × 60 runs, 10 runs por sessão, teto de 600 s por run)
- Código no momento da execução: commit `c484aad` na master (merge da V0.1 em `31a6afa`; M5 registrada como limitação da métrica em `51c3d7a`)
- Versão do jogo: `0.0.5`
- Gerado em 2026-11-01; tempo de execução 7,5 s; todas as verificações do pipeline ok
- Reprodutível: mesma seed e mesmo commit geram os mesmos arquivos (exceto a linha "Gerado em" e o tempo)
- Família M (M1–M5) e parâmetros finais dos estilos aprovados pelo autor em 2026-11-01, depois do piloto de calibração (`experiments/v0/calibration.md`) e antes desta execução; a divulgação de que as medianas descritivas do piloto foram vistas antes dessa revisão está no relatório e no `calibration.md`.
- Nenhum agente, hipótese ou parâmetro foi alterado depois de ver estes resultados.
