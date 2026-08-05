import {
  IngestionBatchView,
  IngestionEntity,
  IngestionRowView,
  NormalizedLab,
  NormalizedRow,
  normalizeLab,
  normalizeReceipt,
  parsePayload,
  sha256,
  stableJson,
  templates,
} from "./ingestion";
import { Receipt, SafraDB, safraDb } from "./safra-data";

type DemoBatch = IngestionBatchView & { checksum: string };

const keys = {
  db: "safra360.demo.db.v1",
  batches: "safra360.demo.ingestion.v1",
  scenarios: "safra360.demo.scenarios.v1",
  decisions: "safra360.demo.decisions.v1",
};

const sourceNames: Record<string, string> = {
  "scale-tuiuty": "Balança e recebimento · Tuiuty",
  "lims-quality": "Laboratório de qualidade · LIMS",
};

export function isStaticDemo() {
  if (typeof window === "undefined") return false;
  const flagged = Boolean(
    (window as Window & { __SAFRA_STATIC_DEMO__?: boolean })
      .__SAFRA_STATIC_DEMO__,
  );
  return flagged || window.location.hostname.endsWith("github.io");
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function cloneDb(db: SafraDB): SafraDB {
  return JSON.parse(JSON.stringify(db)) as SafraDB;
}

function loadDemoDb() {
  const stored = readLocal<SafraDB | null>(keys.db, null);
  if (stored) return stored;
  const seeded = cloneDb(safraDb);
  writeLocal(keys.db, seeded);
  return seeded;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function localPath(input: RequestInfo | URL) {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const path = new URL(raw, window.location.href).pathname;
  const api = path.indexOf("/api/");
  return api >= 0 ? path.slice(api) : path;
}

function bodyOf(init?: RequestInit) {
  if (!init?.body || typeof init.body !== "string") return {};
  return JSON.parse(init.body) as Record<string, unknown>;
}

function receiptComparable(value: Receipt) {
  return {
    id: value.id,
    unit: value.unit,
    producerId: value.producerId,
    blockId: value.blockId,
    variety: value.variety,
    kg: value.kg,
    hour: value.hour,
    brix: value.brix,
    acidity: value.acidity,
    kind: value.kind,
    docs: value.docs,
    glt: value.glt,
    family: value.family,
  };
}

async function stageDemoBatch(payload: Record<string, unknown>) {
  const sourceId = String(payload.sourceId ?? ""),
    entityKind = payload.entityKind as IngestionEntity,
    channel = payload.channel as "csv" | "json";
  if (!sourceNames[sourceId] || !["receipt", "lab"].includes(entityKind))
    throw new Error("Fonte incompatível ou inativa.");
  if (!["csv", "json"].includes(channel))
    throw new Error("Canal de ingestão inválido.");

  const records = parsePayload(
    channel,
    typeof payload.content === "string" ? payload.content : "",
    payload.rows,
  );
  if (!records.length)
    throw new Error("Nenhuma linha de dados foi encontrada.");
  if (records.length > 500)
    throw new Error("O lote piloto aceita até 500 linhas.");

  const checksum = await sha256(stableJson(records)),
    batches = readLocal<DemoBatch[]>(keys.batches, []),
    repeated = batches.find(
      (item) =>
        item.sourceId === sourceId &&
        item.entityKind === entityKind &&
        item.checksum === checksum,
    );
  if (repeated) return { ...repeated, repeated: true };

  const db = loadDemoDb(),
    producerIds = new Set(db.producers.map((item) => item.id)),
    blocks = new Map(db.blocks.map((item) => [item.id, item.producerId])),
    receipts = new Map(db.receipts.map((item) => [item.id, item])),
    analyses = new Map(db.analyses.map((item) => [item.receiptId, item])),
    seen = new Set<string>(),
    rows: IngestionRowView[] = [];

  records.forEach((record, index) => {
    const parsed =
        entityKind === "receipt"
          ? normalizeReceipt(record)
          : normalizeLab(record),
      issues = [...parsed.issues],
      value = parsed.value as NormalizedRow | null,
      externalId = value?.id ?? (record.id ? String(record.id) : null);
    let duplicate = false;

    if (externalId && seen.has(externalId))
      issues.push({
        level: "error",
        code: "duplicate_file",
        field: "id",
        message: "Identificador repetido no arquivo.",
      });
    if (externalId) seen.add(externalId);

    if (value && entityKind === "receipt") {
      const receipt = value as Receipt;
      if (!producerIds.has(receipt.producerId))
        issues.push({
          level: "error",
          code: "producer_fk",
          field: "producer_id",
          message: "Produtor não existe no cadastro mestre.",
        });
      const owner = blocks.get(receipt.blockId);
      if (!owner)
        issues.push({
          level: "error",
          code: "block_fk",
          field: "block_id",
          message: "Talhão não existe no cadastro mestre.",
        });
      else if (owner !== receipt.producerId)
        issues.push({
          level: "error",
          code: "block_owner",
          field: "block_id",
          message: "Talhão não pertence ao produtor.",
        });
      const existing = receipts.get(receipt.id);
      if (existing) {
        if (
          stableJson(receiptComparable(existing)) ===
          stableJson(receiptComparable(receipt))
        )
          duplicate = true;
        else
          issues.push({
            level: "error",
            code: "conflict",
            field: "id",
            message: "ID já existe com conteúdo diferente.",
          });
      }
    }

    if (value && entityKind === "lab") {
      const lab = value as NormalizedLab;
      if (!receipts.has(lab.receiptId))
        issues.push({
          level: "error",
          code: "receipt_fk",
          field: "receipt_id",
          message: "Recebimento não existe na base operacional.",
        });
      if (analyses.has(lab.receiptId))
        issues.push({
          level: "warning",
          code: "update",
          field: "receipt_id",
          message: "A análise existente será atualizada.",
        });
    }

    const hasError = issues.some((item) => item.level === "error"),
      hasWarning = issues.some((item) => item.level === "warning"),
      status: IngestionRowView["status"] = hasError
        ? "error"
        : duplicate
          ? "duplicate"
          : hasWarning
            ? "warning"
            : "valid";
    rows.push({
      rowNumber: index + 2,
      externalId,
      status,
      issues,
      payload: record,
      normalized: hasError ? null : value,
    });
  });

  const errorRows = rows.filter((item) => item.status === "error").length,
    warningRows = rows.filter((item) => item.status === "warning").length,
    duplicateRows = rows.filter(
      (item) => item.status === "duplicate",
    ).length,
    validRows = rows.filter((item) =>
      ["valid", "warning"].includes(item.status),
    ).length,
    id = batches.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const batch: DemoBatch = {
    id,
    sourceId,
    sourceName: sourceNames[sourceId],
    entityKind,
    channel,
    fileName: typeof payload.fileName === "string" ? payload.fileName : null,
    status: errorRows ? "quarantined" : "validated",
    totalRows: rows.length,
    validRows,
    warningRows,
    errorRows,
    duplicateRows,
    submittedBy: "visitante da demonstração",
    createdAt: new Date().toISOString(),
    committedAt: null,
    rows,
    checksum,
  };
  writeLocal(keys.batches, [batch, ...batches].slice(0, 15));
  return batch;
}

function commitDemoBatch(id: number) {
  const batches = readLocal<DemoBatch[]>(keys.batches, []),
    index = batches.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Lote não encontrado.");
  const batch = batches[index];
  if (batch.status === "quarantined")
    throw new Error("O lote possui erros em quarentena.");
  if (batch.status === "committed") return batch;

  const db = loadDemoDb();
  for (const row of batch.rows ?? []) {
    if (!row.normalized || !["valid", "warning"].includes(row.status))
      continue;
    if (batch.entityKind === "receipt") {
      const receipt = row.normalized as Receipt;
      if (!db.receipts.some((item) => item.id === receipt.id))
        db.receipts.push(receipt);
    } else {
      const lab = row.normalized as NormalizedLab,
        analysisIndex = db.analyses.findIndex(
          (item) => item.receiptId === lab.receiptId,
        );
      if (analysisIndex >= 0) db.analyses[analysisIndex] = { ...lab };
      else db.analyses.push({ ...lab });
      const receipt = db.receipts.find((item) => item.id === lab.receiptId);
      if (receipt) {
        receipt.brix = lab.brix;
        receipt.acidity = lab.acidity;
        receipt.lab = lab.status;
      }
    }
  }
  writeLocal(keys.db, db);
  Object.assign(safraDb, db);
  const committed = {
    ...batch,
    status: "committed" as const,
    committedAt: new Date().toISOString(),
  };
  batches[index] = committed;
  writeLocal(keys.batches, batches);
  return committed;
}

async function staticApi(input: RequestInfo | URL, init?: RequestInit) {
  const path = localPath(input),
    method = (init?.method ?? "GET").toUpperCase();
  try {
    if (path === "/api/safra" && method === "GET")
      return json({
        db: loadDemoDb(),
        meta: { source: "browser", seedVersion: "safra-2026-demo-v1" },
      });
    if (path === "/api/scenarios" && method === "GET")
      return json({ scenarios: readLocal(keys.scenarios, []) });
    if (path === "/api/scenarios" && method === "POST") {
      const payload = bodyOf(init),
        scenarios = readLocal<Array<Record<string, unknown>>>(
          keys.scenarios,
          [],
        ),
        id = scenarios.length + 1,
        item = {
          id,
          name: String(payload.name ?? "Cenário operacional"),
          scenario: payload.scenario,
          createdAt: new Date().toISOString(),
        };
      writeLocal(keys.scenarios, [item, ...scenarios].slice(0, 30));
      return json(item, 201);
    }
    if (path === "/api/decisions" && method === "POST") {
      const events = readLocal<Array<Record<string, unknown>>>(
          keys.decisions,
          [],
        ),
        item = {
          id: events.length + 1,
          ...bodyOf(init),
          actor: "visitante da demonstração",
          createdAt: new Date().toISOString(),
        };
      writeLocal(keys.decisions, [item, ...events].slice(0, 100));
      return json(item, 201);
    }
    if (path === "/api/decisions" && method === "GET")
      return json({ events: readLocal(keys.decisions, []) });
    if (path === "/api/ingestion" && method === "GET")
      return json({ batches: readLocal<DemoBatch[]>(keys.batches, []) });
    if (path === "/api/ingestion" && method === "POST")
      return json({ batch: await stageDemoBatch(bodyOf(init)) }, 201);
    const commit = path.match(/^\/api\/ingestion\/(\d+)\/commit$/);
    if (commit && method === "POST")
      return json({ batch: commitDemoBatch(Number(commit[1])) });
    return json({ error: "Rota local não encontrada." }, 404);
  } catch (reason) {
    return json(
      { error: reason instanceof Error ? reason.message : "Falha na operação" },
      400,
    );
  }
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return isStaticDemo() ? staticApi(input, init) : fetch(input, init);
}

export function templateHref(kind: IngestionEntity) {
  return isStaticDemo()
    ? `data:text/csv;charset=utf-8,${encodeURIComponent(templates[kind])}`
    : `/api/ingestion/template?kind=${kind}`;
}
