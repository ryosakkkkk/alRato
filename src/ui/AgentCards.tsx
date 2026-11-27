import { useLiveQuery } from 'dexie-react-hooks';
import { buildProfile } from '../core/learner';
import { db } from '../core/db';
import { cloudModels } from '../ai/engine';
import { remote } from '../firebase/remoteConfig';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { modelName } from './Agent';
import { useDevice } from './hooks';
import { Icon, type IconName } from './Icon';
import { useLocalModel } from './localModelHooks';

interface Role {
  icon: IconName;
  role: MessageKey;
  why: MessageKey;
  who: string;
  where: 'device' | 'cloud';
}

/**
 * The agent's team, as it is set up right now: which model does each job and where it runs. The
 * models come from Remote Config, so the card tells the truth after a model is swapped.
 */
export function AgentRolesCard() {
  const { t } = useI18n();
  const device = useDevice();
  const local = useLocalModel();
  const first = (setting: string) => modelName(cloudModels(setting)[0] ?? '');
  const config = remote();
  const hintOnDevice = device.text === 'ready' || local.state === 'ready';
  const hintModel = device.text === 'ready' ? 'Gemini Nano' : local.state === 'ready' ? local.label : first(config.model_text);
  const noAi = t('role.noAi');
  const roles: Role[] = [
    { icon: 'camera', role: 'role.read', why: 'role.readWhy', who: first(config.model_vision), where: 'cloud' },
    { icon: 'folder', role: 'role.organize', why: 'role.organizeWhy', who: first(config.model_text), where: 'cloud' },
    { icon: 'spark', role: 'role.hint', why: 'role.hintWhy', who: hintModel, where: hintOnDevice ? 'device' : 'cloud' },
    { icon: 'chip', role: 'role.solve', why: 'role.solveWhy', who: first(config.model_reasoning), where: 'cloud' },
    { icon: 'check', role: 'role.verify', why: 'role.verifyWhy', who: noAi, where: 'device' },
    { icon: 'chart', role: 'role.draw', why: 'role.drawWhy', who: noAi, where: 'device' },
    { icon: 'book', role: 'role.remember', why: 'role.rememberWhy', who: noAi, where: 'device' },
  ];
  return (
    <section className="card stack-s">
      <h2>{t('ai.agentTitle')}</h2>
      <p className="muted">{t('ai.agentIntro')}</p>
      <ul className="roles">
        {roles.map((r) => (
          <li key={r.role} className={`role where-${r.where === 'device' ? 'on_device' : 'in_cloud'}`}>
            <span className="trace-icon" aria-hidden="true">
              <Icon name={r.icon} size={15} />
            </span>
            <span className="trace-body">
              <span className="trace-head">
                <strong>{t(r.role)}</strong>
                <span className="trace-where">{r.where === 'device' ? t('agent.device') : t('agent.cloud')}</span>
              </span>
              <small>
                {r.who} · {t(r.why)}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What alRato has learned about the student: no training, just their own history, kept here. */
export function LearnedCard() {
  const { t } = useI18n();
  const profile = useLiveQuery(async () => {
    const [captures, aids, cards] = await Promise.all([db.captures.toArray(), db.aids.toArray(), db.cards.toArray()]);
    return buildProfile(captures, aids, cards);
  }, []);
  const skills = profile?.skills.slice().sort((a, b) => b.notes - a.notes || a.mastery - b.mastery).slice(0, 6) ?? [];
  return (
    <section className="card stack-s">
      <h2>{t('ai.learnTitle')}</h2>
      <p className="muted">{t('ai.learnHow')}</p>
      {skills.length === 0 ? (
        <p className="muted small">{t('ai.learnEmpty')}</p>
      ) : (
        <ul className="skills">
          {skills.map((skill) => {
            const band = skill.mastery < 0.45 ? 'hard' : skill.mastery >= 0.75 ? 'easy' : 'mid';
            return (
              // The concept comes from the student's own note, in the language it was written in: content, not interface.
              <li key={skill.key} className={`skill skill-${band}`} translate="no">
                <span className="skill-head">
                  <strong>{skill.label}</strong>
                  <small>{t(band === 'hard' ? 'ai.skillHard' : band === 'easy' ? 'ai.skillEasy' : 'ai.skillMid')}</small>
                </span>
                <span
                  className="skill-bar"
                  role="meter"
                  aria-label={skill.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(skill.mastery * 100)}
                >
                  <span style={{ width: `${Math.max(6, skill.mastery * 100)}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
