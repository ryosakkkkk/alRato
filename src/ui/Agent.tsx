import { useMemo, type CSSProperties } from 'react';
import type { Capture, InferenceOrigin, Receipt, StudyAid } from '../core/types';
import type { SolutionCheck } from '../core/verifier';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { Icon, type IconName } from './Icon';

function useNumber() {
  const { lang } = useI18n();
  return useMemo(() => {
    const format = new Intl.NumberFormat(lang, { maximumFractionDigits: 3 });
    return (v: number) => format.format(Math.abs(v) < 1e-9 ? 0 : v).replace('-', '−');
  }, [lang]);
}

/**
 * The device's verdict on a full solution, computed with arithmetic and no model. A confirmed answer
 * shows the numbers behind it; an answer the device can prove wrong says so plainly.
 */
export function CheckLine({ check, repaired = false }: { check: SolutionCheck; repaired?: boolean }) {
  const { t } = useI18n();
  const show = useNumber();
  const ok = check.status === 'verified';
  let detail: string;
  switch (check.kind) {
    case 'equation':
      detail = ok
        ? check.values.map((v) => `f(${show(v.x)}) = ${show(v.y)}`).join('  ·  ')
        : check.values
            .filter((v) => !v.ok)
            .map((v) => t('check.equationMiss', { x: show(v.x), y: show(v.y) }))
            .join('; ');
      break;
    case 'derivative':
    case 'antiderivative':
      detail =
        ok || !check.worst
          ? t('check.functions', { n: check.points })
          : t('check.functionsMiss', { x: show(check.worst.x), e: show(check.worst.expected), s: show(check.worst.stated) });
      break;
    case 'derivative_at':
      detail = ok
        ? t('check.slope', { x: show(check.at), v: show(check.computed) })
        : t('check.slopeMiss', { x: show(check.at), v: show(check.computed), s: show(check.stated) });
      break;
    case 'integral':
      detail = ok ? t('check.integral', { v: show(check.computed) }) : t('check.integralMiss', { v: show(check.computed), s: show(check.stated) });
      break;
    case 'arithmetic':
      detail = ok
        ? t('check.arithmetic', { v: show(check.computed) })
        : t('check.arithmeticMiss', { v: show(check.computed), s: show(check.stated) });
      break;
  }
  return (
    <p className={ok ? 'answer-check' : 'answer-check answer-miss'}>
      <span className="answer-check-mark" aria-hidden="true">
        {ok ? '✓' : '!'}
      </span>
      <span>
        <strong>{ok ? (repaired ? t('check.repaired') : t('solution.checked')) : t('check.mismatch')}</strong> {detail}
      </span>
    </p>
  );
}

/** "gemini-3.8-flash" reads as "Gemini 3.8 Flash". */
export function modelName(model: string): string {
  return model
    .split('-')
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
    .replace('Webgpu', 'WebGPU');
}

type Where = InferenceOrigin | 'you';

interface TraceStep {
  icon: IconName;
  role: MessageKey;
  where: Where;
  detail: string;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const lastOf = (receipts: Receipt[], task: Receipt['task']) => [...receipts].reverse().find((r) => r.task === task);

/**
 * How the small agent solved this exercise, step by step, and where each step ran: like a list of
 * tool calls. Steps on the device are green, steps in the cloud are violet.
 */
export function AgentTrace({ capture, aid }: { capture: Capture; aid: StudyAid }) {
  const { t } = useI18n();
  const model = (r: Receipt) => `${modelName(r.model)} · ${seconds(r.latencyMs)}`;
  const steps: TraceStep[] = [];

  const read = lastOf(capture.receipts, 'read');
  if (capture.textBy === 'student') steps.push({ icon: 'edit', role: 'agent.read', where: 'you', detail: t('agent.readByYou') });
  else if (read) steps.push({ icon: 'camera', role: 'agent.read', where: read.source, detail: model(read) });
  const organize = lastOf(capture.receipts, 'analyze');
  if (organize) steps.push({ icon: 'folder', role: 'agent.organize', where: organize.source, detail: model(organize) });
  steps.push({
    icon: 'book',
    role: 'agent.memory',
    where: 'on_device',
    detail: aid.memory && aid.memory.length > 0 ? aid.memory.join(', ') : t('agent.memoryEmpty'),
  });
  const first = aid.attempts?.[0] ?? aid.receipt;
  steps.push({ icon: 'spark', role: 'agent.solve', where: first.source, detail: [aid.plan, model(first)].filter(Boolean).join(' · ') });
  const firstFailed = aid.repaired === true;
  steps.push({
    icon: aid.check?.status === 'verified' || (aid.check === null && !firstFailed) ? 'check' : 'alert',
    role: 'agent.verify',
    where: 'on_device',
    detail: firstFailed ? t('agent.mismatch') : aid.check ? t(aid.check.status === 'verified' ? 'agent.verified' : 'agent.mismatch') : t('agent.unverified'),
  });
  const second = aid.attempts?.[1];
  if (aid.repaired && second) {
    const after = aid.check?.status === 'verified' ? t('agent.recheckOk') : aid.check ? t('agent.recheckMiss') : t('agent.unverified');
    steps.push({ icon: 'replay', role: 'agent.repair', where: second.source, detail: `${model(second)} · ${after}` });
  }
  if (aid.visual) steps.push({ icon: 'chart', role: 'agent.draw', where: 'on_device', detail: t(`visualKind.${aid.visual.kind}` as MessageKey) });

  const onDevice = steps.filter((s) => s.where === 'on_device').length;
  const inCloud = steps.filter((s) => s.where === 'in_cloud').length;
  const whereLabel = (where: Where) => (where === 'on_device' ? t('agent.device') : where === 'in_cloud' ? t('agent.cloud') : t('agent.you'));

  return (
    <details className="trace" open>
      <summary>
        <Icon name="chip" size={16} />
        <span>{t('agent.title')}</span>
        <small>{t('agent.summary', { n: steps.length, d: onDevice, c: inCloud })}</small>
      </summary>
      <ol className="trace-steps">
        {steps.map((step, i) => (
          <li key={i} className={`trace-step where-${step.where}`} style={{ '--i': i } as CSSProperties}>
            <span className="trace-icon" aria-hidden="true">
              <Icon name={step.icon} size={15} />
            </span>
            <span className="trace-body">
              <span className="trace-head">
                <strong>{t(step.role)}</strong>
                <span className="trace-where">{whereLabel(step.where)}</span>
              </span>
              <small>{step.detail}</small>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
