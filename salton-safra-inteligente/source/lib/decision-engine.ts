import {
  Family,
  Receipt,
  SafraDB,
  Tank,
  Variety,
  familyOf,
  varieties,
  yieldOf,
} from "./safra-data";
export type Scenario = {
  horizon: 24 | 48 | 72;
  forecastPct: number;
  earlyAU074: boolean;
  smoothArrivals: boolean;
};
export type Level = "critical" | "warning" | "info";
export type Decision = {
  id: string;
  level: Level;
  category:
    | "Capacidade"
    | "Recebimento"
    | "Qualidade"
    | "Rastreabilidade"
    | "Regulatório";
  title: string;
  detail: string;
  owner: string;
  due: string;
  recommendation: string;
  impact: string;
  formula: string;
  evidence: string[];
  action?: "early" | "smooth" | "trace";
};
export type TankProjection = Tank & {
  fillPct: number;
  freeNow: number;
  available: number;
  effectiveRelease: number | null;
  temperature: "ok" | "attention" | "offline";
};
export type Pool = {
  family: Family;
  incoming: number;
  available: number;
  balance: number;
  usePct: number;
  loads: number;
};
export type Snapshot = {
  scenario: Scenario;
  totals: {
    plannedKg: number;
    receivedKg: number;
    receivedPct: number;
    todayKg: number;
    forecastKg: number;
    forecastL: number;
    tankCapacity: number;
    tankVolume: number;
    occupancyPct: number;
    tracePct: number;
    readinessPct: number;
  };
  progress: {
    variety: Variety;
    receivedKg: number;
    plannedKg: number;
    pct: number;
    forecastKg: number;
  }[];
  pools: Pool[];
  tanks: TankProjection[];
  hourly: {
    start: number;
    label: string;
    tons: number;
    capacity: number;
    over: boolean;
  }[];
  timeline: {
    hour: number;
    label: string;
    incoming: number;
    available: number;
    balance: number;
  }[];
  compliance: { label: string; pct: number; state: string }[];
  decisions: Decision[];
};
export type AgentAnswer = { text: string; detail: string; calculation: string };
export const defaultScenario: Scenario = {
  horizon: 48,
  forecastPct: 100,
  earlyAU074: false,
  smoothArrivals: false,
};
const families: Family[] = ["Espumante", "Branco", "Tinto", "Suco"];
export const num = (v: number, d = 0) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(v);
export function liters(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000)
    return `${(v / 1_000_000).toFixed(2).replace(".", ",")} mi L`;
  if (a >= 1_000) return `${num(v / 1_000, 1)} mil L`;
  return `${num(v)} L`;
}
export function tons(kg: number) {
  const t = kg / 1_000;
  return t >= 1_000 ? `${num(t / 1_000, 1)} mil t` : `${num(t, 1)} t`;
}
const release = (t: Tank, s: Scenario) =>
  t.id === "AU-074" && s.earlyAU074 ? 8 : t.releaseHour;
function project(t: Tank, s: Scenario, h: number = s.horizon): TankProjection {
  const working = t.capacity * 0.95,
    freeNow = Math.max(0, working - t.volume - t.reserved),
    rh = release(t, s),
    released = rh !== null && rh + t.cipHours <= h ? t.volume : 0;
  return {
    ...t,
    fillPct: (t.volume / t.capacity) * 100,
    freeNow,
    available: Math.min(working - t.reserved, freeNow + released),
    effectiveRelease: rh,
    temperature:
      t.temp === null
        ? "offline"
        : t.temp < t.min || t.temp > t.max
          ? "attention"
          : "ok",
  };
}
const receiptL = (r: Receipt, pct: number) =>
  (r.kg * yieldOf[r.variety] * pct) / 100;
function compliance(db: SafraDB) {
  const rs = db.receipts.filter((r) => r.kind === "received"),
    inter = rs.filter((r) => r.glt !== "N/A"),
    pct = (a: number, b: number) => (b ? (a / b) * 100 : 100);
  const rows = [
    {
      label: "Produção de uvas e origens",
      pct: pct(rs.filter((r) => r.docs).length, rs.length),
    },
    {
      label: "Pesagens e análises laboratoriais",
      pct: pct(rs.filter((r) => r.lab === "Aprovado").length, rs.length),
    },
    {
      label: "Transformação e genealogia",
      pct: pct(db.lots.filter((l) => l.complete).length, db.lots.length),
    },
    { label: "Estoque por recipiente", pct: 100 },
    {
      label: "Guias de Livre Trânsito",
      pct: pct(inter.filter((r) => r.glt === "Vinculada").length, inter.length),
    },
  ];
  return rows.map((r) => ({
    ...r,
    state: r.pct >= 99.5 ? "Conferido" : `${num(100 - r.pct, 1)}% pendente`,
  }));
}
function hourly(db: SafraDB, s: Scenario) {
  const cap = db.units.reduce((a, u) => a + u.dockTons3h, 0),
    out = [];
  for (let start = 0; start < s.horizon; start += 3) {
    const raw =
      (db.receipts
        .filter(
          (r) => r.kind === "forecast" && r.hour >= start && r.hour < start + 3,
        )
        .reduce((a, r) => a + r.kg / 1_000, 0) *
        s.forecastPct) /
      100;
    const value = s.smoothArrivals && raw > cap ? raw * 0.82 : raw;
    out.push({
      start,
      label: `+${start}–${start + 3}h`,
      tons: value,
      capacity: cap,
      over: value > cap,
    });
  }
  return out;
}
function decisions(
  db: SafraDB,
  s: Scenario,
  pools: Pool[],
  ts: TankProjection[],
  hs: Snapshot["hourly"],
  checks: Snapshot["compliance"],
) {
  const out: Decision[] = [];
  for (const p of pools.filter((x) => x.balance < 0)) {
    const shortage = Math.abs(p.balance),
      spark = p.family === "Espumante";
    out.push({
      id: `capacity-${p.family}`,
      level: shortage > 80_000 ? "critical" : "warning",
      category: "Capacidade",
      title: `${p.family}: déficit de ${liters(shortage)} em ${s.horizon}h`,
      detail: `${p.loads} cargas projetam ${liters(p.incoming)}, acima dos ${liters(p.available)} compatíveis e não reservados.`,
      owner: "Planejamento de tanques",
      due: "antes do próximo pico",
      recommendation: spark
        ? "Antecipar a transferência do AU-074 e concluir sua higienização antes do pico."
        : `Reprogramar liberações da família ${p.family}.`,
      impact: spark
        ? `Libera até ${liters(112_300)} e recalcula a fila de destinação.`
        : "Reduz espera e risco de destinação incompatível.",
      formula: `${liters(p.available)} disponíveis − ${liters(p.incoming)} previstos = −${liters(shortage)}`,
      evidence: [
        `${p.loads} recebimentos no horizonte`,
        `${ts.filter((t) => t.family === p.family).length} tanques compatíveis`,
        `Margem operacional de 5%`,
      ],
      action: spark ? "early" : undefined,
    });
  }
  const peak = hs.reduce((a, b) => (b.tons > a.tons ? b : a), hs[0]);
  if (peak?.over) {
    const excess = peak.tons - peak.capacity;
    out.push({
      id: "receiving-peak",
      level: excess > 45 ? "critical" : "warning",
      category: "Recebimento",
      title: `Pico de descarga acima da capacidade em ${peak.label}`,
      detail: `${num(peak.tons, 1)} t previstas para ${num(peak.capacity)} t por janela.`,
      owner: "Recebimento",
      due: peak.label,
      recommendation: "Escalonar horários e deslocar cargas elegíveis.",
      impact: `Remove ${num(excess, 1)} t da fila crítica.`,
      formula: `${num(peak.tons, 1)} − ${num(peak.capacity)} = ${num(excess, 1)} t excedentes`,
      evidence: [
        "Agenda confirmada",
        "Capacidade nominal das docas",
        `Previsão em ${s.forecastPct}%`,
      ],
      action: "smooth",
    });
  }
  const late = db.analyses.filter(
    (a) => a.status !== "Aprovado" && a.minutes > 30,
  );
  if (late.length)
    out.push({
      id: "lab",
      level: "warning",
      category: "Qualidade",
      title: `${late.length} análises fora do SLA de 30 min`,
      detail: "Lotes permanecem bloqueados até a validação laboratorial.",
      owner: "Laboratório",
      due: "agora",
      recommendation: "Priorizar a amostra mais antiga.",
      impact: "Reduz o tempo de pátio sem retirar aprovação humana.",
      formula: `${late.length} resultados pendentes/revisão com tempo > 30 min`,
      evidence: late
        .slice(0, 3)
        .map((a) => `${a.receiptId} · ${a.minutes} min`),
    });
  const gaps = db.lots.filter((l) => !l.complete);
  if (gaps.length)
    out.push({
      id: "trace",
      level: "warning",
      category: "Rastreabilidade",
      title: `${gaps.length} lotes com genealogia incompleta`,
      detail: "Faltam vínculos entre origem, transformação ou tanque.",
      owner: "Enologia & dados mestres",
      due: "fechamento diário",
      recommendation: `Começar por ${gaps[0].id}.`,
      impact: "Eleva a cobertura e reduz exceções regulatórias.",
      formula: `${db.lots.length - gaps.length} completos ÷ ${db.lots.length} lotes`,
      evidence: gaps
        .slice(0, 3)
        .map((l) => `${l.id} · ${l.tankId ?? "sem tanque"}`),
      action: "trace",
    });
  const temp = ts.find((t) => t.temperature === "attention");
  if (temp)
    out.push({
      id: "temperature",
      level: "warning",
      category: "Qualidade",
      title: `${temp.id} fora da faixa de temperatura`,
      detail: `Leitura ${num(temp.temp ?? 0, 1)} °C; faixa ${num(temp.min, 1)}–${num(temp.max, 1)} °C.`,
      owner: "Enologia",
      due: "próxima ronda",
      recommendation: "Confirmar sensor e inspecionar o circuito térmico.",
      impact: "Protege o processo sem alterar PLC ou setpoint.",
      formula: `${num(temp.temp ?? 0, 1)} °C > limite ${num(temp.max, 1)} °C`,
      evidence: [`Tanque ${temp.id}`, "Leitura simulada", "Faixa cadastrada"],
    });
  const low = [...checks].sort((a, b) => a.pct - b.pct)[0];
  if (low.pct < 99.5)
    out.push({
      id: "regulatory",
      level: "info",
      category: "Regulatório",
      title: `${low.label}: ${num(low.pct, 1)}% reconciliado`,
      detail:
        "O rascunho pode ser preparado, mas há registros para conferência.",
      owner: "Qualidade & regulatório",
      due: "antes da declaração",
      recommendation: "Corrigir exceções e gerar novo rascunho.",
      impact: "Melhora a prontidão sem envio oficial.",
      formula: `Cobertura mínima entre 5 blocos = ${num(low.pct, 1)}%`,
      evidence: checks.map((c) => `${c.label}: ${num(c.pct, 1)}%`),
    });
  const rank: Record<Level, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export function runEngine(db: SafraDB, s: Scenario): Snapshot {
  const rs = db.receipts.filter((r) => r.kind === "received"),
    fs = db.receipts.filter(
      (r) => r.kind === "forecast" && r.hour <= s.horizon,
    ),
    ts = db.tanks.map((t) => project(t, s));
  const plannedKg = Object.values(db.plans).reduce((a, v) => a + v, 0),
    receivedKg = rs.reduce((a, r) => a + r.kg, 0),
    forecastKg = (fs.reduce((a, r) => a + r.kg, 0) * s.forecastPct) / 100,
    forecastL = fs.reduce((a, r) => a + receiptL(r, s.forecastPct), 0);
  const progress = varieties.map((v) => {
    const got = rs.filter((r) => r.variety === v).reduce((a, r) => a + r.kg, 0),
      future =
        (fs.filter((r) => r.variety === v).reduce((a, r) => a + r.kg, 0) *
          s.forecastPct) /
        100;
    return {
      variety: v,
      receivedKg: got,
      plannedKg: db.plans[v],
      pct: (got / db.plans[v]) * 100,
      forecastKg: future,
    };
  });
  const pools = families.map((f) => {
    const fr = fs.filter((r) => r.family === f),
      incoming = fr.reduce((a, r) => a + receiptL(r, s.forecastPct), 0),
      available = ts
        .filter((t) => t.family === f)
        .reduce((a, t) => a + t.available, 0);
    return {
      family: f,
      incoming,
      available,
      balance: available - incoming,
      usePct: available ? (incoming / available) * 100 : 0,
      loads: fr.length,
    };
  });
  const hs = hourly(db, s),
    checks = compliance(db),
    tankCapacity = db.tanks.reduce((a, t) => a + t.capacity, 0),
    tankVolume = db.tanks.reduce((a, t) => a + t.volume, 0);
  const timeline = Array.from({ length: s.horizon / 6 }, (_, i) => {
    const hour = (i + 1) * 6,
      incoming = db.receipts
        .filter((r) => r.kind === "forecast" && r.hour <= hour)
        .reduce((a, r) => a + receiptL(r, s.forecastPct), 0),
      available = db.tanks.reduce(
        (a, t) => a + project(t, s, hour).available,
        0,
      );
    return {
      hour,
      label: `+${hour}h`,
      incoming,
      available,
      balance: available - incoming,
    };
  });
  const tracePct =
      (db.lots.filter((l) => l.complete).length / db.lots.length) * 100,
    readinessPct = checks.reduce((a, c) => a + c.pct, 0) / checks.length;
  return {
    scenario: s,
    totals: {
      plannedKg,
      receivedKg,
      receivedPct: (receivedKg / plannedKg) * 100,
      todayKg: rs.filter((r) => r.hour >= -12).reduce((a, r) => a + r.kg, 0),
      forecastKg,
      forecastL,
      tankCapacity,
      tankVolume,
      occupancyPct: (tankVolume / tankCapacity) * 100,
      tracePct,
      readinessPct,
    },
    progress,
    pools,
    tanks: ts,
    hourly: hs,
    timeline,
    compliance: checks,
    decisions: decisions(db, s, pools, ts, hs, checks),
  };
}

export function askAgent(
  question: string,
  db: SafraDB,
  s: Scenario,
  priorQuestion = "",
): AgentAnswer {
  const normalize = (value: string) =>
      value
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""),
    direct = normalize(question.trim()),
    contextual =
      priorQuestion &&
      (/^(e|mas|agora|nesse|nessa|isso)\b/.test(direct) ||
        (/\b(?:24|48|72)\s*(?:h|horas?)\b/.test(direct) &&
          direct.split(/\s+/).length <= 6))
        ? `${priorQuestion} ${question}`
        : question,
    q = normalize(contextual),
    horizonMatches = Array.from(
      contextual.matchAll(/\b(24|48|72)\s*(?:h|horas?)\b/gi),
      (match) => Number(match[1]) as Scenario["horizon"],
    ),
    requestedHorizon = horizonMatches.at(-1),
    activeScenario = requestedHorizon
      ? { ...s, horizon: requestedHorizon }
      : s,
    snap = runEngine(db, activeScenario),
    tankId = contextual
      .toUpperCase()
      .match(/\b(?:AU|VI|SU|BR)-\d{3}\b/)?.[0],
    lotId = contextual
      .toUpperCase()
      .match(/\b(?:SG|CG)-(?:26H-\d{4}|\d{6}-\d{3})\b/)?.[0],
    producerId = contextual.toUpperCase().match(/\bPR-\d{4}\b/)?.[0],
    variety = varieties.find((v) => q.includes(normalize(v))),
    city = Array.from(new Set(db.producers.map((item) => item.city))).find(
      (item) => q.includes(normalize(item)),
    );

  const comparedHorizons = Array.from(new Set(horizonMatches));
  if (q.includes("compar") || comparedHorizons.length > 1) {
    const [first, second] =
        comparedHorizons.length > 1
          ? comparedHorizons.slice(0, 2)
          : ([24, 72] as Scenario["horizon"][]),
      before = runEngine(db, { ...s, horizon: first }),
      after = runEngine(db, { ...s, horizon: second }),
      balance = (snapshot: Snapshot) =>
        snapshot.pools.reduce((sum, pool) => sum + pool.balance, 0),
      critical = (snapshot: Snapshot) =>
        snapshot.decisions.filter((item) => item.level === "critical").length;
    return {
      text: `De ${first}h para ${second}h, o saldo agregado passa de ${liters(balance(before))} para ${liters(balance(after))}.`,
      detail: `${first}h: ${before.decisions.length} decisões (${critical(before)} críticas). ${second}h: ${after.decisions.length} decisões (${critical(after)} críticas).`,
      calculation: `${liters(balance(after))} − ${liters(balance(before))} = ${liters(balance(after) - balance(before))}`,
    };
  }

  if (
    q.includes("o que fazer") ||
    q.includes("prioridade") ||
    q.includes("prioriz") ||
    q.includes("maior risco") ||
    q.includes("proxima acao") ||
    q.includes("resumo executivo")
  ) {
    const top = snap.decisions.slice(0, 3),
      critical = snap.decisions.filter(
        (item) => item.level === "critical",
      ).length,
      warnings = snap.decisions.filter(
        (item) => item.level === "warning",
      ).length;
    return top.length
      ? {
          text: `A prioridade em ${activeScenario.horizon}h é: ${top[0].title}.`,
          detail: top
            .map(
              (item, index) =>
                `${index + 1}. ${item.recommendation} Responsável: ${item.owner}.`,
            )
            .join(" "),
          calculation: `${snap.decisions.length} decisões = ${critical} crítica(s) + ${warnings} alerta(s) + ${snap.decisions.length - critical - warnings} informativa(s)`,
        }
      : {
          text: `Não há conflito prioritário no cenário de ${activeScenario.horizon}h.`,
          detail: "O agente recomenda manter o monitoramento e revisar novas entradas.",
          calculation: "0 decisões abertas",
        };
  }

  if (
    (q.includes("antecip") || q.includes("se eu")) &&
    (q.includes("au-074") || q.includes("transfer"))
  ) {
    const alt = runEngine(db, { ...activeScenario, earlyAU074: true }),
      before = snap.pools.find((p) => p.family === "Espumante")!,
      after = alt.pools.find((p) => p.family === "Espumante")!,
      removed =
        snap.decisions.some((d) => d.id === "capacity-Espumante") &&
        !alt.decisions.some((d) => d.id === "capacity-Espumante");
    return {
      text: removed
        ? "Sim. A antecipação elimina o conflito de espumantes neste cenário."
        : "A antecipação melhora o saldo, mas não elimina totalmente o conflito.",
      detail: `O saldo passa de ${liters(before.balance)} para ${liters(after.balance)} em ${activeScenario.horizon}h, incluindo 4h de CIP e 5% de margem.`,
      calculation: `${liters(after.available)} − ${liters(after.incoming)} = ${liters(after.balance)}`,
    };
  }
  if (tankId) {
    const t = snap.tanks.find((x) => x.id === tankId);
    return t
      ? {
          text: `${t.id} está com ${num(t.fillPct, 1)}% de ocupação e ${liters(t.freeNow)} livres agora.`,
          detail: `${t.product}; temperatura ${t.temp === null ? "sem leitura" : `${num(t.temp, 1)} °C`}. Até +${s.horizon}h: ${liters(t.available)} disponíveis.`,
          calculation: `${liters(t.capacity * 0.95)} úteis − ${liters(t.volume)} ocupados − ${liters(t.reserved)} reservados`,
        }
      : {
          text: `Não encontrei ${tankId}.`,
          detail: "Consulte um código exibido no mapa.",
          calculation: "0 registros",
        };
  }
  if (lotId || q.includes("genealogia")) {
    const l =
        db.lots.find((x) => x.id === lotId) ??
        db.lots.find((x) => x.id === "SG-260218-038")!,
      r = db.receipts.find((x) => x.id === l.receiptId),
      p = db.producers.find((x) => x.id === l.producerId);
    return {
      text: `${l.id} está ${l.complete ? "com genealogia completa" : "com vínculo incompleto"}.`,
      detail: `${p?.name}, ${p?.city} → ${l.variety}, ${tons(r?.kg ?? 0)} → ${liters(l.liters)} → ${l.tankId ?? "tanque pendente"} → ${l.future}.`,
      calculation: `1 recebimento · ${l.tankId ? "1" : "0"} destino(s)`,
    };
  }
  if (variety) {
    const p = snap.progress.find((x) => x.variety === variety)!,
      pool = snap.pools.find((x) => x.family === familyOf[variety])!;
    return {
      text: `A base registra ${tons(p.receivedKg)} de ${variety}, ou ${num(p.pct, 1)}% do plano.`,
      detail: `Há ${tons(p.forecastKg)} previstas em ${activeScenario.horizon}h. A família ${pool.family} fica com saldo de ${liters(pool.balance)}.`,
      calculation: `${tons(p.receivedKg)} ÷ ${tons(p.plannedKg)} = ${num(p.pct, 1)}%`,
    };
  }
  if (producerId || city || q.includes("produtor")) {
    const producer = producerId
        ? db.producers.find((item) => item.id === producerId)
        : undefined,
      selected = db.receipts.filter(
        (item) =>
          (!producer || item.producerId === producer.id) &&
          (!city || db.producers.find((p) => p.id === item.producerId)?.city === city),
      ),
      received = selected.filter((item) => item.kind === "received"),
      forecast = selected.filter(
        (item) =>
          item.kind === "forecast" && item.hour <= activeScenario.horizon,
      ),
      label = producer
        ? `${producer.id} · ${producer.name}`
        : city
          ? `produtores de ${city}`
          : "cadastro de produtores";
    return {
      text: producer || city
        ? `${label}: ${received.length} cargas recebidas e ${forecast.length} previstas em ${activeScenario.horizon}h.`
        : `A base contém ${db.producers.length} produtores em ${new Set(db.producers.map((item) => item.city)).size} municípios.`,
      detail: producer
        ? `${producer.city} · nota cadastral ${producer.score}/100 · ${tons(received.reduce((sum, item) => sum + item.kg, 0))} recebidas.`
        : `${tons(received.reduce((sum, item) => sum + item.kg, 0))} recebidas; ${tons(forecast.reduce((sum, item) => sum + item.kg, 0))} na previsão filtrada.`,
      calculation: `${received.length} recebidas + ${forecast.length} previstas`,
    };
  }
  if (
    q.includes("laboratorio") ||
    q.includes("analise") ||
    q.includes("sla") ||
    q.includes("qualidade")
  ) {
    const pending = db.analyses.filter((item) => item.status !== "Aprovado"),
      late = pending.filter((item) => item.minutes > 30),
      oldest = [...late].sort((a, b) => b.minutes - a.minutes)[0];
    return {
      text: `${pending.length} análises aguardam aprovação; ${late.length} estão acima do SLA de 30 minutos.`,
      detail: oldest
        ? `Priorizar ${oldest.receiptId}, com ${oldest.minutes} minutos e status ${oldest.status}. A liberação continua humana.`
        : "Nenhuma amostra pendente ultrapassou o SLA.",
      calculation: `${late.length} de ${pending.length} pendentes acima de 30 min`,
    };
  }
  if (
    q.includes("document") ||
    q.includes("glt") ||
    q.includes("guia")
  ) {
    const received = db.receipts.filter((item) => item.kind === "received"),
      docs = received.filter((item) => !item.docs),
      interstate = received.filter((item) => item.glt !== "N/A"),
      glt = interstate.filter((item) => item.glt === "Pendente");
    return {
      text: `${docs.length} recebimentos têm documentação incompleta e ${glt.length} cargas interestaduais estão com GLT pendente.`,
      detail: `Primeiras exceções: ${[...docs.slice(0, 2), ...glt.slice(0, 2)].map((item) => item.id).join(", ") || "nenhuma"}.`,
      calculation: `${received.length - docs.length} ÷ ${received.length} recebimentos com documentos completos`,
    };
  }
  if (q.includes("sivibe") || q.includes("regulat") || q.includes("conform")) {
    const low = [...snap.compliance].sort((a, b) => a.pct - b.pct)[0];
    return {
      text: `A prontidão calculada está em ${num(snap.totals.readinessPct, 1)}%.`,
      detail: `O bloco mais incompleto é “${low.label}”, com ${num(low.pct, 1)}%. O agente prepara, mas não envia.`,
      calculation: `Média de ${snap.compliance.length} blocos regulatórios`,
    };
  }
  if (q.includes("base") || q.includes("dados") || q.includes("registros")) {
    const total =
      db.receipts.length +
      db.lots.length +
      db.tanks.length +
      db.producers.length +
      db.blocks.length +
      db.analyses.length +
      db.orders.length;
    return {
      text: `A base fictícia contém ${num(db.receipts.length)} recebimentos, ${num(db.lots.length)} lotes e ${db.tanks.length} tanques.`,
      detail: `Também há ${db.producers.length} produtores, ${db.blocks.length} talhões, ${db.analyses.length} análises e ${db.orders.length} ordens.`,
      calculation: `${num(total)} registros operacionais principais`,
    };
  }
  if (
    q.includes("receb") ||
    q.includes("carga") ||
    q.includes("chega") ||
    q.includes("agenda") ||
    q.includes("janela") ||
    q.includes("hoje")
  ) {
    const forecast = db.receipts.filter(
        (item) =>
          item.kind === "forecast" && item.hour <= activeScenario.horizon,
      ),
      peak = snap.hourly.reduce(
        (highest, item) => (item.tons > highest.tons ? item : highest),
        snap.hourly[0],
      ),
      today = db.receipts.filter(
        (item) => item.kind === "received" && item.hour >= -12,
      );
    return {
      text: q.includes("hoje")
        ? `Foram registradas ${today.length} cargas, somando ${tons(snap.totals.todayKg)}, nas últimas 12 horas da base.`
        : `${forecast.length} cargas somam ${tons(snap.totals.forecastKg)} no horizonte de ${activeScenario.horizon}h.`,
      detail: peak
        ? `Maior janela: ${peak.label}, com ${num(peak.tons, 1)} t para ${num(peak.capacity, 1)} t de capacidade${peak.over ? " — há excesso." : "."}`
        : "Não há janelas futuras no filtro.",
      calculation: `${tons(snap.totals.forecastKg)} × rendimento por variedade = ${liters(snap.totals.forecastL)}`,
    };
  }
  if (
    q.includes("capacidade") ||
    q.includes("livre") ||
    q.includes("conflito") ||
    q.includes("risco") ||
    q.includes("decis")
  ) {
    const cap = snap.pools.reduce((a, p) => a + p.available, 0),
      bal = snap.pools.reduce((a, p) => a + p.balance, 0),
      critical = snap.decisions.filter((d) => d.level === "critical").length,
      top = snap.decisions[0];
    return {
      text: `O motor encontrou ${snap.decisions.length} decisões, sendo ${critical} crítica(s), em ${activeScenario.horizon}h.`,
      detail: `${top ? `Prioridade: ${top.title}.` : "Nenhum conflito relevante."} Capacidade compatível: ${liters(cap)}; saldo agregado: ${liters(bal)}.`,
      calculation: `${liters(cap)} disponíveis − ${liters(snap.totals.forecastL)} previstos`,
    };
  }
  return {
    text: "Não identifiquei uma entidade ou decisão específica nessa pergunta.",
    detail:
      "Tente: “o que devo priorizar?”, “compare 24h e 72h”, “cargas de Bento Gonçalves”, “análises fora do SLA” ou informe um tanque, lote, produtor ou variedade.",
    calculation: `Cenário ativo: ${activeScenario.horizon}h · previsão ${activeScenario.forecastPct}%`,
  };
}
