import { CASES } from './balance.js'
import {
  applyAdReward,
  applyGemGrant,
  applyRoundResult,
  claimDaily,
  createSession,
  equip,
  openCase,
  refreshQuests,
} from './logic.js'

/**
 * One player's profile for the length of a connection: the lobby actions that change
 * their save (cases, equipping, daily reward) and the grants (round rewards, Gems,
 * ads). Round play itself lives in host.js; it calls `awardRound` when your round ends.
 *
 * Runs in the Colyseus room and in the offline stand-in alike.
 */
export class PlayerSession {
  /**
   * @param {object} profile the saved profile, changed in place
   * @param {{ now: number, emit: (type, payload) => void, onLook?: (look) => void, rand?: () => number }} o
   */
  constructor(profile, { now, emit, onLook = () => {}, rand = Math.random }) {
    this.profile = profile
    this.session = createSession(now)
    this.emit = emit
    this.onLook = onLook
    this.rand = rand
    this.dirty = false
    refreshQuests(profile, now)
  }

  sendProfile() {
    this.dirty = false
    this.emit('profile', { profile: this.profile, session: this.session })
  }

  look() {
    return { cape: this.profile.cape, sword: this.profile.sword, level: this.profile.level, vip: Boolean(this.profile.passes.vip) }
  }

  /** Lobby actions from the client. Unknown types are ignored. */
  handle(type, payload = {}, now = Date.now()) {
    const p = this.profile
    switch (type) {
      case 'openCase': {
        const result = openCase(p, String(payload.caseId), this.rand)
        if (!result.ok) {
          this.emit('toast', { text: result.error, kind: 'error' })
          return
        }
        this.emit('caseResult', result)
        this.sendProfile()
        return
      }
      case 'equip': {
        if (equip(p, payload.kind, payload.id)) {
          this.onLook(this.look())
          this.sendProfile()
        }
        return
      }
      case 'claimDaily': {
        const result = claimDaily(p, now)
        if (result.ok) {
          this.emit('reward', { label: `Day ${result.streak} reward: +${result.cash} cash` })
          this.sendProfile()
        }
        return
      }
      case 'welcomeGift': {
        if (p.welcomeGift) return
        p.welcomeGift = true
        const result = openCase(p, 'cape', this.rand, true)
        this.emit('caseResult', { ...result, gift: true })
        this.sendProfile()
        return
      }
      case 'tutorialDone':
        if (!p.tutorial) {
          p.tutorial = true
          this.sendProfile()
        }
        return
      default:
    }
  }

  awardRound(result, now = Date.now()) {
    const r = applyRoundResult(this.profile, result, now, this.rand)
    this.emit('roundReward', { ...r, fighters: result.fighters, mode: result.mode })
    for (const q of r.quests) this.emit('reward', { label: `Quest done: ${q.name} (+${q.cash} cash, +${q.xp} XP)` })
    if (r.levelUps.length) {
      this.emit('levelUp', { ups: r.levelUps })
      this.onLook(this.look())
    }
    this.sendProfile()
    return r
  }

  grantAdReward(placement, now) {
    const label = applyAdReward(this.profile, placement, now)
    if (!label) return
    this.emit('reward', { label })
    this.sendProfile()
  }

  grantGemProduct(sku, now = Date.now()) {
    const grant = applyGemGrant(this.profile, sku, now, this.rand)
    if (!grant) return { ok: false, error: `Unknown product ${sku}` }
    if (grant.caseResult?.ok) this.emit('caseResult', { ...grant.caseResult, gift: true })
    else this.emit('reward', { label: grant.label })
    this.onLook(this.look())
    this.sendProfile()
    return { ok: true }
  }

  /** Playtime for the boards. */
  tick(dt) {
    this.profile.stats.playtime += dt
  }
}

export { CASES }
