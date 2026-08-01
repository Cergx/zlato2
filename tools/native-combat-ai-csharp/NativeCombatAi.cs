using System;
using System.Collections.Generic;

namespace GoldenLand.NativeCombatAi
{
    public struct Cell
    {
        public readonly int X;
        public readonly int Y;

        public Cell(int x, int y)
        {
            X = x;
            Y = y;
        }

        public override string ToString()
        {
            return X + "," + Y;
        }
    }

    public sealed class Combatant
    {
        public int ObjectIndex;
        public int Id;
        public int RelationId;
        public bool IsPerson = true;
        public bool Active = true;
        public int Health = 1;
        public Cell Position;
    }

    public sealed class RosterEntry
    {
        public int ObjectIndex;
        public int Marker;
        public int Priority;
        public int RelationRank;
    }

    public sealed class NativeAction
    {
        public string Name = "";
        public int EnergyCost;
        public int ActionPointCost;
        public bool SelfPreservation;
        public Func<Combatant, bool> CanTarget = delegate { return true; };
    }

    public sealed class ActorState
    {
        public int Id;
        public int Health = 1;
        public int Energy;
        public int ActionPoints;
        public Cell Position;
        public int Mode;
        public int FleeHealthThreshold;
        public bool ModeGateEnabled = true;
        public int TemplateType;
        public int SelfPreservationHealthThreshold;
        public double BattleMagicProbability;
        public bool ActionBlocked;
        public bool HasQueuedAction;
        public int PrimaryPreferredTargetId = -1;
        public int SecondaryPreferredTargetId = -1;
        public int RelationAnchor = -1;
        public int AttackRange = 1;
        public int AttackActionPointCost = 1;
        public int RememberedTargetObjectIndex = -1;
        public bool RememberedMoveIssued;
        public Cell RememberedDestination;
        public bool FollowEnabled;
        public int FollowTargetObjectIndex = -1;
        public bool RegroupPending;
        public bool HasTemplateFallback;
        public readonly List<RosterEntry> Roster = new List<RosterEntry>();
        public readonly List<NativeAction> Actions = new List<NativeAction>();
    }

    public sealed class RankedTarget
    {
        public readonly Combatant Target;
        public readonly int Score;
        public readonly int RosterOrder;

        public RankedTarget(Combatant target, int score, int rosterOrder)
        {
            Target = target;
            Score = score;
            RosterOrder = rosterOrder;
        }
    }

    public enum DecisionKind
    {
        None,
        QueuedAction,
        SelfPreservation,
        CastAction,
        Attack,
        AdvanceAndAttack,
        MoveToward,
        Retreat,
        MoveRemembered,
        FollowAnchor,
        Regroup,
        TemplateFallback,
        EndTurn
    }

    public sealed class Decision
    {
        public readonly DecisionKind Kind;
        public readonly Combatant Target;
        public readonly Cell Destination;
        public readonly NativeAction Action;
        public readonly int Score;
        public readonly int TargetsTried;

        public Decision(DecisionKind kind, Combatant target, Cell destination, NativeAction action, int score, int targetsTried)
        {
            Kind = kind;
            Target = target;
            Destination = destination;
            Action = action;
            Score = score;
            TargetsTried = targetsTried;
        }

        public static Decision Simple(DecisionKind kind)
        {
            return new Decision(kind, null, new Cell(), null, 0, 0);
        }
    }

    public sealed class SimulationEnvironment
    {
        public readonly Dictionary<int, Combatant> Objects = new Dictionary<int, Combatant>();
        public int TargetQueueCapacity = 256;
        public Func<int, int, int> RelationLookup;
        public Func<ActorState, Combatant, int> PathCost = delegate { return 0; };
        public Func<ActorState, Cell?> RetreatDestination = delegate { return null; };
        public Func<ActorState, Combatant, Cell> FollowDestination = delegate(ActorState actor, Combatant target) { return target.Position; };
        public Func<ActorState, Cell, bool> IsRegroupCellValid = delegate { return true; };
        public Func<double> NextDouble = delegate { return 0.0; };
        public Func<int, int, int> NextInclusive = delegate(int minimum, int maximum) { return minimum; };
        public int MaxRegroupAttempts = 4096;
        public bool CombatRulesEnabled = true;
        public bool SelfPreservationPhaseEnabled = true;
    }

    public static class NativeCombatAiSimulator
    {
        private const double DiagonalWeight = 0.375;

        public static int NativeDistance(Cell left, Cell right)
        {
            int dx = Math.Abs(left.X - right.X);
            int dy = Math.Abs(left.Y - right.Y);
            int maximum = Math.Max(dx, dy);
            int minimum = Math.Min(dx, dy);
            return (int)Math.Truncate(maximum + minimum * DiagonalWeight);
        }

        public static void UpdateMode(ActorState actor)
        {
            if (actor.Mode != 1 && actor.Health < actor.FleeHealthThreshold)
            {
                actor.Mode = 1;
                return;
            }

            if (!actor.ModeGateEnabled)
            {
                actor.Mode = 1;
                return;
            }

            if (actor.Mode == 0 || actor.Health < actor.FleeHealthThreshold || actor.TemplateType != 0)
                return;

            actor.Mode = 0;
        }

        public static int ScoreTarget(ActorState actor, Combatant candidate, RosterEntry entry, int relationRank)
        {
            int score = candidate.Id == actor.PrimaryPreferredTargetId ? 28 - entry.Priority : 0;
            if (candidate.Id == actor.SecondaryPreferredTargetId)
                score += 8;
            score -= relationRank;
            score += 2;
            score -= entry.Priority >> 1;
            if (entry.Marker == 0)
                score += 4;
            return score;
        }

        public static List<RankedTarget> RankTargets(ActorState actor, SimulationEnvironment environment)
        {
            int capacity = Math.Max(0, environment.TargetQueueCapacity);
            List<RankedTarget> ranked = new List<RankedTarget>(Math.Min(actor.Roster.Count, capacity));
            for (int index = 0; index < actor.Roster.Count && ranked.Count < capacity; ++index)
            {
                RosterEntry entry = actor.Roster[index];
                Combatant candidate;
                if (entry.ObjectIndex < 0 || !environment.Objects.TryGetValue(entry.ObjectIndex, out candidate))
                    continue;
                if (!candidate.IsPerson || !candidate.Active || candidate.Health <= 0)
                    continue;

                int relationRank = entry.RelationRank;
                if (actor.RelationAnchor != -1 && environment.RelationLookup != null)
                    relationRank = environment.RelationLookup(candidate.RelationId, actor.RelationAnchor);
                if (relationRank >= 2)
                    continue;

                ranked.Add(new RankedTarget(candidate, ScoreTarget(actor, candidate, entry, relationRank), index));
            }

            ranked.Sort(delegate(RankedTarget left, RankedTarget right)
            {
                int scoreOrder = right.Score.CompareTo(left.Score);
                return scoreOrder != 0 ? scoreOrder : left.RosterOrder.CompareTo(right.RosterOrder);
            });
            return ranked;
        }

        public static Decision ExecuteTurn(ActorState actor, SimulationEnvironment environment)
        {
            UpdateMode(actor);

            if (environment.CombatRulesEnabled && environment.SelfPreservationPhaseEnabled)
            {
                Decision preservation = TrySelfPreservation(actor, environment);
                if (preservation != null)
                    return preservation;
            }

            if (actor.HasQueuedAction)
                return Decision.Simple(DecisionKind.QueuedAction);

            List<RankedTarget> targets = actor.Roster.Count == 0
                ? new List<RankedTarget>()
                : RankTargets(actor, environment);

            if (targets.Count != 0)
            {
                if (actor.Mode == 1)
                    return Retreat(actor, environment);
                if (actor.Mode == 0)
                    return Engage(actor, environment, targets);
                return Decision.Simple(DecisionKind.None);
            }

            Decision fallback;
            if (actor.Roster.Count == 0)
            {
                fallback = TryRememberedMove(actor, environment);
                if (fallback != null) return fallback;
                fallback = TryFollow(actor, environment);
                if (fallback != null) return fallback;
                if (actor.TemplateType == 2 && actor.HasTemplateFallback)
                    return Decision.Simple(DecisionKind.TemplateFallback);
                fallback = TryRegroup(actor, environment);
                if (fallback != null) return fallback;
            }
            else
            {
                fallback = TryRememberedMove(actor, environment);
                if (fallback != null) return fallback;
                fallback = TryRegroup(actor, environment);
                if (fallback != null) return fallback;
                fallback = TryFollow(actor, environment);
                if (fallback != null) return fallback;
            }

            if (environment.CombatRulesEnabled && !actor.HasQueuedAction)
                actor.ActionPoints = 0;
            return Decision.Simple(DecisionKind.EndTurn);
        }

        private static Decision TrySelfPreservation(ActorState actor, SimulationEnvironment environment)
        {
            if (actor.SelfPreservationHealthThreshold <= 0 || actor.Health >= actor.SelfPreservationHealthThreshold || actor.ActionBlocked)
                return null;

            double probability = 1.0 - 0.8 * actor.Health / actor.SelfPreservationHealthThreshold;
            if (environment.NextDouble() >= probability)
                return null;

            for (int index = 0; index < actor.Actions.Count; ++index)
            {
                NativeAction action = actor.Actions[index];
                if (!action.SelfPreservation || action.EnergyCost > actor.Energy || action.ActionPointCost > actor.ActionPoints)
                    continue;
                actor.Energy -= action.EnergyCost;
                actor.ActionPoints = Math.Max(0, actor.ActionPoints - action.ActionPointCost);
                return new Decision(DecisionKind.SelfPreservation, null, new Cell(), action, 0, 0);
            }
            return null;
        }

        private static Decision Engage(ActorState actor, SimulationEnvironment environment, List<RankedTarget> targets)
        {
            Decision spell = TryCombatAction(actor, environment, targets[0].Target);
            if (spell != null)
                return spell;

            int tries = Math.Min(targets.Count, 4);
            for (int index = 0; index < tries; ++index)
            {
                RankedTarget ranked = targets[index];
                int pathCost = environment.PathCost(actor, ranked.Target);
                if (pathCost < 0)
                    continue;

                int distance = NativeDistance(actor.Position, ranked.Target.Position);
                if (distance <= actor.AttackRange)
                {
                    if (actor.AttackActionPointCost <= actor.ActionPoints)
                    {
                        actor.ActionPoints -= actor.AttackActionPointCost;
                        return new Decision(DecisionKind.Attack, ranked.Target, ranked.Target.Position, null, ranked.Score, index + 1);
                    }
                    actor.ActionPoints = 0;
                    return new Decision(DecisionKind.EndTurn, ranked.Target, ranked.Target.Position, null, ranked.Score, index + 1);
                }

                int movementCost = (int)Math.Floor(pathCost - actor.AttackRange * 0.5);
                int fullCost = actor.AttackActionPointCost + movementCost;
                if (fullCost <= actor.ActionPoints)
                {
                    actor.ActionPoints -= fullCost;
                    return new Decision(DecisionKind.AdvanceAndAttack, ranked.Target, ranked.Target.Position, null, ranked.Score, index + 1);
                }

                return new Decision(DecisionKind.MoveToward, ranked.Target, ranked.Target.Position, null, ranked.Score, index + 1);
            }

            actor.ActionPoints = 0;
            return Decision.Simple(DecisionKind.EndTurn);
        }

        private static Decision TryCombatAction(ActorState actor, SimulationEnvironment environment, Combatant target)
        {
            if (actor.ActionBlocked || actor.Actions.Count == 0 || environment.NextDouble() >= actor.BattleMagicProbability)
                return null;

            List<NativeAction> eligible = new List<NativeAction>();
            for (int index = 0; index < actor.Actions.Count; ++index)
            {
                NativeAction action = actor.Actions[index];
                if (action.SelfPreservation || action.EnergyCost > actor.Energy || action.ActionPointCost > actor.ActionPoints)
                    continue;
                if (action.CanTarget(target))
                    eligible.Add(action);
            }
            if (eligible.Count == 0)
                return null;

            int selected = environment.NextInclusive(0, eligible.Count - 1);
            if (selected < 0) selected = 0;
            if (selected >= eligible.Count) selected = eligible.Count - 1;
            NativeAction chosen = eligible[selected];
            actor.Energy -= chosen.EnergyCost;
            actor.ActionPoints = Math.Max(0, actor.ActionPoints - chosen.ActionPointCost);
            return new Decision(DecisionKind.CastAction, target, target.Position, chosen, 0, 0);
        }

        private static Decision Retreat(ActorState actor, SimulationEnvironment environment)
        {
            if (actor.ActionPoints <= 3)
            {
                actor.ActionPoints = 0;
                return Decision.Simple(DecisionKind.EndTurn);
            }

            Cell? destination = environment.RetreatDestination(actor);
            if (!destination.HasValue || !environment.IsRegroupCellValid(actor, destination.Value))
            {
                actor.ActionPoints = 0;
                return Decision.Simple(DecisionKind.EndTurn);
            }
            return new Decision(DecisionKind.Retreat, null, destination.Value, null, 0, 0);
        }

        private static Decision TryRememberedMove(ActorState actor, SimulationEnvironment environment)
        {
            if (actor.Mode != 0 || actor.RememberedTargetObjectIndex == -1 || actor.RememberedMoveIssued)
                return null;
            Combatant remembered;
            if (!environment.Objects.TryGetValue(actor.RememberedTargetObjectIndex, out remembered) || !remembered.Active)
            {
                actor.RememberedTargetObjectIndex = -1;
                return null;
            }
            actor.RememberedMoveIssued = true;
            return new Decision(DecisionKind.MoveRemembered, remembered, actor.RememberedDestination, null, 0, 0);
        }

        private static Decision TryFollow(ActorState actor, SimulationEnvironment environment)
        {
            if (!actor.FollowEnabled || actor.FollowTargetObjectIndex < 0)
                return null;
            Combatant target;
            if (!environment.Objects.TryGetValue(actor.FollowTargetObjectIndex, out target))
                return null;
            if (NativeDistance(actor.Position, target.Position) < 14)
                return null;
            Cell destination = environment.FollowDestination(actor, target);
            return new Decision(DecisionKind.FollowAnchor, target, destination, null, 0, 0);
        }

        private static Decision TryRegroup(ActorState actor, SimulationEnvironment environment)
        {
            if (!actor.RegroupPending || actor.SecondaryPreferredTargetId == -1)
                return null;

            Combatant target = null;
            foreach (Combatant candidate in environment.Objects.Values)
            {
                if (candidate.Id == actor.SecondaryPreferredTargetId && candidate.IsPerson && candidate.Active && candidate.Health > 0)
                {
                    target = candidate;
                    break;
                }
            }
            if (target == null)
                return null;

            int halfX = (target.Position.X - actor.Position.X) / 2;
            int halfY = (target.Position.Y - actor.Position.Y) / 2;
            for (int attempt = 0; attempt < environment.MaxRegroupAttempts; ++attempt)
            {
                Cell destination = new Cell(
                    actor.Position.X + halfX + environment.NextInclusive(-10, 10),
                    actor.Position.Y + halfY + environment.NextInclusive(-10, 10));
                if (!environment.IsRegroupCellValid(actor, destination))
                    continue;
                actor.RegroupPending = false;
                return new Decision(DecisionKind.Regroup, target, destination, null, 0, 0);
            }
            return null;
        }
    }
}
