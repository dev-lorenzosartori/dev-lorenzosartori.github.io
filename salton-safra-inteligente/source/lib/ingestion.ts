import { Family, Receipt, Variety, familyOf, varieties } from "./safra-data";

export type IngestionEntity = "receipt" | "lab";
export type IngestionChannel = "csv" | "json";
export type RowStatus = "valid" | "warning" | "error" | "duplicate";
export type BatchStatus = "validated" | "quarantined" | "committed";
export type Issue = {
  level: "error" | "warning";
  code: string;
  message: string;
  field?: string;
};
export type NormalizedLab = {
  id: string;
  receiptId: string;
  brix: number;
  acidity: number;
  ph: number;
  status: Receipt["lab"];
  minutes: number;
};
export type NormalizedRow = Receipt | NormalizedLab;
export type IngestionRowView = {
  rowNumber: number;
  externalId: string | null;
  status: RowStatus;
  issues: Issue[];
  payload: Record<string, unknown>;
  normalized: NormalizedRow | null;
};
export type IngestionBatchView = {
  id: number;
  sourceId: string;
  sourceName: string;
  entityKind: IngestionEntity;
  channel: IngestionChannel;
  fileName: string | null;
  status: BatchStatus;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  submittedBy: string;
  createdAt: string;
  committedAt: string | null;
  repeated?: boolean;
  rows?: IngestionRowView[];
};

export const templates: Record<IngestionEntity, string> = {
  receipt: [
    "id;unidade;produtor_id;talhao_id;variedade;peso_kg;hora_offset;brix;acidez;tipo;documentos;glt",
    "IMP-REC-0001;TU;PR-0147;TL-0147-1;Moscato;19480;5,5;19,2;6,3;forecast;sim;N/A",
    "IMP-REC-0002;AD;PR-0312;TL-0312-1;Tannat;22800;8;20,7;6,1;forecast;sim;Vinculada",
  ].join("\n"),
  lab: [
    "id;recebimento_id;brix;acidez;ph;status;tempo_minutos",
    "IMP-LAB-0001;REC-26184;19,1;6,8;3,18;Aprovado;26",
    "IMP-LAB-0002;REC-25972;20,9;6,0;3,32;Aprovado;22",
  ].join("\n"),
};

const aliases: Record<string, string> = {
  unidade: "unit",
  unit_id: "unit",
  produtor: "producer_id",
  produtor_id: "producer_id",
  producerid: "producer_id",
  talhao: "block_id",
  talhao_id: "block_id",
  blockid: "block_id",
  variedade: "variety",
  peso: "net_kg",
  peso_kg: "net_kg",
  kg: "net_kg",
  hora: "hour_offset",
  hora_offset: "hour_offset",
  acidez: "acidity",
  tipo: "kind",
  documentos: "documents_complete",
  documento: "documents_complete",
  glt: "glt_status",
  recebimento: "receipt_id",
  recebimento_id: "receipt_id",
  receiptid: "receipt_id",
  tempo: "turnaround_minutes",
  tempo_minutos: "turnaround_minutes",
  minutos: "turnaround_minutes",
};
const header = (value: string) => {
  const key = value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return aliases[key] ?? key;
};

function splitCsv(content: string, delimiter: string) {
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '"') {
      if (quoted && content[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) matrix.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) matrix.push(row);
  return matrix;
}

export function parsePayload(
  channel: IngestionChannel,
  content = "",
  supplied?: unknown,
): Record<string, unknown>[] {
  if (channel === "json") {
    const parsed = supplied ?? JSON.parse(content || "[]");
    if (!Array.isArray(parsed))
      throw new Error("O payload JSON deve ser uma lista de registros.");
    return parsed.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("Cada item JSON deve ser um objeto.");
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, value]) => [
          header(key),
          value,
        ]),
      );
    });
  }
  const first = content.split(/\r?\n/).find(Boolean) ?? "";
  const delimiter =
    (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const matrix = splitCsv(content, delimiter);
  if (matrix.length < 2) return [];
  const headers = matrix[0].map(header);
  return matrix
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        headers.map((key, index) => [key, values[index] ?? ""]),
      ),
    );
}

const str = (value: unknown) => (value == null ? "" : String(value).trim());
const numValue = (value: unknown) => {
  if (typeof value === "number") return value;
  const raw = str(value).replace(/\s/g, "");
  return Number(
    raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw,
  );
};
const boolValue = (value: unknown) =>
  typeof value === "boolean"
    ? value
    : ["1", "true", "sim", "s", "yes"].includes(str(value).toLowerCase());
const varietyValue = (value: unknown) =>
  varieties.find(
    (item) =>
      item.toLocaleLowerCase("pt-BR") === str(value).toLocaleLowerCase("pt-BR"),
  );
const err = (issues: Issue[], code: string, field: string, message: string) =>
  issues.push({ level: "error", code, field, message });
const warn = (issues: Issue[], code: string, field: string, message: string) =>
  issues.push({ level: "warning", code, field, message });

export function normalizeReceipt(payload: Record<string, unknown>) {
  const issues: Issue[] = [],
    id = str(payload.id),
    unit = str(payload.unit).toUpperCase(),
    producerId = str(payload.producer_id),
    blockId = str(payload.block_id),
    variety = varietyValue(payload.variety);
  const kg = numValue(payload.net_kg),
    hour = numValue(payload.hour_offset),
    brix = numValue(payload.brix),
    acidity = numValue(payload.acidity),
    kind = str(payload.kind).toLowerCase(),
    docs = boolValue(payload.documents_complete);
  const rawGlt = str(payload.glt_status).toLowerCase(),
    glt =
      rawGlt === "vinculada"
        ? "Vinculada"
        : rawGlt === "pendente"
          ? "Pendente"
          : "N/A";
  if (!id) err(issues, "required", "id", "Identificador obrigatório.");
  if (!["TU", "AD"].includes(unit))
    err(issues, "unit", "unit", "Unidade deve ser TU ou AD.");
  if (!producerId)
    err(issues, "required", "producer_id", "Produtor obrigatório.");
  if (!blockId) err(issues, "required", "block_id", "Talhão obrigatório.");
  if (!variety) err(issues, "variety", "variety", "Variedade não reconhecida.");
  if (!Number.isFinite(kg) || kg < 100 || kg > 40_000)
    err(issues, "weight", "net_kg", "Peso deve estar entre 100 e 40.000 kg.");
  else if (kg > 28_000)
    warn(issues, "heavy", "net_kg", "Carga acima de 28 t requer conferência.");
  if (!Number.isFinite(hour) || hour < -2_000 || hour > 720)
    err(issues, "hour", "hour_offset", "Hora fora da janela operacional.");
  if (!Number.isFinite(brix) || brix < 10 || brix > 35)
    err(issues, "brix", "brix", "Brix fora do intervalo físico.");
  else if (brix < 15 || brix > 28)
    warn(issues, "brix_review", "brix", "Brix fora da faixa usual.");
  if (!Number.isFinite(acidity) || acidity < 2 || acidity > 15)
    err(issues, "acidity", "acidity", "Acidez fora do intervalo aceito.");
  if (!["received", "forecast"].includes(kind))
    err(issues, "kind", "kind", "Tipo deve ser received ou forecast.");
  if (!docs)
    warn(issues, "documents", "documents_complete", "Documentação incompleta.");
  if (unit === "AD" && glt === "N/A")
    warn(issues, "glt", "glt_status", "Carga interestadual sem GLT vinculada.");
  if (issues.some((item) => item.level === "error") || !variety)
    return { value: null as Receipt | null, issues };
  const family: Family = familyOf[variety as Variety];
  return {
    value: {
      id,
      unit: unit as "TU" | "AD",
      producerId,
      blockId,
      variety,
      kg,
      hour,
      brix,
      acidity,
      kind: kind as Receipt["kind"],
      status: kind === "received" ? "Em análise" : "A caminho",
      lab: "Pendente",
      docs,
      glt,
      family,
      lotId: null,
    } satisfies Receipt,
    issues,
  };
}

export function normalizeLab(payload: Record<string, unknown>) {
  const issues: Issue[] = [],
    id = str(payload.id),
    receiptId = str(payload.receipt_id),
    brix = numValue(payload.brix),
    acidity = numValue(payload.acidity),
    ph = numValue(payload.ph),
    minutes = numValue(payload.turnaround_minutes);
  const raw = str(payload.status).toLocaleLowerCase("pt-BR"),
    status: Receipt["lab"] | null =
      raw === "aprovado"
        ? "Aprovado"
        : raw === "pendente"
          ? "Pendente"
          : ["revisao", "revisão"].includes(raw)
            ? "Revisão"
            : null;
  if (!id)
    err(issues, "required", "id", "Identificador da análise obrigatório.");
  if (!receiptId)
    err(issues, "required", "receipt_id", "Recebimento obrigatório.");
  if (!Number.isFinite(brix) || brix < 10 || brix > 35)
    err(issues, "brix", "brix", "Brix fora do intervalo físico.");
  if (!Number.isFinite(acidity) || acidity < 2 || acidity > 15)
    err(issues, "acidity", "acidity", "Acidez fora do intervalo aceito.");
  if (!Number.isFinite(ph) || ph < 2.2 || ph > 4.5)
    err(issues, "ph", "ph", "pH fora do intervalo físico.");
  if (!status)
    err(
      issues,
      "status",
      "status",
      "Status deve ser Aprovado, Pendente ou Revisão.",
    );
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1_440)
    err(issues, "time", "turnaround_minutes", "Tempo de análise inválido.");
  else if (minutes > 30)
    warn(
      issues,
      "sla",
      "turnaround_minutes",
      "Resultado acima do SLA de 30 minutos.",
    );
  if (issues.some((item) => item.level === "error") || !status)
    return { value: null as NormalizedLab | null, issues };
  return {
    value: {
      id,
      receiptId,
      brix,
      acidity,
      ph,
      status,
      minutes,
    } satisfies NormalizedLab,
    issues,
  };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
