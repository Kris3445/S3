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

  function tire(state, side, player) {
    const map = side === 'home' ? state.homeStamina : state.awayStamina;
    const current = map[player.name] ?? player.stats?.stamina ?? 50;
    map[player.name] = Math.max(0, current - 2);
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
    return pick(team, (player) => player.position !== 'Bramkarz',
      (player) => stat(player, 'control', state, side) + stat(player, 'speed', state, side) * 0.35);
  }

  function eligibleTechniques(state, side = state.phase) {
    const team = side === 'home' ? state.home : state.away;
    const options = [];
    for (const player of team) {
      for (const move of player.hissatsu ?? []) {
        const power = hissatsuPower(player);
        const cost = hissatsuTpCost(power);
        if (tpLeft(state, side, player) < cost) continue;
        const type = move.type;
        if (side === 'home') {
          const usableShot = type === 'Strzał' && (state.zone >= 3 || isLongShot(move));
          const usableDribble = type === 'Drybling';
          if (!usableShot && !usableDribble) continue;
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

  function addLog(state, message) {
    state.log.push(`**${Math.min(state.minute, 90)}′** ${message}`);
    state.log = state.log.slice(-5);
  }

  function flipTo(state, side) {
    state.phase = side;
    state.zone = 1;
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
    tire(state, defendingSide, candidate.player);
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

    let keeperMove = chosenKeeperMove;
    if (!keeperMove) {
      const moves = (keeper.hissatsu ?? []).filter((move) => move.type === 'Obrona bramkarska');
      const automatic = moves
        .map((move) => ({ move, power: hissatsuPower(keeper), cost: hissatsuTpCost(hissatsuPower(keeper)) }))
        .find(({ cost }) => tpLeft(state, defenceSide, keeper) >= cost);
      if (automatic) keeperMove = automatic;
    }

    let keeperStrength = stat(keeper, 'guard', state, defenceSide) + stat(keeper, 'body', state, defenceSide) * 0.15;
    if (keeperMove) {
      const move = keeperMove.move ?? keeperMove;
      const power = keeperMove.power ?? hissatsuPower(keeper);
      const cost = keeperMove.cost ?? hissatsuTpCost(power);
      if (spendTp(state, defenceSide, keeper, cost)) {
        keeperStrength += power * 0.35;
        tire(state, defenceSide, keeper);
        addLog(state, `${keeper.name} używa **${move.name}**!`);
      }
    }

    const shotPower = attackMove
      ? (attackMove.power ?? hissatsuPower(attacker)) + stat(attacker, 'kick', state, attackSide) * 0.25
      : stat(attacker, 'kick', state, attackSide) + 15;
    const chance = goalChance(shotPower, keeperStrength, block.multiplier);
    const goal = Math.random() * 100 < chance;
    if (goal) {
      state.score[attackSide] += 1;
      const scorer = attackMove?.move?.type === 'Strzał' ? attackMove.move.name : 'strzał';
      addLog(state, `GOOOL! **${attacker.name}** trafia do siatki po: ${scorer}!`);
    } else {
      addLog(state, `**${keeper.name}** broni strzał ${attacker.name}!`);
    }
    flipTo(state, defenceSide);
  }

  function attackContest(state, action, moveData = null) {
    const actor = moveData?.player ?? (action === 'pass'
      ? pick(state.home, (player) => player.position === 'Pomocnik', (player) => stat(player, 'intelligence', state, 'home'))
      : pick(state.home, (player) => player.position === 'Napastnik' || player.position === 'Pomocnik',
        (player) => stat(player, 'control', state, 'home') + stat(player, 'speed', state, 'home')));
    const defenders = fieldPlayers(state.away);
    const defender = pick(defenders, () => true, (player) => action === 'pass'
      ? stat(player, 'intelligence', state, 'away') + stat(player, 'speed', state, 'away') * 0.2
      : stat(player, 'body', state, 'away') + stat(player, 'speed', state, 'away') * 0.3);
    const attackerScore = action === 'pass'
      ? stat(actor, 'intelligence', state, 'home') + stat(actor, 'control', state, 'home') * 0.2
      : stat(actor, 'control', state, 'home') + stat(actor, 'speed', state, 'home') * 0.4;
    const defenderScore = action === 'pass'
      ? stat(defender, 'intelligence', state, 'away') + stat(defender, 'speed', state, 'away') * 0.2
      : stat(defender, 'body', state, 'away') + stat(defender, 'speed', state, 'away') * 0.3;
    const bonus = moveData ? Math.min(18, moveData.power * 0.12) : 0;
    const chance = contestChance(attackerScore, defenderScore, bonus);
    tire(state, 'home', actor);
    if (Math.random() * 100 < chance) {
      state.zone = Math.min(3, state.zone + 1);
      addLog(state, `${actor.name} ${action === 'pass' ? 'wymienia podanie' : 'mija rywala dryblingiem'} i przesuwa atak na: **${zoneLabel(state.zone)}**.`);
    } else {
      addLog(state, `${defender.name} przechwytuje piłkę! Occult rusza z kontrą.`);
      flipTo(state, 'away');
    }
  }

  function defend(state) {
    const attacker = bestCarrier(state.away, state, 'away');
    const defender = pick(fieldPlayers(state.home), () => true,
      (player) => stat(player, 'intelligence', state, 'home') + stat(player, 'speed', state, 'home') * 0.2 + stat(player, 'body', state, 'home') * 0.2);
    const attackerScore = stat(attacker, 'control', state, 'away') + stat(attacker, 'speed', state, 'away') * 0.35;
    const defenderScore = stat(defender, 'intelligence', state, 'home') + stat(defender, 'speed', state, 'home') * 0.2 + stat(defender, 'body', state, 'home') * 0.2;
    const chance = contestChance(defenderScore, attackerScore);
    tire(state, 'home', defender);
    if (Math.random() * 100 < chance) {
      addLog(state, `${defender.name} odbiera piłkę i zatrzymuje atak Occult.`);
      flipTo(state, 'home');
    } else if (state.zone >= 3) {
      addLog(state, `${attacker.name} ucieka spod pressingu i oddaje strzał!`);
      resolveShot(state, 'away', attacker);
    } else {
      state.zone += 1;
      addLog(state, `${attacker.name} omija press i przesuwa atak Occult na: **${zoneLabel(state.zone)}**.`);
    }
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
    if (menu) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`mecz-tech:${state.id}`)
        .setPlaceholder(state.phase === 'home' ? 'Wybierz technikę do ataku' : 'Wybierz odbiór albo obronę bramkarza')
        .addOptions(menu.map((option, index) => ({
          label: `${option.move.name} · ${option.player.name}`.slice(0, 100),
          value: String(index),
          description: `${option.move.type} · moc ${option.power} · ${option.cost} TP`.slice(0, 100),
        })));
      return [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(actionButton(state, 'cancel-menu', 'Wróć do akcji', ButtonStyle.Secondary)),
      ];
    }
    if (state.phase === 'home') {
      const moves = eligibleTechniques(state, 'home');
      const actions = [
        actionButton(state, 'pass', 'Podanie', ButtonStyle.Primary),
        actionButton(state, 'dribble', 'Drybling', ButtonStyle.Primary),
        actionButton(state, 'shot', 'Strzał', ButtonStyle.Danger, state.zone < 3),
        actionButton(state, 'tech', 'Hissatsu', ButtonStyle.Success, moves.length === 0),
      ];
      const canSubstitute = state.homeBench?.some((reserve) => state.home.some((starter) => starter.position === reserve.position));
      if (canSubstitute && state.homeSubstitutions < 5) {
        actions.push(actionButton(state, 'sub', `Zmiana ${state.homeSubstitutions}/5`, ButtonStyle.Secondary));
      }
      return [new ActionRowBuilder().addComponents(...actions)];
    }
    const moves = eligibleTechniques(state, 'away');
    const row = [
      actionButton(state, 'press', 'Pressing', ButtonStyle.Primary),
      actionButton(state, 'tech', 'Hissatsu obronne', ButtonStyle.Success, moves.length === 0),
    ];
    if (state.zone >= 3) row.push(actionButton(state, 'keeper', 'Obrona bramkarza', ButtonStyle.Danger));
    return [new ActionRowBuilder().addComponents(...row)];
  }

  function embed(state, footer = null) {
    const userTeamName = state.teamName || 'Twoja drużyna';
    const currentPlayers = state.phase === 'home' ? state.home : state.away;
    const currentSide = state.phase;
    const carrier = bestCarrier(currentPlayers, state, currentSide);
    const tp = tpLeft(state, currentSide, carrier);
    return new EmbedBuilder()
      .setColor(0x2684d8)
      .setTitle(`⚽ ${userTeamName} vs Occult`)
      .setDescription(describe(state))
      .addFields(
        { name: 'Aktywny zawodnik', value: `${carrier.name} · ${carrier.position}`, inline: true },
        { name: 'TP zawodnika', value: String(tp), inline: true },
        { name: 'Formacja', value: `${state.formation} · slot ${state.slot}/4`, inline: true },
        { name: 'Zmiany', value: `${state.homeSubstitutions ?? 0}/5`, inline: true },
      )
      .setFooter({ text: footer ?? (state.phase === 'home' ? 'Wybierz akcję. Hissatsu zużywa TP zawodnika.' : 'Zatrzymaj atak Occult pressiem lub techniką obronną.') });
  }

  function promptPayload(state, menu = null, footer = null) {
    const currentTeam = state.phase === 'home' ? state.home : state.away;
    const carrier = bestCarrier(currentTeam, state, state.phase);
    const prompt = new EmbedBuilder()
      .setColor(state.phase === 'home' ? 0x2388d1 : 0xd7534f)
      .setTitle((state.phase === 'home' ? '⚡ Akcja!' : '🛡️ Obrona!') + ' — ' + state.minute + '′')
      .setDescription(carrier.name + ' ma piłkę dla ' + (state.phase === 'home' ? (state.teamName || state.username) : 'Occult') + '.\nStrefa: ' + zoneLabel(state.zone) + ' · TP ' + tpLeft(state, state.phase, carrier) + '\n\n' + (state.phase === 'home' ? 'Wybierz następny ruch:' : 'Zatrzymaj atak przeciwnika:'))
      .setFooter({ text: footer || ('Wynik ' + state.score.home + ' : ' + state.score.away + ' · ' + state.formation + ' · slot ' + state.slot + '/4') });
    return { embeds: [prompt], components: components(state, menu), attachments: [] };
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
      lastAction: state.log.length ? state.log[state.log.length - 1].replace(/\*\*/g, '') : 'Rozpoczyna się spotkanie.',
      footer,
    });
    const imageName = 'mecz-boisko.png';
    const matchEmbed = embed(state, footer).setImage(`attachment://${imageName}`);
    return {
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
    state.minute = Math.min(90, state.minute + 6);
    if (state.phase === 'home') {
      if (action === 'pass' || action === 'dribble') attackContest(state, action);
      else if (action === 'shot') {
        if (state.zone < 3) {
          await interaction.reply({ content: 'Zwykły strzał możesz oddać z pola karnego. Spróbuj podania, dryblingu albo Hissatsu z oznaczeniem (L).', ephemeral: true });
          state.minute = Math.max(0, state.minute - 6);
          return;
        }
        const attacker = pick(state.home, (player) => player.position === 'Napastnik',
          (player) => stat(player, 'kick', state, 'home'));
        tire(state, 'home', attacker);
        resolveShot(state, 'home', attacker);
      } else if (action === 'tech' && option) {
        if (!spendTp(state, 'home', option.player, option.cost)) {
          await interaction.reply({ content: `${option.player.name} nie ma już wystarczająco TP.`, ephemeral: true });
          state.minute = Math.max(0, state.minute - 6);
          return;
        }
        if (option.move.type === 'Strzał') {
          if (state.zone < 3 && !isLongShot(option.move)) {
            await interaction.reply({ content: 'Ta technika nie ma oznaczenia (L), więc można jej użyć tylko z pola karnego.', ephemeral: true });
            state.minute = Math.max(0, state.minute - 6);
            return;
          }
          tire(state, 'home', option.player);
          addLog(state, `${option.player.name} używa **${option.move.name}**!`);
          resolveShot(state, 'home', option.player, option);
        } else if (option.move.type === 'Drybling') {
          attackContest(state, 'dribble', option);
        }
      }
    } else if (action === 'press') {
      defend(state);
    } else if (action === 'keeper') {
      const keeper = bestKeeper(state.home);
      if (keeper) addLog(state, `${keeper.name} ustawia się do obrony!`);
      resolveShot(state, 'away', bestCarrier(state.away, state, 'away'), null);
    } else if (action === 'tech' && option) {
      const failure = defensiveTechnique(state, option);
      if (failure) {
        await interaction.reply({ content: failure, ephemeral: true });
        state.minute = Math.max(0, state.minute - 6);
        return;
      }
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
    const home = saved.players.map((name) => catalog.find((player) => player.name === name)).filter(Boolean);
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
      phase: 'home',
      zone: 1,
      minute: 0,
      score: { home: 0, away: 0 },
      log: [],
      homeTp: Object.fromEntries(home.map((player) => [player.name, player.stats?.tp ?? 100])),
      awayTp: Object.fromEntries(away.map((player) => [player.name, player.stats?.tp ?? 100])),
      homeStamina: Object.fromEntries(home.map((player) => [player.name, player.stats?.stamina ?? 50])),
      awayStamina: Object.fromEntries(away.map((player) => [player.name, player.stats?.stamina ?? 50])),
      finished: false,
    };
    sessions.set(id, state);
    ownerSessions.set(ownerKey, id);
    await interaction.reply({ ...(await payload(state, null, 'Mecz rozpoczyna się')), fetchReply: true });
    await interaction.followUp({ ...promptPayload(state, null, 'Rozpoczęcie · wybierz pierwszą akcję.'), fetchReply: true });
  }

  async function handleButton(interaction) {
    const [, id, action] = interaction.customId.split(':');
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
      await interaction.update(promptPayload(state, options));
      return;
    }
    if (action === 'sub') {
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
    if (action === 'cancel-menu') {
      state.pendingSubOut = null;
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
    current.minute = Math.min(90, current.minute + 6);
    addLog(current, `Zmiana: **${incoming.name}** wchodzi za **${outgoing.name}**.`);
    flipTo(current, 'away');
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
    const options = eligibleTechniques(state);
    const option = options[Number(interaction.values[0])];
    if (!option) {
      await interaction.reply({ content: 'Ta technika nie jest już dostępna w tej sytuacji.', ephemeral: true });
      return;
    }
    await commitAction(interaction, state, 'tech', option);
  }

  return { start, handleButton, handleTechnique, handleSubstitution };
}
