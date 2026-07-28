# PlanejaSalão

Aplicação web estática para criar propostas de montagem do salão do clube, calcular áreas e gerar padrões de mesas e cadeiras.

## Novidades da versão 1.2

- Mesas podem ser clicadas e arrastadas diretamente na planta.
- As cadeiras acompanham a mesa automaticamente durante o movimento.
- Validação manual impede posicionar mesas fora do salão, sobre o palco, cozinha, áreas livres ou outras mesas.
- Cada um dos quatro padrões guarda sua própria montagem manual.
- Botão **Refazer padrão automático** restaura apenas a distribuição das mesas do padrão atual.
- Ferramenta de texto com conteúdo, cor, escala, rotação e posição X/Y.
- Textos também podem ser arrastados diretamente na planta.
- Montagens manuais e textos são salvos no navegador e incluídos no arquivo JSON do projeto.
- Exportação PNG e impressão/PDF incluem a montagem final e os textos, sem marcas de seleção do editor.

## Medidas configuradas

- Salão retangular: 24 m × 22,60 m.
- Largura livre até a cozinha: 22 m.
- Cozinha: largura calculada pela diferença entre a largura total e a largura livre.
- Palco: 4,50 m × 9,40 m.

Todas as medidas podem ser alteradas na barra lateral.

## Como usar

1. Abra `index.html` no navegador ou publique a pasta na Vercel.
2. Informe os dados do evento, medidas, quantidades e dimensões das mesas.
3. Escolha um dos quatro padrões automáticos.
4. Arraste uma mesa pela área central. Todas as cadeiras se movem junto.
5. Use **Adicionar texto** para criar legendas, nomes de setores, buffet, recepção ou observações.
6. Selecione o texto na planta e altere conteúdo, cor, escala, rotação ou coordenadas.
7. Exporte a planta em PNG ou use **Gerar apresentação PDF**.
8. Use **Salvar projeto** para baixar um JSON que preserva também o layout manual.

## Publicação na Vercel

O projeto não possui dependências e não exige etapa de compilação.

- Crie um repositório no GitHub.
- Envie os arquivos desta pasta para a raiz do repositório.
- Na Vercel, clique em **Add New Project** e importe o repositório.
- Não preencha comando de build.
- Publique o projeto.

## Estrutura

- `index.html`: interface.
- `styles.css`: visual e estados do editor.
- `app.js`: cálculos, geração dos padrões, arraste, textos, persistência e exportação.
- `vercel.json`: configuração de publicação estática.
- `referencia-salao.png`: desenho de referência.
- `preview-layout.png`: imagem de apresentação do projeto.

## Observação técnica

A planta é uma estimativa de planejamento. Antes da montagem real, confira portas, saídas de emergência, extintores, rotas acessíveis, capacidade autorizada e exigências do AVCB.
