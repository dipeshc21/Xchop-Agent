export type DashboardPeriod = 'month' | 'week' | 'all';

export type DashboardSummary = {
  leadCount: number;
  sentCount: number;
  replyRate: number;
  wonCount: number;
  pipelineValue: number;
  revenue: Array<{ currency: string; amount: number }>;
  quoteCount: number;
  funnel: Array<{ stage: string; count: number }>;
  markets: Array<{ country: string; count: number }>;
  attention: Array<{
    id: string;
    title: string;
    detail: string;
    kind: 'task' | 'project';
    due_at: string;
  }>;
};

export function dashboardPeriod(value: unknown): DashboardPeriod {
  return value === 'week' || value === 'all' ? value : 'month';
}
