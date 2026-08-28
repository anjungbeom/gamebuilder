import { clamp } from "./rng.js?rev=9";

export function creatureRewardProfile(genome, hostile, ranged, rank = "normal") {
  const boss = rank === "normal" ? 0 : 1;
  return {
    chase: hostile ? 1.1 + genome.speed * .18 + boss * .3 : -.8,
    retreat: hostile ? .1 + genome.skittish * .25 : 1 + genome.skittish * .75,
    shoot: ranged ? 1.15 + boss * .3 : -2,
    guard: boss ? 1.15 : .25,
    wander: hostile ? .28 : .72,
    home: .42 + genome.skittish * .16
  };
}

export function scoreCreatureActions(profile, context, disabled = {}) {
  const proximity = clamp(1 - context.targetDistance / Math.max(1, context.awareness), 0, 1);
  const homePull = clamp(context.homeDistance / 90, 0, 1);
  const scores = {
    chase: profile.chase * proximity - (context.targetDistance < 12 ? .15 : 0),
    retreat: profile.retreat * proximity,
    shoot: context.canShoot && context.targetDistance > 32 ? profile.shoot * proximity : -Infinity,
    guard: profile.guard * (1 - proximity * .45),
    home: profile.home * homePull,
    wander: profile.wander * (1 - homePull)
  };
  for (const action of Object.keys(disabled)) if (disabled[action]) scores[action] = -Infinity;
  return scores;
}

export function scoreVillagerActions(profile, context) {
  return {
    avoid: context.threatDistance < 70 ? profile.caution * (1 - context.threatDistance / 70) : -1,
    assist: context.playerHurt ? profile.care * (1 - Math.min(1, context.playerDistance / 90)) : -1,
    greet: context.playerDistance < 46 ? profile.social * (1 - context.playerDistance / 46) : -1,
    home: profile.duty * Math.min(1, context.homeDistance / 38),
    wander: profile.curiosity * (1 - Math.min(1, context.homeDistance / 38))
  };
}

export function scorePetActions(profile, context) {
  return {
    attack: context.hasTarget ? profile.bravery * (1 - Math.min(1, context.targetDistance / 80)) : -1,
    return: context.playerDistance > 34 ? profile.loyalty * Math.min(1, context.playerDistance / 90) : .05,
    orbit: profile.curiosity * (1 - Math.min(1, context.playerDistance / 42))
  };
}

export function selectRewardAction(scores) {
  return Object.entries(scores).reduce((best, entry) => entry[1] > best[1] ? entry : best, ["hold", -Infinity])[0];
}
