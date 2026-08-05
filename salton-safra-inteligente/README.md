# Salton Safra Inteligente — demonstração gerencial

Protótipo funcional e independente para estudo de um sistema inteligente de gestão de safra em uma vinícola de grande porte.

> Esta não é uma aplicação oficial da Salton. Todos os dados, integrações, eventos e resultados são fictícios e servem exclusivamente para demonstração conceitual.

## O que funciona nesta versão

- Base fictícia completa da safra 2026.
- Cálculo determinístico de capacidade, ocupação e conflitos por horizonte.
- Cenários de 24, 48 e 72 horas, volume previsto, antecipação do AU-074 e escalonamento de chegadas.
- Agente analítico com respostas explicáveis, contexto de conversa, prioridades, comparações, laboratório, documentos, GLT, produtores, cidades, tanques e lotes.
- Ingestão CSV/JSON com validação, quarentena, idempotência, aprovação e recálculo.
- Memória local no navegador para cenários, decisões e lotes importados.

## Arquitetura desta publicação

O GitHub Pages é uma hospedagem estática. Por isso, esta versão executa o motor e o conector inteiramente no navegador e guarda as alterações apenas no dispositivo do visitante. Nenhuma base, ERP, LIMS, balança, PLC ou sistema real da Salton é acessado.

O código-fonte usado para gerar a demonstração está no subdiretório `source/` desta pasta. Para compilar:

```bash
npm install
npm run build:static
```
