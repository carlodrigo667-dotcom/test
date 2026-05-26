export type CommandKind =
  | 'start'
  | 'stop'
  | 'restart'
  | 'pay'
  | 'reset-cart'
  | 'deploy'
  | 'sidecar-sync';

export interface NodeCapabilities {
  graphical: boolean;
  headless: boolean;
  supportsVnc: boolean;
  supportsRdp: boolean;
  coordinator: boolean;
  role: string;
}

export interface DerivedNodeState {
  cartState: string;
  ticketCount: number;
  cartAdults?: number | null;
  cartChildren?: number | null;
  guideCount?: number | null;
  slot?: string | null;
  slotState?: string | null;
  confidence?: 'low' | 'medium' | 'high' | string | null;
  source?: string | null;
  evidenceAt?: string | null;
  mismatchFlags?: string[];
  runtimeConfirmed?: boolean;
  expectedVersion?: number;
  expectedMode?: string | null;
  expectedWindow?: string | null;
  runtimeVersion?: number;
  runtimeMode?: string | null;
  runtimeWindow?: string | null;
  heartbeatState?: string | null;
  heartbeatFresh?: boolean;
  logFresh?: boolean;
  signalTypes?: string[];
  lastEvidence?: string | null;
}

export interface OperatorState {
  cartState: string;
  ticketCount: number;
  slot?: string | null;
  slotState?: string | null;
  confidence?: 'low' | 'medium' | 'high' | string | null;
  source?: string | null;
  evidenceAt?: string | null;
  runtimeConfirmed?: boolean;
  actionable?: boolean;
  trust?: 'confirmed' | 'diagnostic' | 'idle' | string;
  health?: 'offline' | 'stale' | 'problem' | 'checkout' | 'hold' | 'unconfirmed' | 'stopped' | 'running' | 'idle' | string;
  heartbeatAgeSec?: number | null;
  lastHeartbeat?: string | null;
  cartUpdatedAt?: string | null;
  cartAgeSec?: number | null;
  recatchAt?: string | null;
  recatchInSec?: number | null;
  releaseAt?: string | null;
  releaseInSec?: number | null;
  disputed?: boolean;
  mismatchFlags?: string[];
}

export interface NodeRecord {
  id: number;
  ip: string;
  status: string;
  bot_status: string;
  current_slot?: string | null;
  current_proxy?: number | null;
  proxy_bans?: Record<string, unknown> | string;
  cart_items?: string | null;
  hold_cycle?: number | null;
  last_error?: string | null;
  last_heartbeat?: string | null;
  uptime_seconds?: number | null;
  extra?: Record<string, any>;
  capabilities: NodeCapabilities;
  heartbeatAgeSec?: number | null;
  degraded?: boolean;
  displayMode?: string;
  derivedState?: DerivedNodeState | null;
  operatorState?: OperatorState | null;
  primaryIssue?: NodeIssue | null;
  noiseIssues?: NodeIssue[];
}

export interface EventRecord {
  id: number;
  node_id: number | null;
  type: string;
  message: string;
  created_at: string;
}

export interface JobItemRecord {
  id: number;
  job_id: number;
  node_id: number | null;
  label?: string | null;
  status: string;
  message?: string | null;
  meta?: Record<string, any> | string;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface JobRecord {
  id: number;
  kind: string;
  title: string;
  status: string;
  payload?: Record<string, any> | string;
  total_count: number;
  completed_count: number;
  success_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  items?: JobItemRecord[];
}

export interface AlertRecord {
  severity: 'danger' | 'warning' | 'info';
  nodeId?: number;
  message: string;
}

export interface NodeIssue {
  code: string;
  label: string;
  severity: 'danger' | 'warning' | 'info';
  summary: string;
  evidence: string;
  updatedAt: string;
}

export interface IssueGroupNode {
  nodeId: number;
  ip: string;
  status: string;
  botStatus: string;
  displayMode: string;
  currentSlot?: string | null;
  cartState?: string | null;
  confidence?: string | null;
  mismatchFlags?: string[];
  heartbeatAgeSec?: number | null;
  summary: string;
  evidence: string;
  updatedAt: string;
}

export interface IssueGroup {
  code: string;
  label: string;
  severity: 'danger' | 'warning' | 'info';
  count: number;
  updatedAt: string;
  lastEvidence: string;
  nodes: IssueGroupNode[];
}

export interface IssuesOverviewPayload {
  updatedAt: string | null;
  groups: IssueGroup[];
  noiseGroups: IssueGroup[];
  nodes: Array<{
    nodeId: number;
    ip: string;
    status: string;
    botStatus: string;
    displayMode: string;
    currentSlot?: string | null;
    cartState?: string | null;
    confidence?: string | null;
    mismatchFlags?: string[];
    heartbeatAgeSec?: number | null;
    issueCodes: string[];
    issues: NodeIssue[];
    noiseIssues: NodeIssue[];
    primaryIssue: NodeIssue | null;
    primaryNoiseIssue?: NodeIssue | null;
    updatedAt: string;
  }>;
  problemCounts: Record<string, number>;
  diagnosticNoiseCounts: Record<string, number>;
}

export interface SessionRecord {
  nodeId: number;
  wsPort: number;
  vncPort: number;
  nodeIp: string;
  startedAt: number;
  lastTouchedAt?: number;
  warm?: boolean;
  healthy?: boolean;
  iframeUrl?: string;
}

export interface OverviewPayload {
  generatedAt: string;
  nodes: NodeRecord[];
  jobs: JobRecord[];
  slots: Record<string, { slot: string; updated: string }>;
  sessions: SessionRecord[];
  paymentCount?: number;
  holdCount?: number;
  checkoutCount?: number;
  activeSlotCount?: number;
  mismatchCount?: number;
  problemCounts?: Record<string, number>;
  diagnosticNoiseCount?: number;
  diagnosticNoiseCounts?: Record<string, number>;
  topProblems?: IssueGroup[];
  issuesUpdatedAt?: string | null;
  alerts: AlertRecord[];
  events: EventRecord[];
}

export interface LogEntry {
  seq: number;
  line: string;
  ts?: string;
}

export interface LogSnapshot {
  nodeId: number;
  seq: number;
  cursor: number;
  updatedAt?: string | null;
  lines: LogEntry[];
}

export interface WorkstationPayload {
  node: NodeRecord;
  runtime: Record<string, any>;
  desired: Record<string, any>;
  override: Record<string, any>;
  session: (SessionRecord & { iframeUrl?: string }) | null;
  logs: LogSnapshot;
  logMeta?: Record<string, any> | null;
  issues: NodeIssue[];
  noiseIssues?: NodeIssue[];
  recentEvents: EventRecord[];
  paymentCart?: PaymentCartState;
}

export interface PaymentCartState {
  caughtAdults: number;
  caughtChildren: number;
  caughtNonGuide?: number;
  guideCount: number;
  totalTickets: number;
  mode?: string | null;
  ticketSearchMode?: string | null;
  slot?: string | null;
  confidence?: string | null;
  source?: string | null;
}

export interface PaymentPassenger {
  firstName: string;
  lastName: string;
  type: 'adult' | 'child';
}

export interface PaymentGuide {
  firstName: string;
  lastName: string;
  licenseNumber: string;
}

export interface PaymentRequestPayload {
  adults: number;
  children: number;
  guide: number;
  checkoutOnly?: boolean;
  participants?: PaymentPassenger[];
  guideDetails?: PaymentGuide;
  source: 'web';
}

export interface PaymentRequestResponse {
  ok: boolean;
  status: string;
  requested: {
    adults: number;
    children: number;
    guide: number;
  };
  caught: PaymentCartState;
  nodeId: number;
}

export interface RealtimeInitPayload {
  overview?: OverviewPayload;
  nodes?: NodeRecord[];
  jobs?: JobRecord[];
}

export interface ProxyNodeOverview {
  nodeId: number;
  ip: string;
  mode: string;
  currentProxy: number;
  proxies: Array<Record<string, any>>;
  bans: Record<string, any>;
  status: string;
  currentCount: number;
  nextCount: number;
  changed: boolean;
  activeProxy: Record<string, any> | null;
  futureProxyPreview: Record<string, any> | null;
}

export interface ProxyDistributionNode {
  nodeId: number;
  oldCount: number;
  newCount: number;
  changed: boolean;
  currentProxies: Array<Record<string, any>>;
  nextProxies: Array<Record<string, any>>;
}

export interface ProxyDistributionPreview {
  sourcePath: string;
  totalInput: number;
  validUnique: number;
  invalidCount: number;
  invalidLines: Array<Record<string, any>>;
  canApply: boolean;
  validationErrors: string[];
  distributionSummary: {
    nodeCount: number;
    minPerNode: number;
    maxPerNode: number;
  };
  nodes: ProxyDistributionNode[];
  changedNodeIds: number[];
}

export interface ProxyLeaseReport {
  at: number;
  nodeId?: number | null;
  event?: string;
  context?: string;
  currentProxyIndex?: number | null;
  httpCode?: number;
  probeType?: string;
  status?: string;
  healthStatus?: string;
  reason?: string;
  remoteIp?: string;
  targetUrl?: string;
  timeTotal?: number;
}

export interface ProxyLeaseRecord {
  proxyId: string;
  index: number;
  host: string;
  port: number;
  leaseOwnerNodeId?: number | null;
  leaseUntilMs?: number;
  leaseTtlRemainingMs?: number;
  healthStatus: string;
  penaltyUntilMs?: number;
  lastUsedAt?: number;
  lastCheckedAt?: number;
  lastNeutralCheckedAt?: number;
  lastColosseoCheckedAt?: number;
  lastReportedAt?: number;
  lastRuntimeReport?: ProxyLeaseReport | null;
  lastCheckerResult?: ProxyLeaseReport | null;
  score?: number;
}

export interface ProxyLeaseCheckerLog {
  at: number;
  proxyId: string;
  index: number;
  nodeId?: number | null;
  probeType: string;
  status: string;
  reason?: string;
  httpCode?: number;
  remoteIp?: string;
  targetUrl?: string;
}

export interface ProxyLeaseStatus {
  ok: boolean;
  mode: string;
  activeNodeIds: number[];
  source: string;
  sourceError?: string | null;
  totals: Record<string, number>;
  duplicateProxyLeaseIds: string[];
  checkerLog: ProxyLeaseCheckerLog[];
  proxies: ProxyLeaseRecord[];
}

export interface ConfigApplyResult {
  ok: boolean;
  version: number;
  appliedNodeIds: number[];
  runtimeConfirmedNodeIds?: number[];
  mismatchNodeIds?: number[];
  blockedNodeIds?: number[];
  expectedMode?: string | null;
  expectedWindow?: string | null;
  expectedVersion?: number | null;
  results: Array<Record<string, any>>;
}

export interface CommandJobResponse {
  ok: boolean;
  job: JobRecord;
}

export interface MetricSnapshotPoint {
  capturedAt: string;
  nodeCount: number;
  onlineCount: number;
  paymentCount: number;
  holdCount: number;
  checkoutCount: number;
  activeSlotCount: number;
  problemCount: number;
  diagnosticNoiseCount: number;
  runningJobCount: number;
  statusCounts: Record<string, number>;
  issueCounts: Record<string, number>;
}

export interface MetricsHistoryPayload {
  range: '1h' | '6h' | '24h' | '72h';
  points: MetricSnapshotPoint[];
  generatedAt: string;
}
