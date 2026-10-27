from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index,
    Integer, JSON, Numeric, String, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bot.db.base import Base


class World(Base):
    __tablename__ = "worlds"
    __table_args__ = (UniqueConstraint("guild_id", "name", name="uq_world_guild_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    guild_id: Mapped[int] = mapped_column(BigInteger, index=True)
    name: Mapped[str] = mapped_column(String(80), default="Inazuma")
    season: Mapped[int] = mapped_column(Integer, default=1)
    game_day: Mapped[int] = mapped_column(Integer, default=1)
    paused: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    leagues: Mapped[list[League]] = relationship(back_populates="world", cascade="all, delete-orphan")
    clubs: Mapped[list[Club]] = relationship(back_populates="world", cascade="all, delete-orphan")
    players: Mapped[list[Player]] = relationship(back_populates="world", cascade="all, delete-orphan")


class Manager(Base):
    __tablename__ = "managers"
    __table_args__ = (UniqueConstraint("world_id", "discord_user_id", name="uq_manager_world_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), index=True)
    discord_user_id: Mapped[int] = mapped_column(BigInteger)
    display_name: Mapped[str] = mapped_column(String(100))
    club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id", ondelete="SET NULL"), nullable=True)


class League(Base):
    __tablename__ = "leagues"
    __table_args__ = (UniqueConstraint("world_id", "number", name="uq_league_world_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(80))
    human_managed: Mapped[bool] = mapped_column(Boolean, default=False)
    world: Mapped[World] = relationship(back_populates="leagues")
    clubs: Mapped[list[Club]] = relationship(back_populates="league")


class Club(Base):
    __tablename__ = "clubs"
    __table_args__ = (
        UniqueConstraint("world_id", "league_id", "slot_number", name="uq_club_league_slot"),
        CheckConstraint("budget >= 0", name="ck_club_budget_nonnegative"),
        CheckConstraint("slot_number BETWEEN 1 AND 16", name="ck_club_slot_range"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), index=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    slot_number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(100))
    is_ai: Mapped[bool] = mapped_column(Boolean, default=True)
    budget: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("1000000"))
    wage_budget: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("100000"))
    league: Mapped[League] = relationship(back_populates="clubs")
    world: Mapped[World] = relationship(back_populates="clubs")
    players: Mapped[list[Player]] = relationship(back_populates="club")
    matches_home: Mapped[list[Match]] = relationship(foreign_keys="Match.home_club_id", back_populates="home_club")
    matches_away: Mapped[list[Match]] = relationship(foreign_keys="Match.away_club_id", back_populates="away_club")


class Player(Base):
    __tablename__ = "players"
    __table_args__ = (
        UniqueConstraint("world_id", "source_name", name="uq_player_world_source_name"),
        CheckConstraint("overall BETWEEN 1 AND 99", name="ck_player_overall"),
        CheckConstraint("potential BETWEEN 1 AND 99", name="ck_player_potential"),
        CheckConstraint("age >= 1", name="ck_player_age"),
        Index("ix_players_world_club", "world_id", "club_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), index=True)
    source_name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str] = mapped_column(String(30))
    element: Mapped[str | None] = mapped_column(String(20), nullable=True)
    overall: Mapped[int] = mapped_column(Integer)
    potential: Mapped[int] = mapped_column(Integer, default=70)
    age: Mapped[int] = mapped_column(Integer, default=18)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    techniques: Mapped[list] = mapped_column(JSON, default=list)
    retired: Mapped[bool] = mapped_column(Boolean, default=False)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id", ondelete="SET NULL"), nullable=True, index=True)
    world: Mapped[World] = relationship(back_populates="players")
    club: Mapped[Club | None] = relationship(back_populates="players")
    contracts: Mapped[list[Contract]] = relationship(back_populates="player", cascade="all, delete-orphan")
    injuries: Mapped[list[Injury]] = relationship(back_populates="player", cascade="all, delete-orphan")


class Contract(Base):
    __tablename__ = "contracts"
    __table_args__ = (
        CheckConstraint("wage >= 0", name="ck_contract_wage_nonnegative"),
        CheckConstraint("transfer_fee >= 0", name="ck_contract_fee_nonnegative"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    starts_on: Mapped[date] = mapped_column(Date)
    expires_on: Mapped[date] = mapped_column(Date)
    wage: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    transfer_fee: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    signing_bonus: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    player: Mapped[Player] = relationship(back_populates="contracts")


class TransferOffer(Base):
    __tablename__ = "transfer_offers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    from_club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id", ondelete="SET NULL"), nullable=True)
    to_club_id: Mapped[int] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"))
    fee: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    wage_offer: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    contract_years: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    negotiation_round: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Loan(Base):
    __tablename__ = "loans"
    __table_args__ = (
        CheckConstraint("ends_on >= starts_on", name="ck_loan_dates"),
        CheckConstraint("wage_share_parent BETWEEN 0 AND 100", name="ck_loan_wage_share"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    parent_club_id: Mapped[int] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"))
    loan_club_id: Mapped[int] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    wage_share_parent: Mapped[int] = mapped_column(Integer, default=50)
    loan_fee: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        CheckConstraint("home_score IS NULL OR home_score >= 0", name="ck_match_home_score"),
        CheckConstraint("away_score IS NULL OR away_score >= 0", name="ck_match_away_score"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), index=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    round_number: Mapped[int] = mapped_column(Integer)
    match_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    home_club_id: Mapped[int] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"))
    away_club_id: Mapped[int] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"))
    home_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    away_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    played: Mapped[bool] = mapped_column(Boolean, default=False)
    report: Mapped[list] = mapped_column(JSON, default=list)
    home_club: Mapped[Club] = relationship(foreign_keys=[home_club_id], back_populates="matches_home")
    away_club: Mapped[Club] = relationship(foreign_keys=[away_club_id], back_populates="matches_away")


class Injury(Base):
    __tablename__ = "injuries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(String(120), default="Kontuzja")
    starts_on: Mapped[date] = mapped_column(Date)
    returns_on: Mapped[date] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    player: Mapped[Player] = relationship(back_populates="injuries")


class PlayerDiscipline(Base):
    __tablename__ = "player_discipline"
    __table_args__ = (
        UniqueConstraint("player_id", "league_id", "season", name="uq_discipline_player_league_season"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    season: Mapped[int] = mapped_column(Integer)
    yellow_cards: Mapped[int] = mapped_column(Integer, default=0)
    suspended_matches: Mapped[int] = mapped_column(Integer, default=0)


class SeasonArchive(Base):
    __tablename__ = "season_archives"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), index=True)
    season: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
