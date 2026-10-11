const HISSATSU_POWER_BY_OVERALL = [
  [95, 140], [90, 120], [85, 100], [80, 80], [70, 70], [60, 60], [50, 40], [0, 30],
];

const TP_COST_BY_POWER = new Map([
  [20, 10], [30, 15], [40, 20], [60, 30], [70, 35], [80, 40],
  [100, 50], [120, 60], [140, 70],
]);

export function hissatsuPower(player) {
  const overall = Number(player?.overall) || 0;
  return HISSATSU_POWER_BY_OVERALL.find(([minimum]) => overall >= minimum)?.[1] ?? 30;
}

export function hissatsuTpCost(power) {
  return TP_COST_BY_POWER.get(power) ?? 15;
}

export function isLongShot(move) {
  return /\(L\)/i.test(move?.name ?? '');
}

export function isShotBlock(move) {
  return /\(B\)/i.test(move?.name ?? '');
}

function isTackle(move) {
  return move?.type === 'Odbiór' || move?.type === 'Odbierająca';
}

// A player at 20 stamina performs at 70% of their normal match attributes.
export function staminaMultiplier(currentStamina) {
  const penalty = Math.min(0.3, Math.max(0, (40 - currentStamina) * 0.015));
  return 1 - penalty;
}

export function contestChance(attackerValue, defenderValue, bonus = 0) {
  return Math.max(20, Math.min(82, 50 + (attackerValue - defenderValue) * 0.55 + bonus));
}

// The defender button shows the true no-technique chance for the same 1–20
// attack and defence rolls used by resolveDuel, rather than a separate estimate.
export function duelDefenceChance(attackBase, defenceBase) {
  let wins = 0;
  for (let attackRoll = 1; attackRoll <= 20; attackRoll += 1) {
    for (let defenceRoll = 1; defenceRoll <= 20; defenceRoll += 1) {
      if (defenceBase + defenceRoll >= attackBase + attackRoll) wins += 1;
    }
  }
  return Math.round(wins / 4);
}

export function goalChance(shotPower, keeperPower, shotMultiplier = 1) {
  return Math.max(12, Math.min(85, 50 + (shotPower * shotMultiplier - keeperPower) * 0.65));
}

export function zoneLabel(zone) {
  return ['środek boiska', 'środek boiska', 'przedpole', 'pole karne'][Math.max(0, Math.min(3, zone))];
}

export function createMatchMode({ catalog, emblems, getUser, getSavedTeam, recordMatchResult, renderMatchPitch, discord }) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = discord;
  const sessions = new Map();
  const ownerSessions = new Map();

  function stat(player, key, state, side) {
    const staminaMap = side === 'home' ? state.homeStamina : state.awayStamina;
    const currentStamina = staminaMap[player.name] ?? player.stats?.stamina ?? 50;
    const value = Number(player.stats?.[key]);
    return (Number.isFinite(value) ? value : Math.max(20, (player.overall ?? 50) - 10))
      * staminaMultiplier(currentStamina);
  }

  function tpLeft(state, side, player) {
    const tpMap = side === 'home' ? state.homeTp : state.awayTp;
    return tpMap[player.name] ?? player.stats?.tp ?? 100;
  }

  function spendTp(state, side, player, cost) {
    const map = side === 'home' ? state.homeTp : state.awayTp;
    const available = tpLeft(state, side, player);
    if (available < cost) return false;
    map[player.name] = available - cost;
    return true;
  }

  function tire(state, side, player, amount = 10) {
    const map = side === 'home' ? state.homeStamina : state.awayStamina;
    const current = map[player.name] ?? player.stats?.stamina ?? 50;
    map[player.name] = Math.max(0, current - amount);
  }

  function pick(team, predicate, score) {
    const available = team.filter(predicate);
    const choices = available.length ? available : team;
    return [...choices].sort((a, b) => score(b) - score(a))[0];
  }

  function fieldPlayers(team) {
    return team.filter((player) => player.position !== 'Bramkarz');
  }

  function bestKeeper(team) {
    return team.find((player) => player.position === 'Bramkarz') ?? team[0];
  }

  function bestCarrier(team, state, side) {
    const current = team.find((player) => player.name === state.carrierName);
    if (current && current.position !== 'Bramkarz') return current;
    return pick(team, (player) => player.position !== 'Bramkarz',
      (player) => stat(player, 'control', state, side) + stat(player, 'speed', state, side) * 0.35);
  }

  function passScores(state, player, side) {
    return stat(player, 'intelligence', state, side) + stat(player, 'control', state, side) * 0.2;
  }

  function fieldPoint(state, side, player) {
    const team = side === 'home' ? state.home : state.away;
    const role = player.squadPosition ?? player.position ?? 'Pomocnik';
    const members = team.filter((entry) => (entry.squadPosition ?? entry.position ?? 'Pomocnik') === role);
    const index = members.findIndex((entry) => entry.name === player.name);
    const baseX = { home: { Bramkarz: 0.055, Obrońca: 0.20, Pomocnik: 0.37, Napastnik: 0.48 },
      away: { Bramkarz: 0.945, Obrońca: 0.80, Pomocnik: 0.63, Napastnik: 0.52 } };
    const advanceByRole = { Bramkarz: 0, Obrońca: 0.025, Pomocnik: 0.05, Napastnik: 0.075 };
    const progress = Math.max(0, Math.min(2, state.zone - 1));
    const defending = side !== state.phase;
    const direction = side === 'home' ? 1 : -1;
    const shift = progress * (advanceByRole[role] ?? 0) * (defending ? -0.65 : 1);
    return {
      x: (baseX[side][role] ?? baseX[side].Pomocnik) + direction * shift,
      y: (index + 1) / (members.length + 1),
    };
  }

  function closestDefenders(state, defenceSide, targetSide, targetPlayer) {
    const team = defenceSide === 'home' ? state.home : state.away;
    const target = targetPlayer ? fieldPoint(state, targetSide, targetPlayer) : {
      x: state.zone >= 3 ? (targetSide === 'home' ? 0.75 : 0.25) : 0.5,
      y: 0.5,
    };
    return fieldPlayers(team)
      .map((player) => {
        const point = fieldPoint(state, defenceSide, player);
        const distance = Math.hypot(point.x - target.x, (point.y - target.y) * 0.72);
        return { player, distance };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map(({ player }) => player);
  }

  function bestAvailableTechnique(state, side, player, predicate) {
    if (!player) return null;
    const options = (player.hissatsu ?? [])
      .filter(predicate)
      .map((move) => {
        const power = hissatsuPower(player);
        const cost = hissatsuTpCost(power);
        return { player, move, power, cost };
      })
      .filter((option) => tpLeft(state, side, player) >= option.cost);
    return options[0] ?? null;
  }

  function interceptionCandidates(state, passer, receiver, attackSide = 'home') {
    const defenceSide = attackSide === 'home' ? 'away' : 'home';
    const passStrength = passScores(state, passer, attackSide) + stat(receiver, 'control', state, attackSide) * 0.1;
    return closestDefenders(state, defenceSide, attackSide, receiver)
      .map((player) => {
        const interceptionStrength = stat(player, 'intelligence', state, defenceSide)
          + stat(player, 'speed', state, defenceSide) * 0.2
          + stat(player, 'body', state, defenceSide) * 0.1;
        return {
          player,
          strength: Math.round(interceptionStrength),
          chance: Math.round(contestChance(interceptionStrength, passStrength)),
        };
      })
      .sort((a, b) => b.chance - a.chance)
      .slice(0, 3);
  }

  function passTargets(state, action) {
    const carrier = bestCarrier(state.home, state, 'home');
    const pool = state.home.filter((player) => player.name !== carrier.name && player.squadPosition !== 'Bramkarz');
    const forwardsFirst = state.zone >= 2 || action === 'long-ball';
    const lines = action === 'pass-left' || action === 'pass-right'
      ? ['Pomocnik', 'Napastnik', 'Obrońca']
      : forwardsFirst ? ['Napastnik', 'Pomocnik', 'Obrońca'] : ['Pomocnik', 'Napastnik', 'Obrońca'];
    const lineRank = new Map(lines.map((position, index) => [position, index]));
    const leftSide = action === 'pass-left';
    const rightSide = action === 'pass-right';
    return [...pool].sort((a, b) => {
      const lineDiff = (lineRank.get(a.squadPosition) ?? 9) - (lineRank.get(b.squadPosition) ?? 9);
      if (lineDiff) return lineDiff;
      if (leftSide || rightSide) {
        const sideDiff = leftSide ? a.squadSlot - b.squadSlot : b.squadSlot - a.squadSlot;
        if (sideDiff) return sideDiff;
      }
      return stat(b, 'control', state, 'home') - stat(a, 'control', state, 'home');
    }).slice(0, 3);
  }

  function defensiveChoices(state) {
    const attacker = bestCarrier(state.away, state, 'away');
    return closestDefenders(state, 'home', 'away', attacker)
      .map((player) => {
        const defence = Math.round(stat(player, 'body', state, 'home')
          + stat(player, 'intelligence', state, 'home'));
        const attack = Math.round(stat(attacker, 'control', state, 'away')
          + stat(attacker, 'speed', state, 'away'));
        return { player, chance: duelDefenceChance(attack, defence) };
      })
      .sort((a, b) => b.chance - a.chance)
      .slice(0, 3);
  }

  function eligibleTechniques(state) {
    const team = state.home;
    const options = [];
    for (const player of team) {
      for (const move of player.hissatsu ?? []) {
        const power = hissatsuPower(player);
        const cost = hissatsuTpCost(power);
        if (tpLeft(state, 'home', player) < cost) continue;
        const type = move.type;
        if (state.phase === 'home') {
          const usableShot = type === 'Strzał' && (state.zone >= 3 || isLongShot(move));
          if (!usableShot) continue;
        } else {
          const defensive = isTackle(move) || (state.zone >= 3 && isShotBlock(move));
          const keeper = state.zone >= 3 && player.position === 'Bramkarz' && type === 'Obrona bramkarska';
          if (!defensive && !keeper) continue;
        }
        options.push({ player, move, power, cost });
      }
    }
    return options.slice(0, 25);
  }

  function dribbleOptions(state) {
    const carrier = bestCarrier(state.home, state, 'home');
    const techniques = (carrier?.hissatsu ?? [])
      .filter((move) => move.type === 'Drybling')
      .map((move) => {
        const power = hissatsuPower(carrier);
        const cost = hissatsuTpCost(power);
        return { player: carrier, move, power, cost };
      })
      .filter((option) => tpLeft(state, 'home', carrier) >= option.cost);
    return [
      ...techniques,
      {
        player: carrier,
        move: { name: 'Zwykły drybling bez Hissatsu', type: 'Drybling' },
        power: 0,
        cost: 0,
        normalDribble: true,
      },
    ];
  }

  function shotOptions(state) {
    const attacker = bestCarrier(state.home, state, 'home');
    const techniques = (attacker?.hissatsu ?? [])
      .filter((move) => move.type === 'Strzał' && (state.zone >= 3 || isLongShot(move)))
      .map((move) => ({ player: attacker, move, power: hissatsuPower(attacker), cost: hissatsuTpCost(hissatsuPower(attacker)) }))
      .filter((option) => tpLeft(state, 'home', attacker) >= option.cost);
    const options = [...techniques];
    if (state.zone >= 3) options.push({
      player: attacker,
      move: { name: 'Strzał bez Hissatsu', type: 'Strzał' },
      power: 0,
      cost: 0,
      normalShot: true,
    });
    return options;
  }

  function defensiveOptions(state, player) {
    const techniques = (player?.hissatsu ?? [])
      .filter((move) => isTackle(move) || (state.zone >= 3 && isShotBlock(move)))
      .map((move) => {
        const power = hissatsuPower(player);
        const cost = hissatsuTpCost(power);
        return { player, move, power, cost };
      })
      .filter((option) => tpLeft(state, 'home', player) >= option.cost);
    return [
      ...techniques,
      {
        player,
        move: { name: 'Bez techniki', type: 'Odbiór' },
        power: 0,
        cost: 0,
        normalDefense: true,
      },
    ];
  }

  function createDribbleDuel(state) {
    const attacker = bestCarrier(state.home, state, 'home');
    const defender = pick(fieldPlayers(state.away), () => true, (player) =>
      stat(player, 'intelligence', state, 'away')
      + stat(player, 'body', state, 'away') * 0.2
      + stat(player, 'speed', state, 'away') * 0.2);
    return {
      kind: 'dribble', attacker, defender,
      defenderMove: bestAvailableTechnique(state, 'away', defender, isTackle),
      options: dribbleOptions(state),
    };
  }

  function createDefenceDuel(state, defender) {
    const attacker = bestCarrier(state.away, state, 'away');
    return {
      kind: 'defence', attacker,
      defender,
      attackerMove: bestAvailableTechnique(state, 'away', attacker, (move) => move.type === 'Drybling'),
      options: defensiveOptions(state, defender),
    };
  }

  function createShotDuel(state) {
    const attacker = bestCarrier(state.home, state, 'home');
    return { kind: 'shot', attacker, defender: bestKeeper(state.away), options: shotOptions(state) };
  }

  function createKeeperDuel(state) {
    const keeper = bestKeeper(state.home);
    const techniques = (keeper?.hissatsu ?? [])
      .filter((move) => move.type === 'Obrona bramkarska')
      .map((move) => {
        const power = hissatsuPower(keeper);
        const cost = hissatsuTpCost(power);
        return { player: keeper, move, power, cost };
      })
      .filter((option) => tpLeft(state, 'home', keeper) >= option.cost);
    const noTechnique = { player: keeper, move: { name: 'Bez techniki', type: 'Obrona bramkarska' }, power: 0, cost: 0, normalKeeper: true };
    const attacker = bestCarrier(state.away, state, 'away');
    const attackMove = bestAvailableTechnique(state, 'away', attacker,
      (move) => move.type === 'Strzał' && (state.zone >= 3 || isLongShot(move)));
    return { kind: 'keeper', attacker, attackMove, defender: keeper, options: [...techniques, noTechnique] };
  }

  function awayPassTarget(state, action) {
    const passer = bestCarrier(state.away, state, 'away');
    const pool = state.away.filter((player) => player.name !== passer.name && player.position !== 'Bramkarz');
    const preferred = action === 'long-ball' || state.zone >= 2
      ? ['Napastnik', 'Pomocnik', 'Obrońca']
      : ['Pomocnik', 'Napastnik', 'Obrońca'];
    const rank = new Map(preferred.map((position, index) => [position, index]));
    const teamOrder = new Map(state.away.map((player, index) => [player.name, index]));
    const leftSide = action === 'pass-left';
    const rightSide = action === 'pass-right';
    const receiver = [...pool].sort((a, b) => {
      const line = (rank.get(a.position) ?? 9) - (rank.get(b.position) ?? 9);
      if (line) return line;
      if (leftSide || rightSide) {
        const side = leftSide
          ? teamOrder.get(a.name) - teamOrder.get(b.name)
          : teamOrder.get(b.name) - teamOrder.get(a.name);
        if (side) return side;
      }
      return stat(b, 'control', state, 'away') - stat(a, 'control', state, 'away');
    })[0];
    return receiver ? { passer, receiver } : null;
  }

  // The bot chooses its own attacking action. A pass is resolved automatically;
  // a dribble or shot then gives the player the matching defensive response.
  function prepareAwayAction(state, passDepth = 0) {
    if (state.phase !== 'away' || state.finished || state.halfTime) return;
    if (passDepth === 0) state.lastPass = null;
    const carrier = bestCarrier(state.away, state, 'away');
    const canLongShot = (carrier.hissatsu ?? []).some((move) => move.type === 'Strzał' && isLongShot(move));
    const forceProgress = passDepth >= 2;
    let action;
    const roll = Math.random();
    if (state.zone >= 3 && (forceProgress || roll < 0.68)) action = 'shot';
    else if (forceProgress) action = 'dribble';
    else if (state.zone >= 2 && canLongShot && roll < 0.18) action = 'shot';
    else if (state.zone >= 2 && roll < 0.3) action = 'long-ball';
    else if (roll < (state.zone >= 2 ? 0.52 : 0.6)) action = Math.random() < 0.5 ? 'pass-left' : 'pass-right';
    else if (roll < (state.zone >= 2 ? 0.62 : 0.7)) action = 'pass-forward';
    else action = 'dribble';

    state.awayAction = action;
    if (action === 'shot') {
      addLog(state, `Occult decyduje się na strzał — **${carrier.name}** przygotowuje uderzenie.`);
      state.pendingDuel = createKeeperDuel(state);
      return;
    }
    if (action === 'dribble') {
      const move = bestAvailableTechnique(state, 'away', carrier, (candidate) => candidate.type === 'Drybling');
      addLog(state, move
        ? `Occult rusza z dryblingiem. **${carrier.name}** przygotowuje Hissatsu **${move.move.name}**.`
        : `Occult rusza z piłką. **${carrier.name}** próbuje zwykłego dryblingu.`);
      return;
    }

    const target = awayPassTarget(state, action);
    if (!target) {
      state.awayAction = 'dribble';
      return;
    }
    const { passer, receiver } = target;
    const defenders = interceptionCandidates(state, passer, receiver, 'away');
    const defender = defenders[0];
    if (!defender) {
      state.awayAction = 'dribble';
      return;
    }
    const passChance = Math.max(18, Math.min(82, 100 - defender.chance));
    tire(state, 'away', passer, 10);
    const passText = action === 'long-ball' ? 'długą piłkę do' : action === 'pass-left'
      ? 'podanie na lewe skrzydło do' : action === 'pass-right'
        ? 'podanie na prawe skrzydło do' : action === 'pass-forward'
          ? 'podanie do przodu do' : 'podanie do';
    addLog(state, `${passer.name} decyduje się na ${passText} **${receiver.name}**.`);
    addLog(state, `Podanie: siła ${Math.round(passScores(state, passer, 'away') + stat(receiver, 'control', state, 'away') * 0.1)} · przechwyt: ${defender.strength}. Trzej obrońcy: ${defenders.map(({ player, chance }) => `${player.name} ${chance}%`).join(', ')}.`);
    if (Math.random() * 100 < passChance) {
      state.zone = Math.min(3, state.zone + (action === 'long-ball' ? 2 : 1));
      state.carrierName = receiver.name;
      state.lastPass = { side: 'away', from: passer.name, to: receiver.name, long: action === 'long-ball' };
      addLog(state, `Celne podanie! **${passer.name} → ${receiver.name}**. Szansa przechwytu ${defender.chance}%.`);
      prepareAwayAction(state, passDepth + 1);
    } else {
      state.homeAura = Math.min(10, state.homeAura + 1);
      addLog(state, `**${defender.player.name}** przechwytuje podanie (${defender.chance}%). Twoja drużyna rusza z kontrą.`);
      flipTo(state, 'home');
    }
  }

  function addLog(state, message) {
    state.log.push(`**${Math.min(state.minute, 90)}′** ${message}`);
    state.log = state.log.slice(-10);
  }

  function advanceTime(state) {
    const minutes = 5 + Math.floor(Math.random() * 3);
    state.minute = Math.min(90, state.minute + minutes);
  }

  function flipTo(state, side) {
    state.phase = side;
    state.awayAction = null;
    state.pendingDuel = null;
    state.zone = 1;
    const team = side === 'home' ? state.home : state.away;
    const carrier = pick(team, (player) => player.position !== 'Bramkarz',
      (player) => stat(player, 'control', state, side) + stat(player, 'speed', state, side) * 0.35);
    state.carrierName = carrier?.name ?? null;
  }

  function tryBlock(state, defendingSide, explicitMove = null) {
    const team = defendingSide === 'home' ? state.home : state.away;
    const moveOptions = explicitMove
      ? [explicitMove]
      : team.flatMap((player) => (player.hissatsu ?? [])
        .filter((move) => isShotBlock(move))
        .map((move) => ({ player, move, cost: hissatsuTpCost(hissatsuPower(player)) })));
    const candidate = moveOptions.find(({ player, cost }) => tpLeft(state, defendingSide, player) >= cost);
    if (!candidate) return { multiplier: 1, log: null };
    if (!spendTp(state, defendingSide, candidate.player, candidate.cost)) return { multiplier: 1, log: null };
    tire(state, defendingSide, candidate.player, 10);
    if (Math.random() >= 0.4) {
      return { multiplier: 1, log: `${candidate.player.name} używa **${candidate.move.name}**, ale blok nie osłabia strzału.` };
    }
    return {
      multiplier: 0.65,
      log: `${candidate.player.name} uruchamia **${candidate.move.name}** — 40% szansy na osłabienie strzału zadziałało!`,
    };
  }

  function resolveShot(state, attackSide, attacker, attackMove = null, chosenKeeperMove = null, chosenBlockMove = null) {
    const defenceSide = attackSide === 'home' ? 'away' : 'home';
    const defenceTeam = defenceSide === 'home' ? state.home : state.away;
    const keeper = bestKeeper(defenceTeam);
    const block = tryBlock(state, defenceSide, chosenBlockMove);
    if (block.log) addLog(state, block.log);

    let shotMove = attackMove;
    if (!shotMove && attackSide === 'away') {
      shotMove = bestAvailableTechnique(state, 'away', attacker,
        (move) => move.type === 'Strzał' && (state.zone >= 3 || isLongShot(move)));
    }
    if (shotMove && !shotMove.normalShot && !spendTp(state, attackSide, attacker, shotMove.cost)) shotMove = null;
    if (shotMove && !shotMove.normalShot) {
      addLog(state, `${attacker.name} używa **${shotMove.move.name}**!`);
      tire(state, attackSide, attacker, 25);
    } else {
      tire(state, attackSide, attacker, 25);
    }

    let keeperMove = chosenKeeperMove?.noTechnique ? null : chosenKeeperMove;
    if (!chosenKeeperMove) {
      keeperMove = bestAvailableTechnique(state, defenceSide, keeper, (move) => move.type === 'Obrona bramkarska');
    }
    const attackBase = Math.round(stat(attacker, 'kick', state, attackSide) + stat(attacker, 'control', state, attackSide) * 0.2);
    const defenceBase = Math.round(stat(keeper, 'guard', state, defenceSide) + stat(keeper, 'body', state, defenceSide) * 0.2);
    let attackTech = 0;
    let defenceTech = 0;
    if (shotMove && !shotMove.normalShot) attackTech = shotMove.power;
    if (keeperMove) {
      const move = keeperMove.move ?? keeperMove;
      const cost = keeperMove.cost ?? hissatsuTpCost(keeperMove.power ?? hissatsuPower(keeper));
      if (spendTp(state, defenceSide, keeper, cost)) {
        defenceTech = keeperMove.power ?? hissatsuPower(keeper);
        addLog(state, `${keeper.name} używa **${move.name}**!`);
        tire(state, defenceSide, keeper, 10);
      }
    }
    const attackBonus = attackSide === 'home' ? state.tacticBonuses.attack : 0;
    const keeperBonus = defenceSide === 'home' ? state.tacticBonuses.keeper : 0;
    if (attackSide === 'home') state.tacticBonuses.attack = 0;
    if (defenceSide === 'home') state.tacticBonuses.keeper = 0;
    const attackRng = Math.floor(Math.random() * 20) + 1;
    const defenceRng = Math.floor(Math.random() * 20) + 1;
    const blockPenalty = block.multiplier < 1 ? 20 : 0;
    const attackTotal = attackBase + attackTech + attackBonus + attackRng - blockPenalty;
    const defenceTotal = defenceBase + defenceTech + keeperBonus + defenceRng;
    addLog(state, `**Strzał — pojedynek:** Atak (Stat ${attackBase} + Tech ${attackTech} + Bonus ${attackBonus} + RNG ${attackRng} - Blok ${blockPenalty}) = **${attackTotal}** · Obrona (Stat ${defenceBase} + Tech ${defenceTech} + Bonus ${keeperBonus} + RNG ${defenceRng}) = **${defenceTotal}**.`);
    const goal = attackTotal > defenceTotal;
    if (goal) {
      state.score[attackSide] += 1;
      const scorer = shotMove?.move?.type === 'Strzał' && !shotMove.normalShot ? shotMove.move.name : 'strzał';
      addLog(state, `GOOOL! **${attacker.name}** trafia do siatki po: ${scorer}!`);
    } else {
      addLog(state, `**${keeper.name}** broni strzał ${attacker.name}!`);
    }
    flipTo(state, defenceSide);
  }

  function attackContest(state, action, moveData = null) {
    const passing = ['pass-forward', 'pass-left', 'pass-right', 'long-ball'].includes(action);
    state.lastPass = null;
    const actor = moveData?.player ?? bestCarrier(state.home, state, 'home');
    const defenders = passing ? interceptionCandidates(state, actor, moveData.receiver) : [];
    const defender = passing
      ? defenders[0]
      : pick(fieldPlayers(state.away), () => true, (player) => stat(player, 'intelligence', state, 'away') + stat(player, 'speed', state, 'away') * 0.2);
    const attackerScore = passing
      ? passScores(state, actor, 'home') + stat(moveData.receiver, 'control', state, 'home') * 0.1
      : stat(actor, 'control', state, 'home') + stat(actor, 'speed', state, 'home') * 0.4;
    const defenderScore = passing
      ? defender.strength
      : stat(defender, 'intelligence', state, 'away') + stat(defender, 'speed', state, 'away') * 0.2;
    const interceptionChance = passing ? defender.chance : 0;
    const passBonus = passing ? state.tacticBonuses.attack : 0;
    const chance = passing
      ? Math.max(18, Math.min(82, 100 - interceptionChance + passBonus * 0.4))
      : contestChance(attackerScore, defenderScore);
    const interception = Math.round(100 - chance);
    tire(state, 'home', actor, passing ? 10 : 20);
    if (passing) {
      state.tacticBonuses.attack = 0;
      addLog(state, `Debug: siła podania **${Math.round(attackerScore)}** vs siła przechwytu **${Math.round(defenderScore)}** (${interceptionChance}%). Trzej obrońcy: ${defenders.map(({ player, chance: p }) => `${player.name} ${p}%`).join(', ')}.`);
    }
    if (Math.random() * 100 < chance) {
      state.zone = Math.min(3, state.zone + (action === 'long-ball' ? 2 : 1));
      if (passing && moveData?.receiver) state.carrierName = moveData.receiver.name;
      else state.carrierName = actor.name;
      if (passing) {
        state.lastPass = { side: 'home', from: actor.name, to: moveData.receiver.name, long: action === 'long-ball' };
        const moveText = action === 'pass-left' ? 'zagrywa na lewe skrzydło' : action === 'pass-right' ? 'zagrywa na prawe skrzydło' : action === 'long-ball' ? 'posyła długą piłkę do' : 'podaje do';
        addLog(state, `${actor.name} ${moveText} **${moveData.receiver.name}**. ${defender.player.name} miał ${interceptionChance}% szansy przechwytu — podanie celne! Atak dochodzi na: **${zoneLabel(state.zone)}**.`);
      } else {
        addLog(state, `${actor.name} mija rywala dryblingiem i przesuwa atak na: **${zoneLabel(state.zone)}**.`);
      }
    } else {
      state.lastPass = null;
      state.awayAura = Math.min(10, state.awayAura + 1);
      const turnover = passing
        ? `${defender.player.name} przechwytuje podanie do ${moveData?.receiver?.name ?? 'zawodnika'} (szansa przechwytu ${interceptionChance}%). Occult rusza z kontrą.`
        : `${defender.name} zatrzymuje drybling ${actor.name} i odbiera piłkę. Occult rusza z kontrą.`;
      addLog(state, turnover);
      flipTo(state, 'away');
    }
  }

  function defend(state, defender) {
    if (state.awayAction !== 'dribble' || !defender || !fieldPlayers(state.home).some((player) => player.name === defender.name)) return false;
    state.pendingMenu = null;
    state.pendingAction = null;
    state.awayAction = null;
    state.pendingDuel = createDefenceDuel(state, defender);
    return true;
  }

  function defensiveTechnique(state, option) {
    const { player, move, power, cost } = option;
    if (state.zone >= 3 && isShotBlock(move)) {
      addLog(state, `${player.name} próbuje **${move.name}** przed strzałem.`);
      resolveShot(state, 'away', bestCarrier(state.away, state, 'away'), null, null, option);
      return null;
    }
    if (state.zone >= 3 && move.type === 'Obrona bramkarska') {
      addLog(state, `Occult oddaje strzał — ${player.name} odpowiada techniką **${move.name}**!`);
      resolveShot(state, 'away', bestCarrier(state.away, state, 'away'), null, option);
      return null;
    }
    if (!spendTp(state, 'home', player, cost)) return 'Ta technika nie ma już wystarczająco TP.';
    tire(state, 'home', player);

    const carrier = bestCarrier(state.away, state, 'away');
    const chance = contestChance(
      stat(player, 'body', state, 'home') + stat(player, 'speed', state, 'home') * 0.25 + power * 0.2,
      stat(carrier, 'control', state, 'away') + stat(carrier, 'speed', state, 'away') * 0.2,
    );
    if (Math.random() * 100 < chance) {
      addLog(state, `${player.name} odbiera piłkę techniką **${move.name}**!`);
      flipTo(state, 'home');
    } else if (state.zone >= 3) {
      addLog(state, `${carrier.name} omija technikę **${move.name}** i strzela!`);
      resolveShot(state, 'away', carrier);
    } else {
      state.zone += 1;
      addLog(state, `${carrier.name} unika **${move.name}** i atakuje dalej.`);
    }
    return null;
  }

  function duelDescription(state) {
    const duel = state.pendingDuel;
    if (!duel) return null;
    if (duel.kind === 'dribble') {
      const attack = Math.round(stat(duel.attacker, 'control', state, 'home') + stat(duel.attacker, 'speed', state, 'home'));
      const defence = Math.round(stat(duel.defender, 'body', state, 'away') + stat(duel.defender, 'intelligence', state, 'away'));
      const defenderMove = duel.defenderMove?.move?.name ?? 'bez techniki';
      return `**Mecz PvP — kontynuacja**\n${duel.attacker.name} prowadzi piłkę. Bot wybiera obrońcę: **${duel.defender.name}**.\n**Pojedynek — drybling**\nAtak bazowy: ${attack} · obrona bazowa: ${defence} · obrona bota: ${defenderMove}.\nWybierz Hissatsu zawodnika z piłką albo **Bez techniki**.`;
    }
    if (duel.kind === 'defence') {
      const attack = Math.round(stat(duel.attacker, 'control', state, 'away') + stat(duel.attacker, 'speed', state, 'away'));
      const defence = Math.round(stat(duel.defender, 'body', state, 'home') + stat(duel.defender, 'intelligence', state, 'home'));
      const attackMove = duel.attackerMove?.move?.name ?? 'bez Hissatsu';
      return `**Mecz PvP — kontynuacja**\nOccult: **${duel.attacker.name}** prowadzi piłkę. Ty bronisz zawodnikiem **${duel.defender.name}**.\n**Pojedynek — odbiór**\nAtak: ${attack} · twój odbiór: ${defence} · technika ataku Occult: ${attackMove}.\nWybierz Hissatsu obronne albo **Bez techniki**. Procent na przycisku obrońcy był szansą bazową bez Hissatsu.`;
    }
    if (duel.kind === 'shot') {
      return `**Mecz PvP — kontynuacja**\n${duel.attacker.name} ma piłkę ${state.zone >= 3 ? 'w polu karnym' : 'daleko od bramki'}.\n**Strzał na bramkę**\nWybierz Hissatsu strzału albo zwykły strzał bez techniki.`;
    }
    return `**Strzał na bramkę**\n${duel.attacker.name} oddaje strzał. ${duel.defender.name} przygotowuje się do obrony.\nWybierz Hissatsu bramkarskie albo obronę bez techniki.`;
  }

  function resolveDuel(state, option) {
    const duel = state.pendingDuel;
    if (!duel || !option) return;
    state.pendingDuel = null;
    const { attacker, defender, kind } = duel;
    if (kind === 'keeper') {
      const chosenKeeperMove = option.normalKeeper ? { noTechnique: true, player: defender } : option;
      resolveShot(state, 'away', attacker, duel.attackMove, chosenKeeperMove);
      return;
    }

    if (kind === 'shot') {
      resolveShot(state, 'home', attacker, option.normalShot ? null : option);
      return;
    }

    if (kind === 'defence' && state.zone >= 3 && isShotBlock(option.move)) {
      addLog(state, `${defender.name} ustawia blok przed strzałem Occult.`);
      resolveShot(state, 'away', attacker, null, null, option);
      return;
    }

    const offensiveMove = kind === 'dribble'
      ? (option.normalDribble ? null : option)
      : duel.attackerMove;
    const defensiveMove = kind === 'dribble'
      ? duel.defenderMove
      : (option.normalDefense ? null : option);
    if (offensiveMove && !spendTp(state, kind === 'dribble' ? 'home' : 'away', offensiveMove.player, offensiveMove.cost)) {
      state.pendingDuel = duel;
      return 'Za mało TP na tę technikę. Wybierz inną albo zagraj bez techniki.';
    }
    if (defensiveMove && !spendTp(state, kind === 'dribble' ? 'away' : 'home', defensiveMove.player, defensiveMove.cost)) {
      state.pendingDuel = duel;
      return 'Za mało TP na tę technikę. Wybierz inną albo zagraj bez techniki.';
    }
    if (offensiveMove) addLog(state, `${attacker.name} używa **${offensiveMove.move.name}**!`);
    if (defensiveMove) addLog(state, `${defender.name} odpowiada techniką **${defensiveMove.move.name}**!`);

    const attackStats = [
      Math.round(stat(attacker, 'control', state, kind === 'dribble' ? 'home' : 'away')),
      Math.round(stat(attacker, 'speed', state, kind === 'dribble' ? 'home' : 'away')),
    ];
    const defenceStats = [
      Math.round(stat(defender, 'body', state, kind === 'dribble' ? 'away' : 'home')),
      Math.round(stat(defender, 'intelligence', state, kind === 'dribble' ? 'away' : 'home')),
    ];
    const attackRng = Math.floor(Math.random() * 20) + 1;
    const defenceRng = Math.floor(Math.random() * 20) + 1;
    const attackTech = offensiveMove?.power ?? 0;
    const defenceTech = defensiveMove?.power ?? 0;
    const attackBonus = kind === 'dribble' ? state.tacticBonuses.attack : 0;
    const defenceBonus = kind === 'defence' ? state.tacticBonuses.defence : 0;
    if (kind === 'dribble') state.tacticBonuses.attack = 0;
    if (kind === 'defence') state.tacticBonuses.defence = 0;
    const attackTotal = attackStats[0] + attackStats[1] + attackTech + attackBonus + attackRng;
    const defenceTotal = defenceStats[0] + defenceStats[1] + defenceTech + defenceBonus + defenceRng;
    addLog(state, `**Pojedynek — ${kind === 'dribble' ? 'drybling' : 'odbiór'}:** Atak (Staty ${attackStats[0]} + ${attackStats[1]} + Tech ${attackTech} + Bonus ${attackBonus} + RNG ${attackRng}) = **${attackTotal}** · Obrona (Staty ${defenceStats[0]} + ${defenceStats[1]} + Tech ${defenceTech} + Bonus ${defenceBonus} + RNG ${defenceRng}) = **${defenceTotal}**.`);

    if (kind === 'dribble') {
      tire(state, 'home', attacker, 20);
      if (defensiveMove) tire(state, 'away', defender, 10);
      if (attackTotal > defenceTotal) {
        state.zone = Math.min(3, state.zone + 1);
        state.carrierName = attacker.name;
        addLog(state, `${attacker.name} wygrywa drybling z ${defender.name} i przechodzi do: **${zoneLabel(state.zone)}**.`);
      } else {
        addLog(state, `${defender.name} zatrzymuje drybling ${attacker.name}. Occult przejmuje piłkę.`);
        flipTo(state, 'away');
      }
      return null;
    }

    tire(state, 'home', defender, 10);
    if (offensiveMove) tire(state, 'away', attacker, 20);
    if (defenceTotal >= attackTotal) {
      state.homeAura = Math.min(10, state.homeAura + 1);
      addLog(state, 'Tactical Advantage! Zdobywasz 1 punkt Tactical Aura za przechwyt.');
      addLog(state, `${defender.name} wygrywa pojedynek i odbiera piłkę.`);
      flipTo(state, 'home');
    } else if (state.zone >= 3) {
      addLog(state, `${attacker.name} omija ${defender.name} i oddaje strzał.`);
      resolveShot(state, 'away', attacker, bestAvailableTechnique(state, 'away', attacker,
        (move) => move.type === 'Strzał' && (state.zone >= 3 || isLongShot(move))));
    } else {
      state.zone = Math.min(3, state.zone + 1);
      state.carrierName = attacker.name;
      addLog(state, `${attacker.name} omija ${defender.name} i atakuje dalej: **${zoneLabel(state.zone)}**.`);
    }
    return null;
  }

  function describe(state) {
    const possession = state.phase === 'home' ? state.username : 'Occult';
    const zone = zoneLabel(state.zone);
    const last = state.log.length ? state.log.join('\n') : 'Rozpoczyna się spotkanie. Twoja drużyna ma piłkę w środku boiska.';
    return `**${state.minute}′ / 90′**\n## ${state.score.home} : ${state.score.away}\nPiłka: **${possession}** · ${zone}\n\n${last}`;
  }

  function actionButton(state, id, label, style, disabled = false) {
    return new ButtonBuilder()
      .setCustomId(`mecz:${state.id}:${id}`)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);
  }

  function components(state, menu = null) {
    if (state.pendingDuel) {
      const choices = state.pendingDuel.options.map((option, index) => actionButton(
        state,
        'duel-option:' + index,
        option.normalDribble
          ? 'Bez techniki'
          : option.normalDefense
            ? 'Bez techniki'
            : option.normalKeeper
              ? 'Bez techniki'
            : option.normalShot
              ? option.move.name
              : `${option.move.name} (P: ${option.power} | TP: ${option.cost})`.slice(0, 80),
        option.normalDribble || option.normalDefense || option.normalKeeper ? ButtonStyle.Secondary : ButtonStyle.Primary,
      ));
      const rows = [];
      for (let index = 0; index < choices.length; index += 5) {
        rows.push(new ActionRowBuilder().addComponents(...choices.slice(index, index + 5)));
      }
      return rows;
    }
    if (state.pendingTactics) {
      const tactics = [
        ['tactic:defence-line', 'Cofnij obrońcę (4 TA)', 4],
        ['tactic:midfield-defence', 'Pomocnik do obrony (3 TA)', 3],
        ['tactic:midfield-attack', 'Pomocnik do ataku (5 TA)', 5],
        ['tactic:keeper-rush', 'Wybieg bramkarza (5 TA)', 5],
      ].map(([id, label, cost]) => actionButton(state, id, label, ButtonStyle.Primary, state.homeAura < cost));
      tactics.push(actionButton(state, 'cancel-menu', 'Wróć', ButtonStyle.Secondary));
      return [new ActionRowBuilder().addComponents(...tactics.slice(0, 5))];
    }
    if (state.halfTime) {
      const rows = [];
      const canSub = state.homeBench?.some((reserve) => state.home.some((starter) => starter.position === reserve.position));
      if (canSub && state.homeSubstitutions < 5) {
        rows.push(new ActionRowBuilder().addComponents(actionButton(state, 'sub', 'Dokonaj zmiany', ButtonStyle.Primary)));
      }
      rows.push(new ActionRowBuilder().addComponents(actionButton(state, 'continue-half', 'Rozpocznij drugą połowę', ButtonStyle.Success)));
      return rows;
    }
    if (menu) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`mecz-tech:${state.id}`)
        .setPlaceholder(state.pendingAction === 'dribble'
          ? 'Wybierz Hissatsu do dryblingu lub zwykły drybling'
          : state.phase === 'home' ? 'Wybierz technikę Hissatsu' : 'Wybierz technikę obronną')
        .addOptions(menu.map((option, index) => ({
          label: option.normalDribble ? option.move.name : `${option.move.name} · ${option.player.name}`.slice(0, 100),
          value: String(index),
          description: option.normalDribble
            ? 'Zwykły drybling · bez kosztu TP'
            : `${option.move.type} · moc ${option.power} · ${option.cost} TP`.slice(0, 100),
        })));
      return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(actionButton(state, 'cancel-menu', 'Wróć do akcji', ButtonStyle.Secondary))];
    }
    if (state.phase === 'home') {
      if (state.zone >= 3) {
        return [new ActionRowBuilder().addComponents(actionButton(state, 'shot', '🥅 Strzał na bramkę', ButtonStyle.Danger))];
      }
      const movement = [
        actionButton(state, 'pass-forward', '➤ Podaj do przodu', ButtonStyle.Primary),
        actionButton(state, 'pass-left', '◀ Zagraj na lewe skrzydło', ButtonStyle.Primary),
        actionButton(state, 'pass-right', 'Zagraj na prawe skrzydło ▶', ButtonStyle.Primary),
        actionButton(state, 'dribble', '⚒ Drybling', ButtonStyle.Secondary),
      ];
      const rows = [new ActionRowBuilder().addComponents(...movement)];
      const extra = [];
      if (state.zone >= 2) extra.push(actionButton(state, 'long-ball', '➤ Długa piłka', ButtonStyle.Success));
      const longShots = shotOptions(state).filter((option) => !option.normalShot);
      if (longShots.length) extra.push(actionButton(state, 'shot', 'Hissatsu (L)', ButtonStyle.Danger));
      if (extra.length) rows.push(new ActionRowBuilder().addComponents(...extra));
      if (state.homeAura > 0) rows.push(new ActionRowBuilder().addComponents(actionButton(state, 'tactics', `Taktyka (${state.homeAura} TA)`, ButtonStyle.Secondary)));
      return rows;
    }
    if (state.awayAction === 'shot') {
      return [new ActionRowBuilder().addComponents(actionButton(state, 'keeper', '🧤 Wybierz obronę bramkarza', ButtonStyle.Danger))];
    }
    const defenders = defensiveChoices(state);
    return [new ActionRowBuilder().addComponents(...defenders.map(({ player, chance }, index) =>
      actionButton(state, 'defend:' + index, `${player.name} (${chance}%)`, ButtonStyle.Primary)))];
  }

  function embed(state, footer = null) {
    const currentTeam = state.phase === 'home' ? state.home : state.away;
    const carrier = bestCarrier(currentTeam, state, state.phase);
    const tp = tpLeft(state, state.phase, carrier);
    const tpMax = carrier.stats?.tp ?? 100;
    const staminaMap = state.phase === 'home' ? state.homeStamina : state.awayStamina;
    const stamina = staminaMap[carrier.name] ?? carrier.stats?.stamina ?? 100;
    const staminaMax = carrier.stats?.stamina ?? 100;
    const sideName = state.phase === 'home' ? (state.teamName || state.username) : 'Occult';
    const instruction = state.halfTime
      ? 'Przerwa. Możesz zmienić skład i rozpocząć drugą połowę.'
      : state.pendingTactics
      ? `Masz **${state.homeAura} Tactical Aura**. Wybierz taktykę; jej bonus zadziała przy następnej odpowiedniej akcji.`
      : state.pendingDuel
      ? duelDescription(state)
      : state.phase === 'home'
      ? 'Wybierz akcję. Przy podaniu wskażesz jednego z trzech adresatów.'
      : state.awayAction === 'shot'
      ? 'Occult oddaje strzał. Wybierz technikę bramkarską albo obronę bez Hissatsu.'
      : state.awayAction === 'dribble'
      ? 'Occult rusza z dryblingiem. Wybierz jednego z trzech obrońców, a potem jego technikę odbioru. Procent na przycisku to bazowa szansa bez Hissatsu.'
      : 'Occult przygotowuje akcję.';
    const halftimeRoster = state.halfTime
      ? '\n\n**Twój skład**\n' + state.home.map((player) => `${player.squadPosition ?? player.position}: ${player.name} · TP ${tpLeft(state, 'home', player)}/${player.stats?.tp ?? 100} · Kondycja ${state.homeStamina[player.name] ?? player.stats?.stamina ?? 100}/${player.stats?.stamina ?? 100}`).join('\n')
        + '\n\n**Occult**\n' + state.away.map((player) => `${player.position}: ${player.name} · TP ${tpLeft(state, 'away', player)}/${player.stats?.tp ?? 100}`).join('\n')
      : '';
    return new EmbedBuilder()
      .setColor(state.phase === 'home' ? 0x2388d1 : 0xd7534f)
      .setTitle((state.halfTime ? '⏸️ Przerwa' : state.pendingDuel ? '⚔️ Mecz PvP — kontynuacja' : '⚡ Akcja!') + ' — ' + state.minute + '′')
      .setDescription(carrier.name + ' ma piłkę w strefie: ' + zoneLabel(state.zone) + ' (' + sideName + ').\nTP: ' + tp + '/' + tpMax + '  ·  Kondycja: ' + stamina + '/' + staminaMax + (state.log.length ? '\n\n**Ostatnie akcje**\n' + state.log.slice(-6).map((line) => line.replace(/\*\*/g, '')).join('\n') : '') + '\n\n' + instruction + halftimeRoster)
      .setFooter({ text: footer || ('Wynik ' + state.score.home + ' : ' + state.score.away + ' · ' + state.minute + '′') });
  }

  function promptPayload(state, menu = null, footer = null) {
    return { embeds: [embed(state, footer)], components: components(state, menu), attachments: [] };
  }

  async function payload(state, menu = null, footer = null) {
    const currentTeam = state.phase === 'home' ? state.home : state.away;
    const carrier = bestCarrier(currentTeam, state, state.phase);
    const pitch = await renderMatchPitch({
      home: state.home,
      away: state.away,
      homeCarrier: state.phase === 'home' ? carrier.name : null,
      awayCarrier: state.phase === 'away' ? carrier.name : null,
      phase: state.phase,
      zone: state.zone,
      minute: state.minute,
      score: state.score,
      possession: state.phase === 'home' ? (state.teamName || state.username) : 'Occult',
      teamName: state.teamName || state.username,
      awayName: 'Occult',
      lastAction: state.log.length ? state.log.slice(-6).map((line) => line.replace(/\*\*/g, '')).join(' · ') : 'Rozpoczyna się spotkanie.',
      lastPass: state.lastPass,
      footer,
    });
    const imageName = 'mecz-boisko.png';
    const matchEmbed = new EmbedBuilder().setColor(0x167b37).setImage(`attachment://${imageName}`);
    return {
      content: '',
      embeds: [matchEmbed],
      components: [],
      files: [{ attachment: Buffer.from(pitch), name: imageName }],
      attachments: [],
    };
  }

  async function finish(interaction, state) {
    const result = state.score.home > state.score.away ? 'win' : state.score.home < state.score.away ? 'loss' : 'draw';
    const record = recordMatchResult(state.guildId, state.userId, result);
    sessions.delete(state.id);
    ownerSessions.delete(`${state.guildId}:${state.userId}`);
    const label = result === 'win' ? 'ZWYCIĘSTWO!' : result === 'loss' ? 'PORAŻKA' : 'REMIS';
    const finalView = await payload(state, null, `${label} · bilans meczów: ${record.played} rozegranych, ${record.wins} wygranych`);
    await interaction.update({ ...finalView, components: [] });
  }

  async function commitAction(interaction, state, action, option = null) {
    if (state.finished) {
      await interaction.reply({ content: 'Ten mecz już się zakończył.', ephemeral: true });
      return;
    }
    const previousMinute = state.minute;
    advanceTime(state);
    if (action === 'duel-option' && state.pendingDuel) {
      const failure = resolveDuel(state, option);
      if (failure) {
        state.minute = previousMinute;
        await interaction.reply({ content: failure, ephemeral: true });
        return;
      }
    } else if (state.phase === 'home') {
      if (['pass-forward', 'pass-left', 'pass-right', 'long-ball'].includes(action)) attackContest(state, action, option);
      else if (action === 'dribble' && option) {
        if (option.normalDribble) {
          attackContest(state, 'dribble', { player: option.player });
        } else if (option.move?.type === 'Drybling') {
          if (!spendTp(state, 'home', option.player, option.cost)) {
            await interaction.reply({ content: `${option.player.name} nie ma już wystarczająco TP.`, ephemeral: true });
            state.minute = previousMinute;
            return;
          }
          addLog(state, `${option.player.name} używa **${option.move.name}** do dryblingu!`);
          attackContest(state, 'dribble', option);
        }
      }
      else if (action === 'shot') {
        if (state.zone < 3) {
          await interaction.reply({ content: 'Zwykły strzał możesz oddać z pola karnego. Spróbuj podania, dryblingu albo Hissatsu z oznaczeniem (L).', ephemeral: true });
          state.minute = previousMinute;
          return;
        }
        const attacker = pick(state.home, (player) => player.position === 'Napastnik',
          (player) => stat(player, 'kick', state, 'home'));
        tire(state, 'home', attacker);
        resolveShot(state, 'home', attacker);
      } else if (action === 'tech' && option) {
        if (!spendTp(state, 'home', option.player, option.cost)) {
          await interaction.reply({ content: `${option.player.name} nie ma już wystarczająco TP.`, ephemeral: true });
          state.minute = previousMinute;
          return;
        }
        if (option.move.type === 'Strzał') {
          if (state.zone < 3 && !isLongShot(option.move)) {
            await interaction.reply({ content: 'Ta technika nie ma oznaczenia (L), więc można jej użyć tylko z pola karnego.', ephemeral: true });
            state.minute = previousMinute;
            return;
          }
          tire(state, 'home', option.player);
          addLog(state, `${option.player.name} używa **${option.move.name}**!`);
          resolveShot(state, 'home', option.player, option);
        }
      }
    } else if (action === 'tech' && option) {
      const failure = defensiveTechnique(state, option);
      if (failure) {
        await interaction.reply({ content: failure, ephemeral: true });
        state.minute = previousMinute;
        return;
      }
    }
    if (state.phase === 'away' && !state.pendingDuel && !state.awayAction) prepareAwayAction(state);
    if (state.minute >= 45 && !state.halfTimePassed && state.minute < 90) {
      state.minute = 45;
      state.halfTimePassed = true;
      state.halfTime = true;
      state.pendingDuel = null;
      state.awayAction = null;
      addLog(state, 'Koniec pierwszej połowy. Czas na zmiany w składzie.');
    }
    if (state.minute >= 90) {
      state.finished = true;
      await finish(interaction, state);
      return;
    }
    await interaction.update(await payload(state));
    await interaction.followUp(promptPayload(state));
  }

  async function start(interaction) {
    const slot = interaction.options.getInteger('slot') ?? 1;
    const ownerKey = `${interaction.guildId}:${interaction.user.id}`;
    if (ownerSessions.has(ownerKey)) {
      await interaction.reply({ content: 'Masz już aktywny mecz. Dokończ go z przycisków w poprzedniej wiadomości.', ephemeral: true });
      return;
    }
    const user = getUser(interaction.guildId, interaction.user.id);
    const saved = getSavedTeam(user, slot);
    if (!saved || saved.players?.length !== 11) {
      await interaction.reply({ content: `Slot ${slot}/4 nie ma zapisanego składu z 11 zawodnikami. Ustaw go przez /team.`, ephemeral: true });
      return;
    }
    const [defenderCount, midfielderCount, forwardCount] = (saved.formation ?? '4-4-2').split('-').map(Number);
    const slotPositions = ['Bramkarz', ...Array(defenderCount).fill('Obrońca'), ...Array(midfielderCount).fill('Pomocnik'), ...Array(forwardCount).fill('Napastnik')];
    const home = saved.players.map((name, index) => {
      const player = catalog.find((entry) => entry.name === name);
      return player ? { ...player, squadPosition: saved.positions?.[index] ?? slotPositions[index] ?? player.position, squadSlot: index + 1 } : null;
    }).filter(Boolean);
    const away = catalog.filter((player) => player.team?.toLocaleLowerCase('pl') === 'occult');
    if (home.length !== 11) {
      await interaction.reply({ content: 'W składzie są karty, których brakuje w katalogu bota. Zapisz skład ponownie przez /team.', ephemeral: true });
      return;
    }
    if (!home.some((player) => player.position === 'Bramkarz')) {
      await interaction.reply({ content: `Slot ${slot}/4 nie zawiera bramkarza. Ustaw bramkarza przez /team i spróbuj ponownie.`, ephemeral: true });
      return;
    }
    if (away.length !== 11) {
      await interaction.reply({ content: `W katalogu drużyna Occult ma ${away.length}/11 zawodników. Nie można rozpocząć meczu.`, ephemeral: true });
      return;
    }
    if (!away.some((player) => player.position === 'Bramkarz')) {
      await interaction.reply({ content: 'W składzie Occult brakuje bramkarza. Mecz nie może się rozpocząć.', ephemeral: true });
      return;
    }
    const id = Math.random().toString(36).slice(2, 10);
    const state = {
      id,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.username,
      teamName: emblems.find((emblem) => emblem.id === saved.emblem)?.name ?? 'Twoja drużyna',
      formation: saved.formation ?? '4-4-2',
      slot,
      home,
      homeBench: (saved.substitutes ?? []).map((name) => catalog.find((player) => player.name === name)).filter((player) => player && !home.some((starter) => starter.name === player.name)).slice(0, 5),
      homeSubstitutions: 0,
      pendingSubOut: null,
      away,
      phase: 'away',
      awayAction: null,
      halfTime: false,
      halfTimePassed: false,
      pendingTactics: false,
      homeAura: 0,
      awayAura: 0,
      tacticBonuses: { attack: 0, defence: 0, keeper: 0 },
      carrierName: null,
      pendingPass: null,
      pendingMenu: null,
      pendingDuel: null,
      zone: 1,
      minute: 1,
      score: { home: 0, away: 0 },
      log: [],
      lastPass: null,
      homeTp: Object.fromEntries(home.map((player) => [player.name, player.stats?.tp ?? 100])),
      awayTp: Object.fromEntries(away.map((player) => [player.name, player.stats?.tp ?? 100])),
      homeStamina: Object.fromEntries(home.map((player) => [player.name, player.stats?.stamina ?? 50])),
      awayStamina: Object.fromEntries(away.map((player) => [player.name, player.stats?.stamina ?? 50])),
      pendingAction: null,
      finished: false,
    };
    state.carrierName = bestCarrier(away, state, 'away')?.name ?? null;
    prepareAwayAction(state);
    sessions.set(id, state);
    ownerSessions.set(ownerKey, id);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x25864a).setTitle('⚙️ PIERWSZY GWIZDEK!').setDescription('Mecz został rozpoczęty. Niech wygra lepszy!')] });
    await interaction.followUp(await payload(state, null, 'Mecz rozpoczyna się'));
    await interaction.followUp({ ...promptPayload(state, null, 'Rozpoczęcie · wybierz zawodnika do przechwytu.'), fetchReply: true });
  }

  async function handleButton(interaction) {
    const [, id, action, parameter] = interaction.customId.split(':');
    const state = sessions.get(id);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({ content: 'Ta sesja meczu wygasła albo należy do innego gracza.', ephemeral: true });
      return;
    }
    if (action === 'tech') {
      const options = eligibleTechniques(state);
      if (!options.length) {
        await interaction.reply({ content: 'W tej sytuacji nie masz dostępnej techniki Hissatsu z wystarczającą liczbą TP.', ephemeral: true });
        return;
      }
      state.pendingMenu = options;
      state.pendingAction = 'tech';
      await interaction.update(promptPayload(state, options));
      return;
    }
    if (action === 'dribble') {
      if (state.phase !== 'home') {
        await interaction.reply({ content: 'Możesz rozpocząć drybling tylko wtedy, gdy twoja drużyna ma piłkę.', ephemeral: true });
        return;
      }
      state.pendingMenu = null;
      state.pendingAction = null;
      state.pendingDuel = createDribbleDuel(state);
      await interaction.update(promptPayload(state));
      return;
    }
    if (action === 'shot') {
      if (state.phase !== 'home') {
        await interaction.reply({ content: 'Strzał wybierzesz, gdy twoja drużyna będzie miała piłkę.', ephemeral: true });
        return;
      }
      const options = shotOptions(state);
      if (!options.length) {
        await interaction.reply({ content: 'Na tej pozycji nie ma dostępnego strzału Hissatsu (L).', ephemeral: true });
        return;
      }
      state.pendingMenu = null;
      state.pendingAction = null;
      state.pendingDuel = createShotDuel(state);
      await interaction.update(promptPayload(state));
      return;
    }
    if (action === 'tactics') {
      if (state.phase !== 'home' || state.halfTime) {
        await interaction.reply({ content: 'Taktykę wybierzesz podczas swojej akcji.', ephemeral: true });
        return;
      }
      state.pendingTactics = true;
      await interaction.update(promptPayload(state));
      return;
    }
    if (action === 'tactic') {
      const options = {
        'defence-line': { cost: 4, key: 'defence', bonus: 20, name: 'Cofnij obrońcę' },
        'midfield-defence': { cost: 3, key: 'defence', bonus: 12, name: 'Pomocnik do obrony' },
        'midfield-attack': { cost: 5, key: 'attack', bonus: 18, name: 'Pomocnik do ataku' },
        'keeper-rush': { cost: 5, key: 'keeper', bonus: 18, name: 'Wybieg bramkarza' },
      };
      const tactic = options[parameter];
      if (!state.pendingTactics || !tactic || state.homeAura < tactic.cost) {
        await interaction.reply({ content: 'Nie masz wystarczająco Tactical Aura na tę taktykę.', ephemeral: true });
        return;
      }
      state.homeAura -= tactic.cost;
      state.tacticBonuses[tactic.key] += tactic.bonus;
      state.pendingTactics = false;
      addLog(state, `Taktyka **${tactic.name}** aktywna: +${tactic.bonus} do następnej odpowiedniej akcji.`);
      await interaction.update(promptPayload(state));
      return;
    }
    if (action === 'duel-option') {
      const option = state.pendingDuel?.options[Number(parameter)];
      if (!option) {
        await interaction.reply({ content: 'Ten wybór pojedynku wygasł. Rozpocznij akcję ponownie.', ephemeral: true });
        return;
      }
      await commitAction(interaction, state, action, option);
      return;
    }
    if (['pass-forward', 'pass-left', 'pass-right', 'long-ball'].includes(action)) {
      const targets = passTargets(state, action);
      if (!targets.length) {
        await interaction.reply({ content: 'Nie ma teraz dostępnego adresata podania z tej strefy.', ephemeral: true });
        return;
      }
      state.pendingPass = { action, targets: targets.map((player) => player.name) };
      const laneName = action === 'pass-left' ? 'lewe skrzydło' : action === 'pass-right' ? 'prawe skrzydło' : action === 'long-ball' ? 'długą piłkę' : 'podanie do przodu';
      const targetButtons = targets.map((player, index) => actionButton(
        state,
        'receive:' + index,
        `${player.name} · ${player.squadPosition}`.slice(0, 80),
        ButtonStyle.Primary,
      ));
      await interaction.update({
        ...promptPayload(state, null, `Wybierz jednego z trzech adresatów: ${laneName}. Zawodnicy są dobrani do aktualnej strefy boiska.`),
        components: [new ActionRowBuilder().addComponents(...targetButtons), new ActionRowBuilder().addComponents(actionButton(state, 'cancel-menu', 'Wróć do akcji', ButtonStyle.Secondary))],
      });
      return;
    }
    if (action === 'receive') {
      const pending = state.pendingPass;
      const receiver = state.home.find((player) => player.name === pending?.targets?.[Number(parameter)]);
      if (!receiver || state.phase !== 'home') {
        state.pendingPass = null;
        await interaction.reply({ content: 'Wybór adresata wygasł. Wybierz akcję ponownie.', ephemeral: true });
        return;
      }
      const passer = bestCarrier(state.home, state, 'home');
      state.pendingPass = null;
      await commitAction(interaction, state, pending.action, { player: passer, receiver });
      return;
    }
    if (action === 'defend') {
      const defender = defensiveChoices(state)[Number(parameter)]?.player;
      if (!defender || state.phase !== 'away' || state.awayAction !== 'dribble') {
        await interaction.reply({ content: 'Wybór obrońcy wygasł. Wybierz ponownie.', ephemeral: true });
        return;
      }
      defend(state, defender);
      await interaction.update(promptPayload(state));
      return;
    }
    if (action === 'keeper') {
      if (state.phase !== 'away' || state.zone < 3) {
        await interaction.reply({ content: 'Bramkarz może wejść do akcji, gdy Occult jest blisko bramki.', ephemeral: true });
        return;
      }
      state.pendingMenu = null;
      state.pendingAction = null;
      state.pendingDuel = createKeeperDuel(state);
      await interaction.update(promptPayload(state));
      return;
    }
    if (action === 'sub') {
      if (!state.halfTime) {
        await interaction.reply({ content: 'Zmiany składu są dostępne w przerwie między połowami.', ephemeral: true });
        return;
      }
      if (!state.homeBench?.length || state.homeSubstitutions >= 5) {
        await interaction.reply({ content: 'Nie masz dostępnych rezerwowych albo wykorzystałeś już pięć zmian.', ephemeral: true });
        return;
      }
      const eligibleOutgoing = state.home.filter((starter) => state.homeBench.some((reserve) => reserve.position === starter.position));
      if (!eligibleOutgoing.length) {
        await interaction.reply({ content: 'Na ławce nie ma zmiennika na żadną pozycję podstawowego składu.', ephemeral: true });
        return;
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId(`mecz-sub-out:${state.id}`)
        .setPlaceholder('Wybierz zawodnika schodzącego z boiska')
        .addOptions(eligibleOutgoing.map((player) => ({
          label: player.name.slice(0, 100),
          value: player.name,
          description: `${player.position} · OVR ${player.overall}`.slice(0, 100),
        })));
      const substitutionView = promptPayload(state, null, 'Wybierz zawodnika, którego chcesz zmienić.');
      await interaction.update({
        ...substitutionView,
        components: [
          new ActionRowBuilder().addComponents(select),
          new ActionRowBuilder().addComponents(actionButton(state, 'cancel-menu', 'Wróć do akcji', ButtonStyle.Secondary)),
        ],
      });
      return;
    }
    if (action === 'continue-half') {
      if (!state.halfTime) {
        await interaction.reply({ content: 'Przerwa już się skończyła.', ephemeral: true });
        return;
      }
      state.halfTime = false;
      addLog(state, 'Rozpoczyna się druga połowa.');
      if (state.phase === 'away') prepareAwayAction(state);
      await interaction.update(promptPayload(state));
      return;
    }
    if (action === 'cancel-menu') {
      state.pendingSubOut = null;
      state.pendingMenu = null;
      state.pendingAction = null;
      state.pendingPass = null;
      state.pendingDuel = null;
      state.pendingTactics = false;
      await interaction.update(promptPayload(state));
      return;
    }
    await commitAction(interaction, state, action);
  }

  async function handleSubstitution(interaction) {
    const [prefix, actualId] = interaction.customId.split(':');
    const current = sessions.get(actualId);
    if (!current || current.userId !== interaction.user.id || current.finished) {
      await interaction.reply({ content: 'Ta zmiana wygasła albo należy do innego gracza.', ephemeral: true });
      return;
    }
    if (interaction.customId.startsWith('mecz-sub-out:')) {
      const outgoing = current.home.find((player) => player.name === interaction.values[0]);
      if (!outgoing || !current.homeBench?.some((player) => player.position === outgoing.position) || current.homeSubstitutions >= 5) {
        await interaction.reply({ content: 'Ta zmiana nie jest już dostępna.', ephemeral: true });
        return;
      }
      current.pendingSubOut = outgoing.name;
      const incomingMenu = new StringSelectMenuBuilder()
        .setCustomId(`mecz-sub-in:${actualId}`)
        .setPlaceholder('Wybierz rezerwowego wchodzącego do gry')
        .addOptions(current.homeBench.filter((player) => player.position === outgoing.position).map((player) => ({
          label: player.name.slice(0, 100),
          value: player.name,
          description: `${player.position} · OVR ${player.overall}`.slice(0, 100),
        })));
      const substitutionView = promptPayload(current, null, outgoing.name + ' schodzi. Wybierz jego zmiennika.');
      await interaction.update({
        ...substitutionView,
        components: [
          new ActionRowBuilder().addComponents(incomingMenu),
          new ActionRowBuilder().addComponents(actionButton(current, 'cancel-menu', 'Anuluj zmianę', ButtonStyle.Secondary)),
        ],
      });
      return;
    }

    const outgoingName = current.pendingSubOut;
    const outgoingIndex = current.home.findIndex((player) => player.name === outgoingName);
    const incomingIndex = current.homeBench.findIndex((player) => player.name === interaction.values[0]);
    if (outgoingIndex < 0 || incomingIndex < 0 || current.homeSubstitutions >= 5) {
      current.pendingSubOut = null;
      await interaction.reply({ content: 'Nie udało się wykonać zmiany. Spróbuj ponownie.', ephemeral: true });
      return;
    }

    const outgoing = current.home[outgoingIndex];
    const incoming = current.homeBench[incomingIndex];
    current.home[outgoingIndex] = incoming;
    current.homeBench.splice(incomingIndex, 1);
    current.homeBench.push(outgoing);
    current.homeTp[incoming.name] ??= incoming.stats?.tp ?? 100;
    current.homeStamina[incoming.name] ??= incoming.stats?.stamina ?? 50;
    current.pendingSubOut = null;
    current.homeSubstitutions += 1;
    if (!current.halfTime) current.minute = Math.min(90, current.minute + 6);
    if (current.carrierName === outgoing.name) current.carrierName = incoming.name;
    addLog(current, `Zmiana: **${incoming.name}** wchodzi za **${outgoing.name}**.`);
    if (!current.halfTime) flipTo(current, 'away');
    if (current.minute >= 90) {
      current.finished = true;
      await finish(interaction, current);
      return;
    }
    await interaction.update(await payload(current));
    await interaction.followUp(promptPayload(current));
  }

  async function handleTechnique(interaction) {
    const id = interaction.customId.slice('mecz-tech:'.length);
    const state = sessions.get(id);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({ content: 'Ta sesja meczu wygasła albo należy do innego gracza.', ephemeral: true });
      return;
    }
    const options = state.pendingMenu ?? eligibleTechniques(state);
    const option = options[Number(interaction.values[0])];
    if (!option) {
      await interaction.reply({ content: 'Ta technika nie jest już dostępna w tej sytuacji.', ephemeral: true });
      return;
    }
    const action = state.pendingAction ?? 'tech';
    state.pendingMenu = null;
    state.pendingAction = null;
    await commitAction(interaction, state, action, option);
  }

  return { start, handleButton, handleTechnique, handleSubstitution };
}
