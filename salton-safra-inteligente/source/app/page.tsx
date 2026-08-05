"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { safraDb, SafraDB } from "../lib/safra-data";
import type {
  IngestionBatchView,
  IngestionChannel,
  IngestionEntity,
  IngestionRowView,
} from "../lib/ingestion";
import { apiFetch, isStaticDemo, templateHref } from "../lib/client-api";
import {
  askAgent,
  Decision,
  defaultScenario,
  liters,
  num,
  runEngine,
  Scenario,
  Snapshot,
  tons,
} from "../lib/decision-engine";

type View =
  | "overview"
  | "receiving"
  | "tanks"
  | "engine"
  | "trace"
  | "compliance"
  | "ingestion"
  | "agent";
type DbStatus = "loading" | "d1" | "local" | "fallback";
const nav: [View, string, string][] = [
  ["overview", "Visão geral", "◎"],
  ["receiving", "Recebimento", "⇣"],
  ["tanks", "Tanques & processos", "◌"],
  ["engine", "Motor de decisões", "⌘"],
  ["trace", "Rastreabilidade", "⌁"],
  ["compliance", "Conformidade", "✓"],
  ["ingestion", "Conectores", "⇄"],
  ["agent", "Agente Safra", "✦"],
];
const meta: Record<View, [string, string, string]> = {
  overview: [
    "QUARTA-FEIRA, 18 DE FEVEREIRO",
    "Bom dia, Mariana.",
    "O motor recalculou a safra e priorizou as decisões do próximo turno.",
  ],
  receiving: [
    "CAMPO → VINÍCOLA",
    "Recebimento da safra",
    "Agenda, qualidade e destinação calculadas na mesma base.",
  ],
  tanks: [
    "CAPACIDADE & PROCESSO",
    "Tanques e processos",
    "Ocupação, liberações previstas e compatibilidade de produto.",
  ],
  engine: [
    "CÁLCULO & EXPLICABILIDADE",
    "Motor de decisões",
    "Altere premissas e veja os conflitos serem recalculados.",
  ],
  trace: [
    "ORIGEM → PRODUTO",
    "Genealogia dos lotes",
    "Percorra os vínculos da base fictícia.",
  ],
  compliance: [
    "CONTROLE REGULATÓRIO",
    "Conformidade e SIVIBE",
    "Cobertura calculada por bloco e exceções para revisão humana.",
  ],
  ingestion: [
    "DADOS → DECISÃO",
    "Ingestão operacional",
    "Valide, coloque erros em quarentena e aprove somente dados confiáveis.",
  ],
  agent: [
    "COPILOTO OPERACIONAL",
    "Agente Safra",
    "Pergunte sobre a base; as respostas usam o cenário ativo.",
  ],
};

export default function Home() {
  const demoMode = isStaticDemo();
  const [view, setView] = useState<View>("overview"),
    [scenario, setScenario] = useState<Scenario>(defaultScenario),
    [dismissed, setDismissed] = useState<string[]>([]),
    [toast, setToast] = useState(""),
    [dbStatus, setDbStatus] = useState<DbStatus>("loading"),
    [revision, setRevision] = useState(0);
  const refreshDatabase = useCallback(async () => {
    setDbStatus("loading");
    try {
      const response = await apiFetch("/api/safra", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { db: SafraDB };
      Object.assign(safraDb, payload.db);
      setRevision((value) => value + 1);
      setDbStatus(demoMode ? "local" : "d1");
    } catch {
      setDbStatus("fallback");
    }
  }, [demoMode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshDatabase(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshDatabase]);
  const snap = useMemo(
      () => {
        void revision;
        return runEngine(safraDb, scenario);
      },
      [scenario, revision],
    ),
    decisions = snap.decisions.filter((d) => !dismissed.includes(d.id));
  function notify(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(""), 2600);
  }
  function audit(d: Decision, action: string) {
    void apiFetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisionId: d.id, action, scenario }),
    });
  }
  function act(d: Decision) {
    if (d.action === "early") {
      audit(d, "Aplicar transferência antecipada");
      setScenario((s) => ({ ...s, earlyAU074: true }));
      notify("Cenário recalculado e decisão registrada.");
    } else if (d.action === "smooth") {
      audit(d, "Escalonar chegadas");
      setScenario((s) => ({ ...s, smoothArrivals: true }));
      notify("Chegadas escalonadas e decisão registrada.");
    } else if (d.action === "trace") {
      audit(d, "Abrir genealogia");
      setView("trace");
      notify("Abrindo os lotes incompletos.");
    } else {
      audit(d, "Encaminhar para revisão");
      setDismissed((x) => [...x, d.id]);
      notify("Item registrado para revisão humana.");
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            <strong>SAFRA 360</strong>
            <small>conceito para Salton</small>
          </div>
        </div>
        <nav aria-label="Navegação principal">
          <p className="nav-label">OPERAÇÃO</p>
          {nav.map(([id, label, icon]) => (
            <button
              className={view === id ? "nav-item active" : "nav-item"}
              key={id}
              onClick={() => setView(id)}
              type="button"
            >
              <span>{icon}</span>
              {label}
              {id === "overview" && decisions.length ? (
                <b>{decisions.length}</b>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span
            className={dbStatus === "fallback" ? "live-dot warn" : "live-dot"}
          />
          <div>
            <strong>
              {dbStatus === "local"
                ? "Demonstração autônoma"
                : dbStatus === "d1"
                ? "Banco persistente conectado"
                : dbStatus === "loading"
                  ? "Conectando ao banco"
                  : "Modo de contingência"}
            </strong>
            <small>
              {dbStatus === "local"
                ? "Dados fictícios · memória deste navegador"
                : dbStatus === "d1"
                ? "Cloudflare D1 · safra 2026"
                : dbStatus === "loading"
                  ? "Carregando dados SQL"
                  : "Base local de segurança"}
            </small>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Operação <span>/</span> Safra 2026
          </div>
          <div className="top-actions">
            <span className="sync">
              <i />{" "}
              {dbStatus === "local"
                ? "Demo salva neste navegador"
                : dbStatus === "d1"
                ? "D1 sincronizado"
                : dbStatus === "loading"
                  ? "Sincronizando"
                  : "Contingência local"}
            </span>
            <button className="icon-button" type="button">
              ♢{decisions.length ? <b>{decisions.length}</b> : null}
            </button>
            <div className="avatar">MS</div>
          </div>
        </header>
        <div className="content">
          {demoMode ? (
            <section className="demo-notice" role="note">
              <strong>DEMONSTRAÇÃO GERENCIAL</strong>
              <span>
                Dados e integrações fictícios. Simulações e importações ficam
                somente neste navegador; nenhuma operação real da Salton é
                acessada.
              </span>
            </section>
          ) : null}
          <section className="page-heading">
            <div>
              <p className="eyebrow">{meta[view][0]}</p>
              <h1>{meta[view][1]}</h1>
              <p>{meta[view][2]}</p>
            </div>
            <button
              className="period-selector"
              type="button"
              onClick={() => setView("engine")}
            >
              <span>Cenário ativo</span>
              <strong>{scenario.horizon} horas</strong>
              <i>→</i>
            </button>
          </section>
          {view === "overview" ? (
            <Overview
              snap={snap}
              decisions={decisions}
              setView={setView}
              act={act}
            />
          ) : view === "receiving" ? (
            <Receiving db={safraDb} snap={snap} />
          ) : view === "tanks" ? (
            <Tanks snap={snap} scenario={scenario} setScenario={setScenario} />
          ) : view === "engine" ? (
            <Engine
              db={safraDb}
              snap={snap}
              scenario={scenario}
              setScenario={setScenario}
              act={act}
              dbStatus={dbStatus}
              demoMode={demoMode}
            />
          ) : view === "trace" ? (
            <Trace db={safraDb} />
          ) : view === "compliance" ? (
            <Compliance snap={snap} />
          ) : view === "ingestion" ? (
            <Ingestion
              demoMode={demoMode}
              onCommitted={async () => {
                await refreshDatabase();
                notify("Lote aplicado; motor recalculado com a nova base.");
              }}
            />
          ) : (
            <Agent db={safraDb} snap={snap} scenario={scenario} />
          )}
        </div>
      </main>
      {toast ? (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      ) : null}
    </div>
  );
}

function Overview({
  snap,
  decisions,
  setView,
  act,
}: {
  snap: Snapshot;
  decisions: Decision[];
  setView: (v: View) => void;
  act: (d: Decision) => void;
}) {
  const top = decisions[0],
    records =
      safraDb.receipts.length +
      safraDb.lots.length +
      safraDb.analyses.length +
      safraDb.tanks.length +
      safraDb.orders.length,
    vars = snap.progress.filter((x) =>
      ["Moscato", "Chardonnay", "Merlot", "Tannat"].includes(x.variety),
    );
  return (
    <>
      <section className="agent-brief">
        <div className="agent-orb">✦</div>
        <div className="brief-copy">
          <div className="brief-title">
            <span>RESUMO CALCULADO DO AGENTE</span>
            <i>{num(records)} registros cruzados</i>
          </div>
          <h2>
            {top ? (
              <>
                Há <strong>{decisions.length} decisões</strong>; prioridade:{" "}
                {top.title.toLowerCase()}.
              </>
            ) : (
              <>
                Nenhum conflito relevante no <strong>cenário ativo</strong>.
              </>
            )}
          </h2>
          <p>
            {top?.recommendation ??
              "O motor segue monitorando toda a operação."}
          </p>
        </div>
        <button
          className="ask-agent"
          type="button"
          onClick={() => setView("agent")}
        >
          Perguntar ao agente <span>→</span>
        </button>
      </section>
      <section className="kpi-grid">
        <Kpi
          label="UVA RECEBIDA"
          value={tons(snap.totals.receivedKg)}
          note={`de ${tons(snap.totals.plannedKg)} planejadas`}
          trend={`${num(snap.totals.receivedPct, 1)}% da safra`}
          tone="wine"
        />
        <Kpi
          label="RASTREABILIDADE"
          value={`${num(snap.totals.tracePct, 1)}%`}
          note={`${num(safraDb.lots.length)} lotes avaliados`}
          trend="Calculado vínculo a vínculo"
          tone="green"
        />
        <Kpi
          label="OCUPAÇÃO DE TANQUES"
          value={`${num(snap.totals.occupancyPct, 1)}%`}
          note={`${liters(snap.totals.tankVolume)} em processo`}
          trend={`${snap.decisions.filter((d) => d.category === "Capacidade").length} conflito(s)`}
          tone="amber"
        />
        <Kpi
          label="PRONTIDÃO SIVIBE"
          value={`${num(snap.totals.readinessPct, 1)}%`}
          note="5 blocos reconciliados"
          trend="Rascunho; sem envio"
          tone="blue"
        />
      </section>
      <section className="dashboard-grid">
        <article className="panel decision-panel">
          <PanelHead
            eyebrow="FILA GERADA PELO MOTOR"
            title="O que precisa de ação"
            action={`${decisions.length} decisões`}
          />
          <div className="decision-list">
            {decisions.length ? (
              decisions
                .slice(0, 4)
                .map((d) => <DecisionRow key={d.id} d={d} act={act} />)
            ) : (
              <div className="empty-state">
                <span>✓</span>
                <strong>Fila resolvida</strong>
                <p>Nenhuma regra crítica disparada.</p>
              </div>
            )}
          </div>
        </article>
        <article className="panel receipt-panel">
          <div className="panel-head">
            <div>
              <span>RECEBIMENTO POR VARIEDADE</span>
              <h3>Progresso calculado</h3>
            </div>
            <button type="button" onClick={() => setView("receiving")}>
              Detalhar
            </button>
          </div>
          <div className="receipt-chart">
            {vars.map((x, i) => (
              <div className="receipt-row" key={x.variety}>
                <div className="receipt-label">
                  <strong>{x.variety}</strong>
                  <span>
                    {tons(x.receivedKg)} / {tons(x.plannedKg)}
                  </span>
                </div>
                <div className="bar-track">
                  <i
                    style={{
                      backgroundColor: [
                        "#781f36",
                        "#b67848",
                        "#9b3d50",
                        "#cfaa7d",
                      ][i],
                      width: `${Math.min(100, x.pct)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="unit-split">
            <div>
              <span>RECEBIMENTOS NA BASE</span>
              <strong>{num(safraDb.receipts.length)}</strong>
            </div>
            <div>
              <span>TANQUES CONECTADOS</span>
              <strong>{safraDb.tanks.length}</strong>
            </div>
          </div>
        </article>
      </section>
      <section className="dashboard-grid lower-grid">
        <article className="panel trace-panel">
          <div className="panel-head">
            <div>
              <span>GENEALOGIA EM FOCO</span>
              <h3>SG-260218-038</h3>
            </div>
            <span className="status-badge">Completo</span>
          </div>
          <div className="trace-flow">
            <TraceStep n="01" title="Origem" detail="PR-0147 · Garibaldi" />
            <TraceStep
              n="02"
              title="Recebimento"
              detail="Moscato · 18.420 kg"
            />
            <TraceStep n="03" title="Transformação" detail="Mosto · 12.894 L" />
            <TraceStep
              n="04"
              title="Destino"
              detail="AU-118 · base espumante"
              last
            />
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span>MOTOR DE DECISÕES</span>
              <h3>Cenário operacional ativo</h3>
            </div>
            <span className="all-online">
              <i /> calculando
            </span>
          </div>
          <div className="engine-pulse-grid">
            <div>
              <span>HORIZONTE</span>
              <strong>{snap.scenario.horizon}h</strong>
            </div>
            <div>
              <span>PREVISÃO</span>
              <strong>{snap.scenario.forecastPct}%</strong>
            </div>
            <div>
              <span>ENTRADA</span>
              <strong>{liters(snap.totals.forecastL)}</strong>
            </div>
            <div>
              <span>REGRAS</span>
              <strong>14</strong>
            </div>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => setView("engine")}
          >
            Abrir cálculo e premissas
          </button>
        </article>
      </section>
      <Concept />
    </>
  );
}

function Receiving({ db, snap }: { db: SafraDB; snap: Snapshot }) {
  const loads = db.receipts.filter((r) => r.kind === "forecast").slice(0, 10),
    [id, setId] = useState(loads[0].id),
    [released, setReleased] = useState<string[]>([]),
    selected = loads.find((x) => x.id === id) ?? loads[0],
    producer = db.producers.find((p) => p.id === selected.producerId),
    candidate = snap.tanks
      .filter((t) => t.varieties.includes(selected.variety))
      .sort((a, b) => b.available - a.available)[0],
    next6 = db.receipts.filter((r) => r.kind === "forecast" && r.hour <= 6),
    peak = Math.max(
      ...snap.hourly.slice(0, 8).map((x) => Math.max(x.tons, x.capacity)),
    );
  return (
    <div className="module-stack">
      <section className="metric-strip">
        <Mini
          label="RECEBIDO HOJE"
          value={tons(snap.totals.todayKg)}
          note={`${db.receipts.filter((r) => r.kind === "received" && r.hour >= -12).length} cargas`}
        />
        <Mini
          label="PRÓXIMAS 6H"
          value={tons(next6.reduce((a, r) => a + r.kg, 0))}
          note={`${next6.length} cargas previstas`}
        />
        <Mini
          label="CAPACIDADE DE DOCAS"
          value={`${num(db.units.reduce((a, u) => a + u.dockTons3h, 0))} t / 3h`}
          note="duas unidades"
          good
        />
        <Mini
          label="ANÁLISES PENDENTES"
          value={`${db.analyses.filter((a) => a.status !== "Aprovado").length}`}
          note="priorizadas por SLA"
          warn
        />
      </section>
      <section className="module-grid wide-left">
        <article className="panel data-panel">
          <div className="panel-head">
            <div>
              <span>AGENDA OPERACIONAL</span>
              <h3>Próximos recebimentos</h3>
            </div>
            <span className="live-label">
              <i /> base calculada
            </span>
          </div>
          <div className="data-table">
            <div className="table-row table-head">
              <span>Janela / carga</span>
              <span>Origem</span>
              <span>Variedade</span>
              <span>Peso</span>
              <span>Status</span>
            </div>
            {loads.map((r) => (
              <button
                type="button"
                className={
                  r.id === selected.id ? "table-row selected" : "table-row"
                }
                key={r.id}
                onClick={() => setId(r.id)}
              >
                <span>
                  <strong>+{num(r.hour, 1)}h</strong>
                  <small>{r.id}</small>
                </span>
                <span>
                  <strong>{r.producerId}</strong>
                  <small>
                    {db.producers.find((p) => p.id === r.producerId)?.city}
                  </small>
                </span>
                <span>{r.variety}</span>
                <span>{tons(r.kg)}</span>
                <span>
                  <i className="table-status route" />
                  {released.includes(r.id) ? "Pré-liberado" : r.status}
                </span>
              </button>
            ))}
          </div>
        </article>
        <article className="panel inspect-panel">
          <div className="panel-head">
            <div>
              <span>CARGA SELECIONADA</span>
              <h3>{selected.id}</h3>
            </div>
            <span className="tag neutral">{selected.variety}</span>
          </div>
          <div className="inspection-hero">
            <div>
              <small>PESO PREVISTO</small>
              <strong>{tons(selected.kg)}</strong>
            </div>
            <div>
              <small>AÇÚCARES</small>
              <strong>{num(selected.brix, 1)} °Bx</strong>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Origem</dt>
              <dd>
                {producer?.name} · {producer?.city}
              </dd>
            </div>
            <div>
              <dt>Documentação</dt>
              <dd>
                {selected.docs ? (
                  <>
                    <span className="check-dot">✓</span> Conferida
                  </>
                ) : (
                  <>
                    <span className="warn-dot">!</span> Pendente
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Destino calculado</dt>
              <dd>
                {candidate
                  ? `${candidate.id} · ${liters(candidate.available)} disponíveis`
                  : "Sem tanque compatível"}
              </dd>
            </div>
            <div>
              <dt>Rendimento</dt>
              <dd>{liters(selected.kg * 0.7)} previstos</dd>
            </div>
          </dl>
          <button
            className="primary-action"
            type="button"
            onClick={() =>
              setReleased((x) =>
                x.includes(selected.id) ? x : [...x, selected.id],
              )
            }
          >
            {released.includes(selected.id)
              ? "✓ Pré-liberação registrada"
              : "Registrar pré-liberação"}
          </button>
          <p className="human-note">
            A descarga definitiva exige análise e aprovação humana.
          </p>
        </article>
      </section>
      <section className="module-grid equal">
        <article className="panel">
          <PanelHead
            eyebrow="PREVISÃO EM JANELAS DE 3H"
            title="Chegadas versus docas"
            action={`${snap.scenario.horizon}h`}
          />
          <div className="hour-chart">
            {snap.hourly.slice(0, 8).map((x) => (
              <div key={x.start}>
                <i
                  className={x.over ? "hot" : ""}
                  style={{ height: `${Math.max(5, (x.tons / peak) * 100)}%` }}
                />
                <span>+{x.start}h</span>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-cap" /> capacidade {snap.hourly[0]?.capacity}{" "}
              t
            </span>
            <span>
              <i className="legend-bar" /> volume calculado
            </span>
          </div>
        </article>
        <article className="panel">
          <PanelHead
            eyebrow="QUALIDADE"
            title="Indicadores acumulados"
            action="Safra 2026"
          />
          <div className="quality-list">
            <Quality
              name="Serra Gaúcha"
              brix="19,2 °Bx"
              pct="97,4%"
              score={97.4}
            />
            <Quality
              name="Campanha Gaúcha"
              brix="19,8 °Bx"
              pct="98,1%"
              score={98.1}
            />
          </div>
        </article>
      </section>
    </div>
  );
}

function Tanks({
  snap,
  scenario,
  setScenario,
}: {
  snap: Snapshot;
  scenario: Scenario;
  setScenario: React.Dispatch<React.SetStateAction<Scenario>>;
}) {
  const [id, setId] = useState("AU-074"),
    [family, setFamily] = useState("Todos"),
    visible = snap.tanks
      .filter((t) => family === "Todos" || t.family === family)
      .slice(0, 12),
    selected = snap.tanks.find((t) => t.id === id) ?? snap.tanks[0],
    d = snap.decisions.find((x) => x.category === "Capacidade"),
    available = snap.pools.reduce((a, p) => a + p.available, 0);
  return (
    <div className="module-stack">
      <section className="agent-recommendation">
        <div className="agent-orb small">✦</div>
        <div>
          <span>RECOMENDAÇÃO CALCULADA</span>
          <strong>
            {d?.recommendation ?? "A capacidade cobre o horizonte ativo."}
          </strong>
          <p>
            {d?.formula ??
              `${liters(available)} disponíveis para ${liters(snap.totals.forecastL)} previstos.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setScenario((s) => ({ ...s, earlyAU074: !s.earlyAU074 }))
          }
        >
          {scenario.earlyAU074 ? "✓ AU-074 antecipado" : "Simular AU-074"}
        </button>
      </section>
      <section className="metric-strip">
        <Mini
          label="CAPACIDADE TOTAL"
          value={liters(snap.totals.tankCapacity)}
          note={`${snap.tanks.length} tanques`}
        />
        <Mini
          label="EM PROCESSO"
          value={liters(snap.totals.tankVolume)}
          note={`${num(snap.totals.occupancyPct, 1)}% de ocupação`}
        />
        <Mini
          label={`LIVRE EM ${scenario.horizon}H`}
          value={liters(available)}
          note="compatível e não reservado"
          good
        />
        <Mini
          label="CONFLITOS"
          value={`${snap.decisions.filter((x) => x.category === "Capacidade").length}`}
          note="recalculados"
          warn
        />
      </section>
      <section className="module-grid wide-left">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span>MAPA DE TANQUES</span>
              <h3>Ativos principais</h3>
            </div>
            <div className="filter-pills">
              {["Todos", "Espumante", "Tinto", "Branco"].map((f) => (
                <button
                  type="button"
                  className={family === f ? "active" : ""}
                  onClick={() => setFamily(f)}
                  key={f}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="tank-grid">
            {visible.map((t) => (
              <button
                className={
                  selected.id === t.id ? "tank-card selected" : "tank-card"
                }
                key={t.id}
                type="button"
                onClick={() => setId(t.id)}
              >
                <div className="tank-top">
                  <strong>{t.id}</strong>
                  <span className={`tag ${tone(t)}`}>
                    {t.temperature === "attention" ? "Atenção" : t.status}
                  </span>
                </div>
                <div className="tank-visual">
                  <i style={{ height: `${t.fillPct}%` }} className={tone(t)} />
                  <b>{num(t.fillPct)}%</b>
                </div>
                <p>{t.product}</p>
                <small>{liters(t.volume)}</small>
              </button>
            ))}
          </div>
        </article>
        <article className="panel tank-detail">
          <div className="panel-head">
            <div>
              <span>ATIVO SELECIONADO</span>
              <h3>{selected.id}</h3>
            </div>
            <span className={`tag ${tone(selected)}`}>{selected.status}</span>
          </div>
          <div className="tank-big">
            <div
              className="tank-big-fill"
              style={{ height: `${selected.fillPct}%` }}
            />
            <strong>{num(selected.fillPct, 1)}%</strong>
            <span>{liters(selected.volume)}</span>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Produto</dt>
              <dd>{selected.product}</dd>
            </div>
            <div>
              <dt>Livre agora</dt>
              <dd>{liters(selected.freeNow)}</dd>
            </div>
            <div>
              <dt>No horizonte</dt>
              <dd>{liters(selected.available)}</dd>
            </div>
            <div>
              <dt>Temperatura</dt>
              <dd>
                {selected.temp === null
                  ? "Sem leitura"
                  : `${num(selected.temp, 1)} °C`}
              </dd>
            </div>
            <div>
              <dt>Liberação</dt>
              <dd>
                {selected.effectiveRelease === null
                  ? "Já higienizado"
                  : `+${selected.effectiveRelease}h + ${selected.cipHours}h CIP`}
              </dd>
            </div>
          </dl>
          <p className="human-note">
            O motor não altera PLC, setpoint ou válvula.
          </p>
        </article>
      </section>
    </div>
  );
}

function Engine({
  db,
  snap,
  scenario,
  setScenario,
  act,
  dbStatus,
  demoMode,
}: {
  db: SafraDB;
  snap: Snapshot;
  scenario: Scenario;
  setScenario: React.Dispatch<React.SetStateAction<Scenario>>;
  act: (d: Decision) => void;
  dbStatus: DbStatus;
  demoMode: boolean;
}) {
  const [saveState, setSaveState] = useState<
      "idle" | "saving" | "saved" | "error"
    >("idle"),
    [savedId, setSavedId] = useState<number | null>(null);
  const min = Math.min(...snap.pools.map((p) => p.balance)),
    max = Math.max(
      ...snap.timeline.flatMap((x) => [x.incoming, x.available]),
      1,
    );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSaveState("idle");
      setSavedId(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scenario]);

  async function persistScenario() {
    if (!["d1", "local"].includes(dbStatus)) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    try {
      const response = await apiFetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Cenário ${scenario.horizon}h · ${scenario.forecastPct}%`,
          scenario,
        }),
      });
      if (!response.ok) throw new Error("Falha ao salvar o cenário");
      const payload = (await response.json()) as { id: number };
      setSavedId(payload.id);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="module-stack">
      <section className="engine-console">
        <div className="engine-status">
          <div className="agent-orb">⌘</div>
          <div>
            <span>MOTOR V2 · CÁLCULO DETERMINÍSTICO</span>
            <h2>
              {snap.decisions.length} decisões para as próximas{" "}
              {scenario.horizon} horas
            </h2>
            <p>
              Resultados derivados dos registros e premissas visíveis; nenhuma
              ação física é executada.
            </p>
          </div>
          <div className="engine-health">
            <i />{" "}
            {dbStatus === "local"
              ? "Memória deste navegador"
              : dbStatus === "d1"
                ? "D1 persistente"
                : dbStatus === "loading"
                  ? "Conectando ao D1"
                  : "Contingência local"}
          </div>
        </div>
        <div className="scenario-controls">
          <label>
            <span>Horizonte</span>
            <div className="segmented">
              {([24, 48, 72] as const).map((h) => (
                <button
                  type="button"
                  className={scenario.horizon === h ? "active" : ""}
                  onClick={() => setScenario((s) => ({ ...s, horizon: h }))}
                  key={h}
                >
                  {h}h
                </button>
              ))}
            </div>
          </label>
          <label className="range-control">
            <span>
              Volume previsto <b>{scenario.forecastPct}%</b>
            </span>
            <input
              type="range"
              min="85"
              max="125"
              step="5"
              value={scenario.forecastPct}
              onChange={(e) =>
                setScenario((s) => ({ ...s, forecastPct: +e.target.value }))
              }
            />
          </label>
          <Switch
            label="Antecipar AU-074"
            note="liberação em +8h"
            checked={scenario.earlyAU074}
            onChange={(v) => setScenario((s) => ({ ...s, earlyAU074: v }))}
          />
          <Switch
            label="Escalonar chegadas"
            note="redistribui picos"
            checked={scenario.smoothArrivals}
            onChange={(v) => setScenario((s) => ({ ...s, smoothArrivals: v }))}
          />
          <div className="scenario-actions">
            <button
              className="save-scenario"
              type="button"
              onClick={persistScenario}
              disabled={
                !["d1", "local"].includes(dbStatus) || saveState === "saving"
              }
            >
              {saveState === "saving"
                ? "Salvando…"
                : saveState === "saved"
                  ? `✓ Cenário #${savedId}`
                  : saveState === "error"
                    ? "Armazenamento indisponível"
                    : demoMode
                      ? "Salvar neste navegador"
                      : "Salvar no banco"}
            </button>
            <button
              className="reset-scenario"
              type="button"
              onClick={() => setScenario(defaultScenario)}
            >
              Restaurar base
            </button>
          </div>
        </div>
      </section>
      <section className="metric-strip">
        <Mini
          label="MOSTO PREVISTO"
          value={liters(snap.totals.forecastL)}
          note={tons(snap.totals.forecastKg)}
        />
        <Mini
          label="CAPACIDADE COMPATÍVEL"
          value={liters(snap.pools.reduce((a, p) => a + p.available, 0))}
          note="livre + liberações"
          good
        />
        <Mini
          label="PIOR SALDO"
          value={liters(min)}
          note={min < 0 ? "déficit por família" : "famílias cobertas"}
          warn={min < 0}
          good={min >= 0}
        />
        <Mini
          label="DECISÕES"
          value={`${snap.decisions.length}`}
          note={`${snap.decisions.filter((d) => d.level === "critical").length} críticas`}
          warn
        />
      </section>
      <section className="module-grid engine-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span>BALANÇO POR FAMÍLIA</span>
              <h3>Entrada × capacidade</h3>
            </div>
            <span className="tag neutral">margem 5%</span>
          </div>
          <div className="capacity-table">
            <div className="capacity-row capacity-head">
              <span>Família</span>
              <span>Entrada</span>
              <span>Disponível</span>
              <span>Saldo</span>
              <span>Uso</span>
            </div>
            {snap.pools.map((p) => (
              <div className="capacity-row" key={p.family}>
                <strong>{p.family}</strong>
                <span>{liters(p.incoming)}</span>
                <span>{liters(p.available)}</span>
                <b className={p.balance < 0 ? "negative" : "positive"}>
                  {liters(p.balance)}
                </b>
                <div className="mini-bar">
                  <i
                    className={p.usePct > 100 ? "hot" : ""}
                    style={{ width: `${Math.min(100, p.usePct)}%` }}
                  />
                  <small>{num(p.usePct)}%</small>
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span>LINHA DO TEMPO</span>
              <h3>Saldo acumulado</h3>
            </div>
            <span className="tag neutral">a cada 6h</span>
          </div>
          <div className="timeline-chart">
            {snap.timeline.map((x) => (
              <div className="timeline-column" key={x.hour}>
                <div className="timeline-bars">
                  <i
                    className="capacity"
                    style={{ height: `${(x.available / max) * 100}%` }}
                  />
                  <i
                    className="inbound"
                    style={{ height: `${(x.incoming / max) * 100}%` }}
                  />
                </div>
                <span>{x.label}</span>
                <small className={x.balance < 0 ? "negative" : "positive"}>
                  {x.balance < 0 ? "−" : "+"}
                  {liters(Math.abs(x.balance)).replace(" L", "")}
                </small>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-cap solid" /> capacidade
            </span>
            <span>
              <i className="legend-bar" /> entrada
            </span>
          </div>
        </article>
      </section>
      <section className="module-grid engine-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span>DECISÕES EXPLICÁVEIS</span>
              <h3>Regras disparadas</h3>
            </div>
            <span className="live-label">
              <i /> recalculado
            </span>
          </div>
          <div className="engine-decisions">
            {snap.decisions.map((d) => (
              <article className="engine-decision" key={d.id}>
                <div className="engine-decision-head">
                  <span className={`severity ${d.level}`} />
                  <div>
                    <small>{d.category}</small>
                    <strong>{d.title}</strong>
                  </div>
                  <span className={`decision-level ${d.level}`}>
                    {d.level === "critical"
                      ? "Crítica"
                      : d.level === "warning"
                        ? "Atenção"
                        : "Informativa"}
                  </span>
                </div>
                <p>{d.detail}</p>
                <div className="formula-box">
                  <span>CÁLCULO</span>
                  <strong>{d.formula}</strong>
                </div>
                <details>
                  <summary>Ver evidências e impacto</summary>
                  <ul>
                    {d.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  <p>
                    <b>Recomendação:</b> {d.recommendation}
                  </p>
                  <p>
                    <b>Impacto:</b> {d.impact}
                  </p>
                </details>
                {d.action ? (
                  <button type="button" onClick={() => act(d)}>
                    Aplicar sugestão ao cenário
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </article>
        <article className="panel database-panel">
          <div className="panel-head">
            <div>
              <span>BASE FICTÍCIA DA SAFRA</span>
              <h3>Catálogo conectado</h3>
            </div>
            <span className="status-badge">
              {dbStatus === "local"
                ? "demo local ativa"
                : dbStatus === "d1"
                  ? "D1 conectado"
                  : "contingência"}
            </span>
          </div>
          <div className="database-counts">
            <DB label="Produtores" value={db.producers.length} />
            <DB label="Talhões" value={db.blocks.length} />
            <DB label="Recebimentos" value={db.receipts.length} />
            <DB label="Análises" value={db.analyses.length} />
            <DB label="Lotes" value={db.lots.length} />
            <DB label="Tanques" value={db.tanks.length} />
            <DB label="Ordens" value={db.orders.length} />
            <DB label="Regras" value={14} />
          </div>
          <div className="data-model-note">
            <span>
              {demoMode
                ? "MODELO DEMONSTRATIVO NO NAVEGADOR"
                : "MODELO RELACIONAL PERSISTENTE"}
            </span>
            <p>
              Produtor → talhão → recebimento → análise → lote → ordem → tanque.
              {demoMode
                ? " Dados fictícios, simulações, importações e trilha de decisões ficam isolados neste dispositivo."
                : " Doze tabelas SQL, APIs e trilha de decisões sustentam os cálculos do agente."}
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function Trace({ db }: { db: SafraDB }) {
  const [q, setQ] = useState(""),
    initial = db.lots.find((l) => l.id === "SG-260218-038") ?? db.lots[0],
    [id, setId] = useState(initial.id),
    [impact, setImpact] = useState(false),
    selected = db.lots.find((l) => l.id === id) ?? initial,
    r = db.receipts.find((x) => x.id === selected.receiptId),
    p = db.producers.find((x) => x.id === selected.producerId),
    t = db.tanks.find((x) => x.id === selected.tankId);
  const list = useMemo(() => {
    const n = q.toLowerCase().trim(),
      m = db.lots.filter((l) => {
        const p = db.producers.find((x) => x.id === l.producerId);
        return `${l.id} ${l.variety} ${p?.name} ${p?.city}`
          .toLowerCase()
          .includes(n);
      });
    return (
      n
        ? m
        : [initial, ...db.lots.filter((l) => !l.complete), ...db.lots].filter(
            (x, i, a) => a.findIndex((y) => y.id === x.id) === i,
          )
    ).slice(0, n ? 24 : 10);
  }, [q, db, initial]);
  return (
    <div className="module-stack">
      <section className="search-hero">
        <div>
          <span>BUSCA NA BASE COMPLETA</span>
          <h2>Lote, produtor, cidade ou variedade</h2>
        </div>
        <label>
          <span>⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ex.: SG-260218-038 ou Moscato"
          />
        </label>
      </section>
      <section className="module-grid trace-layout">
        <article className="panel lot-list">
          <div className="panel-head">
            <div>
              <span>RESULTADOS</span>
              <h3>
                {list.length} {q ? "encontrados" : "priorizados"}
              </h3>
            </div>
            <span className="tag neutral">{num(db.lots.length)} lotes</span>
          </div>
          {list.map((l) => (
            <button
              key={l.id}
              className={selected.id === l.id ? "lot-row selected" : "lot-row"}
              onClick={() => {
                setId(l.id);
                setImpact(false);
              }}
              type="button"
            >
              <span className={`lot-status ${l.complete ? "ok" : "warn"}`} />
              <div>
                <strong>{l.id}</strong>
                <small>
                  {l.variety} · {liters(l.liters)}
                </small>
              </div>
              <div>
                <span>
                  {db.producers.find((x) => x.id === l.producerId)?.city}
                </span>
                <small>Destino: {l.tankId ?? "Pendente"}</small>
              </div>
              <b>›</b>
            </button>
          ))}
        </article>
        <article className="panel lineage-panel">
          <div className="panel-head">
            <div>
              <span>GENEALOGIA DO LOTE</span>
              <h3>{selected.id}</h3>
            </div>
            <span className={selected.complete ? "status-badge" : "tag amber"}>
              {selected.complete ? "Completo" : "Atenção"}
            </span>
          </div>
          <div className="lineage-vertical">
            <Lineage
              n="01"
              label="Origem e talhão"
              value={`${p?.name} · ${p?.city}`}
              detail={`${r?.blockId} · ${p?.region}`}
            />
            <Lineage
              n="02"
              label="Recebimento e laboratório"
              value={`${selected.variety} · ${tons(r?.kg ?? 0)}`}
              detail={`${num(r?.brix ?? 0, 1)} °Bx · ${r?.lab}`}
            />
            <Lineage
              n="03"
              label="Transformação"
              value={`${selected.stage} · ${liters(selected.liters)}`}
              detail={`${db.orders.filter((o) => o.lotId === selected.id).length} ordem(ns)`}
            />
            <Lineage
              n="04"
              label="Destino atual"
              value={
                selected.tankId
                  ? `${selected.tankId} · ${t?.product}`
                  : "Associação pendente"
              }
              detail={
                selected.tankId
                  ? `${liters(t?.volume ?? 0)} no recipiente`
                  : "Bloqueio ativo"
              }
            />
            <Lineage
              n="05"
              label="Produto futuro"
              value={selected.future}
              detail="Lote de envase ainda não confirmado"
              last
            />
          </div>
          <div className="impact-box">
            <div>
              <span>ANÁLISE DE IMPACTO</span>
              <strong>
                {impact
                  ? `${db.orders.filter((o) => o.lotId === selected.id).length} ordens e 1 tanque relacionados`
                  : "Simule um bloqueio"}
              </strong>
              <p>
                {impact
                  ? "Nenhum produto expedido; impacto restrito à elaboração."
                  : "Percorre vínculos sem alterar registros."}
              </p>
            </div>
            <button type="button" onClick={() => setImpact(true)}>
              {impact ? "✓ Impacto calculado" : "Calcular impacto"}
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}

function Compliance({ snap }: { snap: Snapshot }) {
  const [draft, setDraft] = useState(false),
    exceptions = snap.decisions
      .filter((d) =>
        ["Regulatório", "Rastreabilidade", "Qualidade"].includes(d.category),
      )
      .slice(0, 4);
  return (
    <div className="module-stack">
      <section className="compliance-hero">
        <div
          className="readiness-ring"
          style={{
            background: `conic-gradient(var(--green) 0 ${snap.totals.readinessPct}%,#e8e2dc ${snap.totals.readinessPct}%)`,
          }}
        >
          <strong>{num(snap.totals.readinessPct, 1)}%</strong>
          <span>pronto</span>
        </div>
        <div>
          <span>PRONTIDÃO CALCULADA</span>
          <h2>
            Cinco blocos reconciliados; {exceptions.length} exceções
            prioritárias.
          </h2>
          <p>
            O rascunho usa recebimentos, genealogia e estoque. Revisão e envio
            continuam humanos.
          </p>
        </div>
        <button type="button" onClick={() => setDraft(true)}>
          {draft ? "✓ Rascunho preparado" : "Preparar rascunho"}
        </button>
      </section>
      <section className="module-grid equal">
        <article className="panel">
          <PanelHead
            eyebrow="CHECKLIST SIVIBE"
            title="Cobertura calculada"
            action="Safra 2026"
          />
          <div className="compliance-list">
            {snap.compliance.map((c) => (
              <div key={c.label}>
                <span
                  className={
                    c.pct >= 99.5 ? "check-icon ok" : "check-icon wait"
                  }
                >
                  {c.pct >= 99.5 ? "✓" : "!"}
                </span>
                <div>
                  <strong>{c.label}</strong>
                  <small>{c.state}</small>
                </div>
                <b>{num(c.pct, 1)}%</b>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <PanelHead
            eyebrow="EXCEÇÕES ABERTAS"
            title="O que impede 100%"
            action={`${exceptions.length} grupos`}
          />
          {exceptions.map((d) => (
            <div className="exception" key={d.id}>
              <span className={`severity ${d.level}`} />
              <div>
                <strong>{d.title}</strong>
                <p>{d.detail}</p>
                <small>{d.owner}</small>
              </div>
              <button type="button">Revisar</button>
            </div>
          ))}
        </article>
      </section>
      <section className="panel governance-panel">
        <div>
          <span>GUARDRAIL REGULATÓRIO</span>
          <h3>O agente calcula e prepara; a empresa revisa e declara.</h3>
          <p>O conceito não acessa nem envia dados ao SIVIBE.</p>
        </div>
        <a
          href="https://sistemasweb4.agricultura.gov.br/sivibe/paginaInicial.action"
          target="_blank"
          rel="noreferrer"
        >
          Sistema oficial ↗
        </a>
      </section>
    </div>
  );
}

const ingestSources: Array<{
  id: string;
  entity: IngestionEntity;
  title: string;
  detail: string;
  icon: string;
}> = [
  {
    id: "scale-tuiuty",
    entity: "receipt",
    title: "Balança e recebimento",
    detail: "Cargas, peso, origem e janela",
    icon: "⇣",
  },
  {
    id: "lims-quality",
    entity: "lab",
    title: "Laboratório · LIMS",
    detail: "Brix, acidez, pH e liberação",
    icon: "⌬",
  },
];
function ingestExample(entity: IngestionEntity, channel: IngestionChannel) {
  if (channel === "csv")
    return entity === "receipt"
      ? "id;unidade;produtor_id;talhao_id;variedade;peso_kg;hora_offset;brix;acidez;tipo;documentos;glt\nIMP-REC-0001;TU;PR-0147;TL-0147-1;Moscato;19480;5,5;19,2;6,3;forecast;sim;N/A\nIMP-REC-0002;AD;PR-0312;TL-0312-1;Tannat;22800;8;20,7;6,1;forecast;sim;Vinculada"
      : "id;recebimento_id;brix;acidez;ph;status;tempo_minutos\nIMP-LAB-0001;REC-26184;19,1;6,8;3,18;Aprovado;26\nIMP-LAB-0002;REC-25972;20,9;6,0;3,32;Aprovado;22";
  return JSON.stringify(
    entity === "receipt"
      ? [
          {
            id: "IMP-REC-JSON-01",
            unidade: "TU",
            produtor_id: "PR-0147",
            talhao_id: "TL-0147-1",
            variedade: "Moscato",
            peso_kg: 20100,
            hora_offset: 11.5,
            brix: 19.4,
            acidez: 6.2,
            tipo: "forecast",
            documentos: true,
            glt: "N/A",
          },
        ]
      : [
          {
            id: "IMP-LAB-JSON-01",
            recebimento_id: "REC-26184",
            brix: 19.3,
            acidez: 6.7,
            ph: 3.2,
            status: "Aprovado",
            tempo_minutos: 24,
          },
        ],
    null,
    2,
  );
}
const batchLabel = (status: IngestionBatchView["status"]) =>
  status === "committed"
    ? "Aplicado"
    : status === "quarantined"
      ? "Em quarentena"
      : "Validado";
const rowLabel = (status: IngestionRowView["status"]) =>
  status === "valid"
    ? "Válida"
    : status === "warning"
      ? "Revisar"
      : status === "duplicate"
        ? "Duplicada"
        : "Erro";
function ingestValue(row: IngestionRowView, keys: string[]) {
  const source = (row.normalized ?? row.payload) as unknown as Record<
    string,
    unknown
  >;
  const key = keys.find((item) => source[item] !== undefined),
    value = key ? source[key] : "—";
  return typeof value === "number" ? num(value, 1) : String(value ?? "—");
}
function Ingestion({
  onCommitted,
  demoMode,
}: {
  onCommitted: () => Promise<void> | void;
  demoMode: boolean;
}) {
  const [sourceId, setSourceId] = useState("scale-tuiuty"),
    [channel, setChannel] = useState<IngestionChannel>("csv"),
    [content, setContent] = useState(ingestExample("receipt", "csv")),
    [fileName, setFileName] = useState("exemplo-recebimentos.csv"),
    [batch, setBatch] = useState<IngestionBatchView | null>(null),
    [history, setHistory] = useState<IngestionBatchView[]>([]),
    [busy, setBusy] = useState<"" | "validate" | "commit">(""),
    [error, setError] = useState("");
  const selected =
    ingestSources.find((item) => item.id === sourceId) ?? ingestSources[0];
  const loadHistory = useCallback(async () => {
    try {
      const response = await apiFetch("/api/ingestion", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        batches?: IngestionBatchView[];
      };
      if (response.ok) setHistory(payload.batches ?? []);
    } catch {}
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);
  function chooseSource(id: string) {
    const next = ingestSources.find((item) => item.id === id)!;
    setSourceId(id);
    setContent(ingestExample(next.entity, channel));
    setFileName(
      `exemplo-${next.entity === "receipt" ? "recebimentos" : "laboratorio"}.${channel}`,
    );
    setBatch(null);
    setError("");
  }
  function chooseChannel(next: IngestionChannel) {
    setChannel(next);
    setContent(ingestExample(selected.entity, next));
    setFileName(
      `exemplo-${selected.entity === "receipt" ? "recebimentos" : "laboratorio"}.${next}`,
    );
    setBatch(null);
    setError("");
  }
  async function selectFile(file?: File) {
    if (!file) return;
    setChannel("csv");
    setFileName(file.name);
    setContent(await file.text());
    setBatch(null);
    setError("");
  }
  async function validate() {
    if (!content.trim())
      return setError("Adicione um arquivo ou payload antes de validar.");
    setBusy("validate");
    setError("");
    try {
      const response = await apiFetch("/api/ingestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          entityKind: selected.entity,
          channel,
          fileName,
          content,
        }),
      });
      const payload = (await response.json()) as {
        batch?: IngestionBatchView;
        error?: string;
      };
      if (!response.ok || !payload.batch)
        throw new Error(payload.error || "Falha ao validar.");
      setBatch(payload.batch);
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao validar.");
    } finally {
      setBusy("");
    }
  }
  async function commit() {
    if (!batch) return;
    setBusy("commit");
    setError("");
    try {
      const response = await apiFetch(
        `/api/ingestion/${batch.id}/commit`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        batch?: IngestionBatchView;
        error?: string;
      };
      if (!response.ok || !payload.batch)
        throw new Error(payload.error || "Falha ao aplicar.");
      setBatch(payload.batch);
      await onCommitted();
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao aplicar.");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="module-stack ingestion-module">
      <section className="ingestion-hero">
        <div>
          <span>
            PIPELINE CONTROLADO · {demoMode ? "DEMO LOCAL" : "D1"}
          </span>
          <h2>Dados novos não entram diretamente na operação.</h2>
          <p>
            Cada envio ganha identidade, validação, quarentena e aprovação
            humana antes de recalcular capacidade e conflitos.
          </p>
        </div>
        <div className="pipeline-steps">
          {[
            ["01", "Receber"],
            ["02", "Validar"],
            ["03", "Aprovar"],
            ["04", "Recalcular"],
          ].map(([n, label], index) => (
            <div key={n}>
              <i>{n}</i>
              <span>{label}</span>
              {index < 3 ? <b>→</b> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="connector-source-grid">
        {ingestSources.map((source) => (
          <button
            key={source.id}
            type="button"
            className={
              sourceId === source.id ? "source-card active" : "source-card"
            }
            onClick={() => chooseSource(source.id)}
          >
            <i>{source.icon}</i>
            <span>
              <small>FONTE OPERACIONAL</small>
              <strong>{source.title}</strong>
              <em>{source.detail}</em>
            </span>
            <b>
              <u /> ativa
            </b>
          </button>
        ))}
        <div className="source-card planned">
          <i>◇</i>
          <span>
            <small>PRÓXIMA INTEGRAÇÃO</small>
            <strong>ERP / SAP</strong>
            <em>Ordens, estoque e cadastro mestre</em>
          </span>
          <b>mapeada</b>
        </div>
      </section>
      <section className="ingestion-workspace">
        <article className="panel ingestion-input-panel">
          <div className="panel-head">
            <div>
              <span>ENTRADA CONTROLADA</span>
              <h3>{selected.title}</h3>
            </div>
            <div className="channel-tabs">
              <button
                type="button"
                className={channel === "csv" ? "active" : ""}
                onClick={() => chooseChannel("csv")}
              >
                Arquivo CSV
              </button>
              <button
                type="button"
                className={channel === "json" ? "active" : ""}
                onClick={() => chooseChannel("json")}
              >
                Payload JSON
              </button>
            </div>
          </div>
          {channel === "csv" ? (
            <label className="file-drop">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void selectFile(event.target.files?.[0])}
              />
              <span>⇧</span>
              <div>
                <strong>{fileName}</strong>
                <small>Até 500 linhas · vírgula ou ponto e vírgula</small>
              </div>
              <em>Escolher arquivo</em>
            </label>
          ) : (
            <div className="endpoint-note">
              <span>POST</span>
              <code>/api/ingestion</code>
              <small>com idempotência</small>
            </div>
          )}
          <label className="payload-editor">
            <span>
              {channel === "csv"
                ? "CONTEÚDO DO ARQUIVO"
                : "CORPO DA REQUISIÇÃO"}
              <a
                href={templateHref(selected.entity)}
                download
              >
                Baixar modelo
              </a>
            </span>
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setBatch(null);
              }}
              spellCheck={false}
            />
          </label>
          {error ? <p className="ingestion-error">! {error}</p> : null}
          <div className="ingestion-input-actions">
            <p>
              Nenhuma linha altera a safra nesta etapa. O lote é apenas
              preparado e auditado.
            </p>
            <button type="button" onClick={validate} disabled={!!busy}>
              {busy === "validate" ? "Validando…" : "Validar lote"}
            </button>
          </div>
        </article>
        <article className="panel validation-panel">
          <div className="panel-head">
            <div>
              <span>RESULTADO DA VALIDAÇÃO</span>
              <h3>{batch ? `Lote #${batch.id}` : "Aguardando dados"}</h3>
            </div>
            {batch ? (
              <span className={`batch-status ${batch.status}`}>
                {batchLabel(batch.status)}
              </span>
            ) : (
              <span className="tag neutral">sem alterações</span>
            )}
          </div>
          {batch ? (
            <>
              {batch.repeated ? (
                <div className="idempotency-note">
                  ↺ Mesmo conteúdo reconhecido; o lote anterior foi reutilizado.
                </div>
              ) : null}
              <div className="validation-metrics">
                <div>
                  <span>TOTAL</span>
                  <strong>{batch.totalRows}</strong>
                </div>
                <div className="ok">
                  <span>APLICÁVEIS</span>
                  <strong>{batch.validRows}</strong>
                </div>
                <div className="warning">
                  <span>REVISAR</span>
                  <strong>{batch.warningRows}</strong>
                </div>
                <div className="bad">
                  <span>ERROS</span>
                  <strong>{batch.errorRows}</strong>
                </div>
                <div>
                  <span>DUPLICADAS</span>
                  <strong>{batch.duplicateRows}</strong>
                </div>
              </div>
              <div className="ingestion-preview-table">
                <div className="ingestion-preview-row head">
                  <span>Linha / ID</span>
                  <span>Vínculo</span>
                  <span>Conteúdo</span>
                  <span>Valor</span>
                  <span>Validação</span>
                </div>
                {(batch.rows ?? []).slice(0, 12).map((row) => (
                  <div className="ingestion-preview-row" key={row.rowNumber}>
                    <span>
                      <strong>{row.externalId ?? "Sem ID"}</strong>
                      <small>linha {row.rowNumber}</small>
                    </span>
                    <span>
                      {ingestValue(row, [
                        "producerId",
                        "producer_id",
                        "receiptId",
                        "receipt_id",
                      ])}
                    </span>
                    <span>
                      {ingestValue(row, ["variety", "variedade", "status"])}
                    </span>
                    <span>{ingestValue(row, ["kg", "net_kg", "brix"])}</span>
                    <span>
                      <i className={`row-state ${row.status}`}>
                        {rowLabel(row.status)}
                      </i>
                      <small>
                        {row.issues[0]?.message ?? "Regras atendidas"}
                        {row.issues.length > 1
                          ? ` +${row.issues.length - 1}`
                          : ""}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
              <div className="approval-bar">
                <div>
                  <span>GUARDRAIL DE ESCRITA</span>
                  <strong>
                    {batch.status === "quarantined"
                      ? "Corrija os erros e envie um novo lote."
                      : batch.status === "committed"
                        ? "Dados aplicados à safra oficial."
                        : `${batch.validRows} linhas prontas para aprovação humana.`}
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={commit}
                  disabled={
                    batch.status !== "validated" ||
                    batch.errorRows > 0 ||
                    batch.validRows === 0 ||
                    !!busy
                  }
                >
                  {busy === "commit"
                    ? "Aplicando…"
                    : batch.status === "committed"
                      ? "✓ Aplicado"
                      : "Aprovar e recalcular"}
                </button>
              </div>
            </>
          ) : (
            <div className="validation-empty">
              <span>⌕</span>
              <strong>Validação antes da escrita</strong>
              <p>
                O conector verificará campos obrigatórios, faixas físicas,
                vínculos mestres, duplicidades e regras operacionais.
              </p>
              <ul>
                <li>Produtor e talhão existentes</li>
                <li>Peso, Brix, acidez e pH plausíveis</li>
                <li>Idempotência por conteúdo</li>
                <li>Quarentena automática</li>
              </ul>
            </div>
          )}
        </article>
      </section>
      <section className="panel ingestion-history-panel">
        <div className="panel-head">
          <div>
            <span>TRILHA OPERACIONAL</span>
            <h3>Últimos lotes recebidos</h3>
          </div>
          <span className="live-label">
            <i /> persistente
          </span>
        </div>
        {history.length ? (
          <div className="batch-history">
            {history.slice(0, 8).map((item) => (
              <div key={item.id}>
                <span className={`history-icon ${item.status}`}>
                  {item.status === "committed"
                    ? "✓"
                    : item.status === "quarantined"
                      ? "!"
                      : "⌕"}
                </span>
                <span>
                  <strong>
                    Lote #{item.id} · {item.sourceName}
                  </strong>
                  <small>
                    {item.fileName ?? "payload.json"} · {item.totalRows} linhas
                  </small>
                </span>
                <span>
                  <b>{batchLabel(item.status)}</b>
                  <small>
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="history-empty">
            Nenhum lote ainda. O primeiro envio aparecerá aqui com auditoria.
          </p>
        )}
      </section>
    </div>
  );
}

type Msg = {
  role: "agent" | "user";
  text: string;
  detail?: string;
  calculation?: string;
};
function Agent({
  db,
  snap,
  scenario,
}: {
  db: SafraDB;
  snap: Snapshot;
  scenario: Scenario;
}) {
  const [input, setInput] = useState(""),
    initial: Msg = {
      role: "agent",
      text: `Cruzei ${num(db.receipts.length)} recebimentos, ${num(db.lots.length)} lotes e ${db.tanks.length} tanques.`,
      detail: `Cenário ativo: ${scenario.horizon}h e previsão ${scenario.forecastPct}%.`,
      calculation: `${snap.decisions.length} decisões abertas`,
    },
    [messages, setMessages] = useState<Msg[]>([initial]);
  function send(q = input) {
    if (!q.trim()) return;
    setMessages((current) => {
      const priorQuestion = [...current]
        .reverse()
        .find((message) => message.role === "user")?.text;
      return [
        ...current,
        { role: "user", text: q.trim() },
        {
          role: "agent",
          ...askAgent(q, db, scenario, priorQuestion),
        },
      ];
    });
    setInput("");
  }
  const quick = [
    "O que devemos priorizar agora?",
    "Se eu antecipar o AU-074, o conflito some?",
    "Qual a capacidade livre em 48h?",
    "Compare a operação em 24h e 72h",
    "Quais análises estão fora do SLA?",
    "Genealogia do lote SG-260218-038",
  ];
  return (
    <div className="agent-layout">
      <section className="chat-panel">
        <div className="chat-head">
          <div className="agent-orb">✦</div>
          <div>
            <strong>Agente Safra</strong>
            <span>
              <i /> Motor conectado · dados simulados
            </span>
          </div>
          <button type="button" onClick={() => setMessages([initial])}>
            Limpar
          </button>
        </div>
        <div className="scenario-ribbon">
          <span>
            HORIZONTE <b>{scenario.horizon}h</b>
          </span>
          <span>
            PREVISÃO <b>{scenario.forecastPct}%</b>
          </span>
          <span>
            AU-074 <b>{scenario.earlyAU074 ? "antecipado" : "plano base"}</b>
          </span>
          <span>
            DECISÕES <b>{snap.decisions.length}</b>
          </span>
        </div>
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div className={`message ${m.role}`} key={i}>
              {m.role === "agent" ? <span>✦</span> : null}
              <div>
                <p>{m.text}</p>
                {m.detail ? <small>{m.detail}</small> : null}
                {m.calculation ? <em>⌘ {m.calculation}</em> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="quick-questions">
          {quick.map((q) => (
            <button key={q} type="button" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte por variedade, tanque, lote ou conflito…"
          />
          <button type="submit">→</button>
        </form>
        <p className="chat-disclaimer">
          Respostas calculadas na base fictícia; não são comandos.
        </p>
      </section>
      <aside className="agent-tools">
        <div>
          <span>FONTES CONSULTADAS</span>
          <h3>Contexto do agente</h3>
        </div>
        <Tool
          name="Recebimentos"
          detail={`${num(db.receipts.length)} registros`}
        />
        <Tool
          name="Laboratório"
          detail={`${num(db.analyses.length)} análises`}
        />
        <Tool name="Tanques" detail={`${db.tanks.length} ativos`} />
        <Tool name="Genealogia" detail={`${num(db.lots.length)} lotes`} />
        <Tool name="Ordens" detail={`${db.orders.length} operações`} />
        <div className="guardrail-card">
          <span>LIMITES</span>
          <ul>
            <li>Não altera PLC</li>
            <li>Não libera lote</li>
            <li>Não envia declaração</li>
            <li>Expõe fórmula e evidências</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Kpi(p: {
  label: string;
  value: string;
  note: string;
  trend: string;
  tone: string;
}) {
  return (
    <article className="kpi-card">
      <span>{p.label}</span>
      <div className="kpi-value">
        <strong>{p.value}</strong>
        <i className={`spark ${p.tone}`} />
      </div>
      <p>{p.note}</p>
      <small className={p.tone}>{p.trend}</small>
    </article>
  );
}
function Mini({
  label,
  value,
  note,
  good = false,
  warn = false,
}: {
  label: string;
  value: string;
  note: string;
  good?: boolean;
  warn?: boolean;
}) {
  return (
    <article className="mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={good ? "good" : warn ? "warn" : ""}>{note}</small>
    </article>
  );
}
function PanelHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action: string;
}) {
  return (
    <div className="panel-head">
      <div>
        <span>{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      <button type="button">{action}</button>
    </div>
  );
}
function DecisionRow({ d, act }: { d: Decision; act: (d: Decision) => void }) {
  return (
    <div className="decision">
      <span className={`severity ${d.level}`} />
      <div className="decision-copy">
        <strong>{d.title}</strong>
        <p>{d.detail}</p>
        <small>
          {d.owner} · {d.due}
        </small>
      </div>
      <button type="button" onClick={() => act(d)}>
        {d.action ? "Aplicar" : "Revisar"}
      </button>
    </div>
  );
}
function TraceStep({
  n,
  title,
  detail,
  last = false,
}: {
  n: string;
  title: string;
  detail: string;
  last?: boolean;
}) {
  return (
    <div className="trace-step">
      <div className="trace-node">
        <span>{n}</span>
        {!last ? <i /> : null}
      </div>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}
function Quality({
  name,
  brix,
  pct,
  score,
}: {
  name: string;
  brix: string;
  pct: string;
  score: number;
}) {
  return (
    <div className="quality-row">
      <div>
        <strong>{name}</strong>
        <span>Brix médio {brix}</span>
      </div>
      <div className="quality-bar">
        <i style={{ width: `${score}%` }} />
      </div>
      <b>{pct}</b>
    </div>
  );
}
function Switch({
  label,
  note,
  checked,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch-control">
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function DB({ label, value }: { label: string; value: number }) {
  return (
    <div className="database-count">
      <span>{label}</span>
      <strong>{num(value)}</strong>
      <small>registros conectados</small>
    </div>
  );
}
function Lineage({
  n,
  label,
  value,
  detail,
  last = false,
}: {
  n: string;
  label: string;
  value: string;
  detail: string;
  last?: boolean;
}) {
  return (
    <div className="lineage-item">
      <div className="lineage-node">
        <span>{n}</span>
        {!last ? <i /> : null}
      </div>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}
function Tool({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="tool-row">
      <span>↗</span>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <b>Cálculo</b>
    </div>
  );
}
function tone(t: { status: string; temperature: string }) {
  return t.temperature === "attention" ||
    ["Transferir", "Atenção"].includes(t.status)
    ? "amber"
    : ["Higienizado", "Estável"].includes(t.status)
      ? "green"
      : t.status === "Resfriamento"
        ? "blue"
        : "wine";
}
function Concept() {
  return (
    <section className="concept-note">
      <div>
        <strong>Protótipo conceitual independente</strong>
        <p>
          Todos os registros, capacidades e resultados operacionais são
          fictícios.
        </p>
      </div>
      <div className="source-links">
        <a
          href="https://www.salton.com.br/a-salton/a-nossa-historia"
          target="_blank"
          rel="noreferrer"
        >
          História e unidades ↗
        </a>
        <a
          href="https://jornadaconsciente.salton.com.br/blog/p/relatorio-de-sustentabilidade-2025-crescimento-com-responsabilidade-na-pratica-52"
          target="_blank"
          rel="noreferrer"
        >
          Relatório 2025 ↗
        </a>
        <a
          href="https://www.gov.br/pt-br/servicos/fornecer-declaracao-de-producao-de-uvas"
          target="_blank"
          rel="noreferrer"
        >
          SIVIBE ↗
        </a>
      </div>
    </section>
  );
}
