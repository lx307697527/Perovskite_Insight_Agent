// ============================================================
// SIA V2.1 — Entity Types (aligned with 6-entity ORM model)
// ============================================================

// --- Domain Enums ---
export type DeviceType = 'solar_cell' | 'xray_detector' | 'photodetector' | 'led' | 'other';
export type ExtractionStage = 'none' | 'stage1' | 'stage2' | 'failed';
export type DataSource = 'abstract' | 'fulltext';
export type QualityFlag = 'OK' | 'WARNING' | 'ERROR';
export type DomainType = 'perovskite' | 'semiconductor' | 'custom';
export type SIFileStatus = 'pending' | 'downloading' | 'ready' | 'failed';
export type SIFileType = 'pdf' | 'docx' | 'zip';
export type ChatRole = 'user' | 'assistant';
export type ScanDirection = 'R-scan' | 'F-scan';

// --- Project ---
export interface Project {
  id: string;
  name: string;
  description?: string;
  domain: DomainType;
  created_at: string;
  updated_at: string;
}

// --- Literature (unified Paper entity) ---
export interface Literature {
  doi: string;
  project_id: string | null; // null = inbox
  title: string;
  journal?: string;
  year?: number;
  authors?: string;
  abstract?: string;

  is_extracted: boolean;
  extraction_stage: ExtractionStage;
  data_source: DataSource;
  relevance_score?: number;
  quality_flag?: QualityFlag;

  local_pdf_path?: string;
  si_paths?: string; // JSON

  performance_data?: string; // JSON (PerformanceMetric[])
  process_params?: string;   // JSON
  stability_data?: string;   // JSON
  source_mapping?: string;   // JSON (traceability)
  cache_meta?: string;       // JSON

  created_at: string;
  updated_at: string;
}

// --- SI File ---
export interface SIFile {
  id: string;
  literature_doi: string;
  url?: string;
  type: SIFileType;
  status: SIFileStatus;
  local_path?: string;
}

// --- Chat Session ---
export interface ChatSession {
  id: string;
  project_id: string;
  query?: string;
  context_dois?: string; // JSON array
  created_at: string;
}

// --- Chat Message ---
export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  source_refs?: string; // JSON [{doi, page, excerpt}]
  created_at: string;
}

// --- Quick Question ---
export interface QuickQuestion {
  id: string;
  literature_doi: string;
  question: string;
  answer: string;
  source?: string; // JSON {page, paragraph, excerpt}
  cost?: number;   // USD
  tokens_used?: number;
  created_at: string;
}

// --- Metric Types ---
export interface MetricValue {
  value: number | string;
  unit: string;
  evidence?: string;
  scanDirection?: ScanDirection;
  hasSPO?: boolean;
}

export interface DeviceMetrics {
  pce: MetricValue;
  voc: MetricValue;
  jsc: MetricValue;
  ff?: MetricValue;
}

export interface MetricItem {
  field: string;
  value: string;
  unit?: string;
  condition?: string;
  evidence?: string;
}

export interface ProcessRecipe {
  field: string;
  value: string;
  source: 'main' | 'si';
  evidence?: string;
}

// --- API Response Types ---
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface SearchResponse {
  results: Literature[];
  warning?: string | null;
}

export interface PaperDetailsResponse {
  title: string;
  journal: string;
  year: number;
  authors: string;
  abstract: string;
  metrics: MetricField[];
  process: ProcessRecipe[];
  is_extracted: boolean;
}

export interface MetricField {
  label: string;
  value: string;
  unit: string;
  evidence?: string;
}

// --- SSE Event Types ---
export interface SSEEvent {
  status: 'downloading' | 'parsing' | 'analyzing_si' | 'extracting' | 'ai_analyzing' | 'ai_analyzing_si' | 'completed' | 'failed' | 'cached' | 'error';
  progress?: number;
  result?: ExtractionResult;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface QASSEEvent {
  type: 'content' | 'source' | 'done' | 'error';
  text?: string;
  page?: number;
  paragraph?: number;
  excerpt?: string;
  file?: string;
  cost?: number;
  tokens?: number;
  message?: string;
  timestamp: string;
}

// --- Extraction Result (legacy compat) ---
export interface ExtractionResult {
  doi: string;
  title: string;
  device_type?: DeviceType;
  metrics: MetricItem[] | DeviceMetrics;
  composition: string;
  structure: string;
  process_summary?: string;
  process?: ProcessRecipe[];
  quality: string;
  qualityText: string;
}

// --- Settings ---
export interface Settings {
  apiKey: string;
  baseUrl: string;
  model: string;
  stage1Model?: string;
  stage2Model?: string;
  proxyUrl?: string;
  domain?: DomainType;
}

// --- Config Status ---
export interface ConfigStatus {
  needs_onboarding: boolean;
  ai_configured: boolean;
  embedding_status: 'not_installed' | 'loading' | 'ready' | 'error';
}

// --- Backward Compat Alias ---
export type Paper = Literature;
