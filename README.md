# Desafio 9 — Views que não parecem humanas

API HTTP que analisa uma série de views ganhas por hora com regras legíveis. O resultado pode ser `sem_sinais_suspeitos`, `inconclusivo` ou `suspeito`. Uma suspeita recomenda revisão humana; não prova fraude nem deve bloquear pagamentos automaticamente.

## Executar

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

O servidor escuta em `http://localhost:3000`. Para verificar se está ativo, consulte `GET /health`.

## API

Envie uma lista de contagens inteiras não negativas em horas consecutivas para `POST /classify`:

```json
{"views":[100,135,210,180]}
```

A API aceita entre 1 e 720 horas. Séries com menos de 24 horas retornam `inconclusivo`. Campos desconhecidos, frações, números negativos, inteiros fora da faixa segura e somas inseguras retornam HTTP 400.

Exemplo de resposta:

```json
{
  "classification": "inconclusivo",
  "reason": "A série tem 4 horas; são necessárias pelo menos 24 para avaliar os padrões temporais.",
  "signals": [
    {
      "code": "series.hours",
      "value": 4,
      "unit": "hours",
      "threshold": 24,
      "comparison": ">=",
      "triggered": false
    }
  ],
  "recommendedAction": "obter_mais_dados",
  "ruleVersion": "1.0.0"
}
```

## Critério e limites

O classificador não consulta a origem dos dados nem usa rótulos do dataset. Ele verifica quatro horas de contexto em ambos os lados de um bloco elevado de 8–24 horas, sua variação interna, seu nível em relação ao fundo local e a abruptidão das bordas. Também procura quatro ciclos consecutivos de 2–12 horas com forma quase idêntica, contraste alto e amplitude mínima.

Uma janela só vira suspeita se cumprir em conjunto: média mínima de 100 views/hora, variação interna de até 2%, elevação de pelo menos 10 vezes sobre o fundo e transições de pelo menos 5 vezes nas duas bordas. Para ciclos repetidos, o erro normalizado da forma deve ser de até 2%, a amplitude de pelo menos 100 views/hora e o contraste de pelo menos 10 vezes. Essas regras e limiares pertencem à versão `1.0.0`.

Um pico concentrado isolado não é prova de compra: quando as três maiores horas somam pelo menos 60% das views e o pico é pelo menos 10 vezes a mediana, a resposta é inconclusiva. Falta de contexto nas bordas de um possível bloco mecânico também leva à abstenção. Séries sem sinais avaliados não comprovam autenticidade.

O classificador pode não detectar compra gradual ou comportamento artificial que imite variação orgânica. Uma divulgação legítima com tráfego muito regular pode parecer mecânica e exigir revisão. Lacunas de coleta, métricas de engajamento, plataforma e dados de audiência estão fora desta versão. O classificador não distingue duas origens que produzam exatamente a mesma série horária.

## Dataset e avaliação

```bash
npm run generate:dataset
npm run evaluate
```

O segundo comando também gera os dois datasets e `reports/evaluation.json`. As seeds fixas `20260901` (desenvolvimento) e `20261009` (holdout) tornam os arquivos reproduzíveis. Cada conjunto contém 1.000 séries legítimas e 500 artificiais, geradas localmente sem dados de redes sociais. Entre as 200 séries de divulgação externa, cada exemplo tem 15% de chance de ser uma campanha autorizada regular; seus platôs legítimos testam diretamente o risco de falso positivo. As séries ambíguas não têm rótulo único e ficam fora das taxas binárias.

A taxa de falsos positivos (FPR) é `legítimas classificadas como suspeitas / total de legítimas`. Inconclusivos permanecem no denominador da FPR e são reportados à parte. A taxa de detecção conta apenas artificiais classificados como suspeitos; artificiais inconclusivos não contam como detectados. A meta de desenvolvimento é FPR de até 2%, mas o README publica o resultado medido, sem alterar a composição do dataset para atingir a meta. A métrica descreve somente esta simulação e suas proporções; não estima a incidência real de tráfego artificial. A tabela por família mostra que uma campanha autorizada pode compartilhar os sinais do padrão mecânico.

Copie os valores calculados para o bloco abaixo com:

```bash
npm run evaluate -- --update-readme
```

O teste verifica o bloco publicado recalculando as métricas. Se a implementação, o dataset ou os números divergem, `npm test` falha.

<!-- EVALUATION:START -->
Regras avaliadas: **1.0.0**. Resultado calculado pelo comando `npm run evaluate`; as taxas abaixo vêm dos exemplos sintéticos identificados por seed.

| Conjunto | Seed | Séries | Legítimas | Falsos positivos | FPR | Artificiais | Sinalizadas | Detecção artificial | Legítimas inconclusivas | Artificiais inconclusivas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Desenvolvimento | 20260901 | 1500 | 1000 | 9 | 0.90% | 500 | 350 | 70.00% | 0 | 96 |
| Holdout | 20261009 | 1500 | 1000 | 14 | 1.40% | 500 | 350 | 70.00% | 0 | 96 |

**FPR no holdout:** 14/1000 = 1.40%. **Detecção artificial:** 350/500 = 70.00%. Inconclusivos não contam como falso positivo nem como detecção.
**Casos de origem ambígua:** 1/1 receberam a abstenção esperada; eles não entram no denominador da FPR por não terem rótulo único de origem.

**Holdout por família** (falsos positivos em legítimas; artificiais não detectados; inconclusivos):

| Família | Séries | Falsos positivos | Artificiais não detectados | Inconclusivos |
|---|---:|---:|---:|---:|
| crescimento_gradual | 200 | 0 | 0 | 0 |
| viralizacao_explosiva | 200 | 0 | 0 | 0 |
| ondas_organicas | 200 | 0 | 0 | 0 |
| divulgacao_externa | 165 | 0 | 0 | 0 |
| campanha_autorizada_regular | 35 | 14 | 0 | 0 |
| baixo_volume_irregular | 200 | 0 | 0 | 0 |
| bloco_mecanico | 200 | 0 | 0 | 0 |
| pulsos_repetidos | 150 | 0 | 0 | 0 |
| pico_isolado | 100 | 0 | 100 | 96 |
| crescimento_disfarcado | 50 | 0 | 50 | 0 |

Exemplos de falsos positivos: legitimate-campanha_autorizada_regular-003 (campanha_autorizada_regular), legitimate-campanha_autorizada_regular-009 (campanha_autorizada_regular), legitimate-campanha_autorizada_regular-013 (campanha_autorizada_regular), legitimate-campanha_autorizada_regular-030 (campanha_autorizada_regular), legitimate-campanha_autorizada_regular-039 (campanha_autorizada_regular). Exemplos de artificiais não detectados: artificial-pico_isolado-001 (pico_isolado), artificial-pico_isolado-002 (pico_isolado), artificial-pico_isolado-003 (pico_isolado), artificial-pico_isolado-004 (pico_isolado), artificial-pico_isolado-005 (pico_isolado). Os detalhes completos estão em `reports/evaluation.json`.
<!-- EVALUATION:END -->

## Testes

```bash
npm test
npm run typecheck
npm run build
```

Os testes cobrem viralização plausível, um bloco comprado, pulsos repetidos, um pico isolado que exige abstenção, entrada inválida, reprodutibilidade do dataset e igualdade entre as métricas medidas e o README.

## Uso de IA e revisão

O Codex escreveu a API, as regras do classificador, o gerador do dataset, a avaliação, os testes e a documentação, executou as validações e realizou revisão técnica em outra sessão independente. A correção do tratamento de erros HTTP também foi feita com IA e submetida a revisão independente. Minha participação humana foi filtrar prompt injections, definir o escopo e os checkpoints, acompanhar as evidências e solicitar a comparação entre viralização plausível, padrões mecânicos e casos inconclusivos. A escrita do código e a execução automatizada dos testes foram feitas com IA; não declaro revisão humana de cada linha.
