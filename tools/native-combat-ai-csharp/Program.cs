using System;
using System.Collections.Generic;
using GoldenLand.NativeCombatAi;

internal static class Program
{
    private static int checks;

    private static void Equal<T>(T expected, T actual, string message)
    {
        ++checks;
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException(message + ": expected " + expected + ", got " + actual);
    }

    private static void True(bool value, string message)
    {
        ++checks;
        if (!value)
            throw new InvalidOperationException(message);
    }

    private static Combatant Person(int objectIndex, int id, int x, int y)
    {
        return new Combatant
        {
            ObjectIndex = objectIndex,
            Id = id,
            RelationId = id + 1000,
            Position = new Cell(x, y),
            Health = 20
        };
    }

    private static RosterEntry Entry(int objectIndex, int marker, int priority, int relation)
    {
        return new RosterEntry
        {
            ObjectIndex = objectIndex,
            Marker = marker,
            Priority = priority,
            RelationRank = relation
        };
    }

    private static ActorState Fighter()
    {
        return new ActorState
        {
            Id = 1,
            Health = 30,
            FleeHealthThreshold = 10,
            SelfPreservationHealthThreshold = 0,
            ActionPoints = 12,
            Energy = 10,
            Position = new Cell(0, 0),
            AttackRange = 2,
            AttackActionPointCost = 4,
            BattleMagicProbability = 0.0
        };
    }

    private static SimulationEnvironment World(params Combatant[] people)
    {
        SimulationEnvironment environment = new SimulationEnvironment();
        foreach (Combatant person in people)
            environment.Objects.Add(person.ObjectIndex, person);
        return environment;
    }

    private static void NativeDistanceMatchesRecoveredMetric()
    {
        Equal(6, NativeCombatAiSimulator.NativeDistance(new Cell(0, 0), new Cell(6, 0)), "orthogonal distance");
        Equal(8, NativeCombatAiSimulator.NativeDistance(new Cell(0, 0), new Cell(6, 6)), "diagonal distance");
        Equal(7, NativeCombatAiSimulator.NativeDistance(new Cell(1, 2), new Cell(7, 6)), "mixed distance");
    }

    private static void TargetScoresAndDescendingQueueMatchNativeFormula()
    {
        Combatant primary = Person(10, 101, 1, 0);
        Combatant secondary = Person(11, 102, 2, 0);
        Combatant ordinary = Person(12, 103, 3, 0);
        SimulationEnvironment environment = World(primary, secondary, ordinary);
        ActorState actor = Fighter();
        actor.PrimaryPreferredTargetId = 101;
        actor.SecondaryPreferredTargetId = 102;
        actor.Roster.Add(Entry(12, 0, 0, 0));
        actor.Roster.Add(Entry(11, 0, 0, 1));
        actor.Roster.Add(Entry(10, 1, 4, 1));

        List<RankedTarget> ranked = NativeCombatAiSimulator.RankTargets(actor, environment);
        Equal(3, ranked.Count, "ranked target count");
        Equal(101, ranked[0].Target.Id, "primary target first");
        Equal(23, ranked[0].Score, "primary target score");
        Equal(102, ranked[1].Target.Id, "secondary target second");
        Equal(13, ranked[1].Score, "secondary target score");
        Equal(103, ranked[2].Target.Id, "ordinary target last");
        Equal(6, ranked[2].Score, "ordinary target score");
    }

    private static void RelationOverrideAndEligibilityAreApplied()
    {
        Combatant hostile = Person(20, 201, 1, 0);
        Combatant excluded = Person(21, 202, 1, 0);
        Combatant dead = Person(22, 203, 1, 0);
        dead.Health = 0;
        SimulationEnvironment environment = World(hostile, excluded, dead);
        environment.RelationLookup = delegate(int relationId, int anchor)
        {
            return relationId == hostile.RelationId ? 1 : 2;
        };
        ActorState actor = Fighter();
        actor.RelationAnchor = 77;
        actor.Roster.Add(Entry(20, 0, 0, 9));
        actor.Roster.Add(Entry(21, 0, 0, 0));
        actor.Roster.Add(Entry(22, 0, 0, 0));

        List<RankedTarget> ranked = NativeCombatAiSimulator.RankTargets(actor, environment);
        Equal(1, ranked.Count, "relation and life filters");
        Equal(201, ranked[0].Target.Id, "relation override keeps hostile");
        Equal(5, ranked[0].Score, "overridden relation contributes to score");
    }

    private static void NearTargetAttacks()
    {
        Combatant target = Person(30, 301, 2, 0);
        SimulationEnvironment environment = World(target);
        environment.PathCost = delegate { return 2; };
        ActorState actor = Fighter();
        actor.Roster.Add(Entry(30, 0, 0, 0));

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.Attack, decision.Kind, "near target action");
        Equal(301, decision.Target.Id, "near target identity");
        Equal(8, actor.ActionPoints, "attack AP deduction");
    }

    private static void FarTargetAdvancesAndAttacksWhenAffordable()
    {
        Combatant target = Person(40, 401, 10, 0);
        SimulationEnvironment environment = World(target);
        environment.PathCost = delegate { return 10; };
        ActorState actor = Fighter();
        actor.ActionPoints = 20;
        actor.Roster.Add(Entry(40, 0, 0, 0));

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.AdvanceAndAttack, decision.Kind, "far affordable target action");
        Equal(7, actor.ActionPoints, "native attack plus movement AP cost");
    }

    private static void FarTargetMovesWhenFullAttackIsUnaffordable()
    {
        Combatant target = Person(50, 501, 10, 0);
        SimulationEnvironment environment = World(target);
        environment.PathCost = delegate { return 10; };
        ActorState actor = Fighter();
        actor.ActionPoints = 7;
        actor.Roster.Add(Entry(50, 0, 0, 0));

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.MoveToward, decision.Kind, "far unaffordable target action");
        Equal(7, actor.ActionPoints, "movement command owns later AP consumption");
    }

    private static void BlockedTargetsFallThroughAtMostThreeAlternatives()
    {
        Combatant first = Person(60, 601, 1, 0);
        Combatant second = Person(61, 602, 2, 0);
        Combatant third = Person(62, 603, 2, 0);
        Combatant fourth = Person(63, 604, 2, 0);
        Combatant fifth = Person(64, 605, 2, 0);
        SimulationEnvironment environment = World(first, second, third, fourth, fifth);
        environment.PathCost = delegate(ActorState actor, Combatant target)
        {
            return target.Id == 604 ? 2 : -1;
        };
        ActorState actorState = Fighter();
        actorState.PrimaryPreferredTargetId = 601;
        actorState.SecondaryPreferredTargetId = 602;
        actorState.Roster.Add(Entry(60, 0, 0, 0));
        actorState.Roster.Add(Entry(61, 0, 0, 0));
        actorState.Roster.Add(Entry(62, 0, 0, 0));
        actorState.Roster.Add(Entry(63, 0, 0, 0));
        actorState.Roster.Add(Entry(64, 0, 0, 0));

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actorState, environment);
        Equal(DecisionKind.Attack, decision.Kind, "fourth queued target is attempted");
        Equal(604, decision.Target.Id, "third alternative selected");
        Equal(4, decision.TargetsTried, "initial plus three alternative attempts");

        environment.PathCost = delegate { return -1; };
        actorState.ActionPoints = 12;
        Decision blocked = NativeCombatAiSimulator.ExecuteTurn(actorState, environment);
        Equal(DecisionKind.EndTurn, blocked.Kind, "fifth target is not attempted");
        Equal(0, actorState.ActionPoints, "blocked queue exhausts turn");
    }

    private static void SelfPreservationPrecedesQueuedActionAndTargeting()
    {
        Combatant target = Person(70, 701, 1, 0);
        SimulationEnvironment environment = World(target);
        environment.NextDouble = delegate { return 0.1; };
        ActorState actor = Fighter();
        actor.Health = 2;
        actor.FleeHealthThreshold = 0;
        actor.SelfPreservationHealthThreshold = 10;
        actor.HasQueuedAction = true;
        actor.Actions.Add(new NativeAction
        {
            Name = "heal",
            SelfPreservation = true,
            EnergyCost = 3,
            ActionPointCost = 2
        });
        actor.Roster.Add(Entry(70, 0, 0, 0));

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.SelfPreservation, decision.Kind, "self preservation order");
        Equal("heal", decision.Action.Name, "self preservation action");
        Equal(7, actor.Energy, "self preservation energy cost");
        Equal(10, actor.ActionPoints, "self preservation AP cost");
    }

    private static void QueuedActionStopsNewDecision()
    {
        ActorState actor = Fighter();
        actor.HasQueuedAction = true;
        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, new SimulationEnvironment());
        Equal(DecisionKind.QueuedAction, decision.Kind, "queued action guard");
    }

    private static void LowHealthSwitchesToRetreat()
    {
        Combatant target = Person(80, 801, 1, 0);
        SimulationEnvironment environment = World(target);
        environment.RetreatDestination = delegate { return new Cell(9, 9); };
        ActorState actor = Fighter();
        actor.Health = 4;
        actor.FleeHealthThreshold = 5;
        actor.Roster.Add(Entry(80, 0, 0, 0));

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(1, actor.Mode, "low health mode");
        Equal(DecisionKind.Retreat, decision.Kind, "retreat decision");
        Equal("9,9", decision.Destination.ToString(), "retreat destination");
    }

    private static void NoTargetFallbackOrderMatchesDispatcher()
    {
        Combatant remembered = Person(90, 901, 7, 7);
        Combatant follow = Person(91, 902, 30, 0);
        SimulationEnvironment environment = World(remembered, follow);
        ActorState actor = Fighter();
        actor.RememberedTargetObjectIndex = 90;
        actor.RememberedDestination = new Cell(6, 6);
        actor.FollowEnabled = true;
        actor.FollowTargetObjectIndex = 91;

        Decision rememberedDecision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.MoveRemembered, rememberedDecision.Kind, "remembered move precedes follow");

        Decision followDecision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.FollowAnchor, followDecision.Kind, "follow after remembered move");
        Equal(902, followDecision.Target.Id, "follow target");
    }

    private static void RegroupUsesMidpointAndDeterministicJitter()
    {
        Combatant anchor = Person(100, 1001, 20, 10);
        SimulationEnvironment environment = World(anchor);
        int[] rolls = { -2, 3 };
        int roll = 0;
        environment.NextInclusive = delegate { return rolls[roll++]; };
        ActorState actor = Fighter();
        actor.SecondaryPreferredTargetId = 1001;
        actor.RegroupPending = true;

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.Regroup, decision.Kind, "regroup decision");
        Equal("8,8", decision.Destination.ToString(), "midpoint plus native jitter");
        True(!actor.RegroupPending, "regroup flag clears after valid destination");
    }

    private static void CombatActionUsesInjectedRandomSelection()
    {
        Combatant target = Person(110, 1101, 1, 0);
        SimulationEnvironment environment = World(target);
        environment.NextDouble = delegate { return 0.2; };
        environment.NextInclusive = delegate { return 1; };
        ActorState actor = Fighter();
        actor.BattleMagicProbability = 0.5;
        actor.Actions.Add(new NativeAction { Name = "first", EnergyCost = 1, ActionPointCost = 1 });
        actor.Actions.Add(new NativeAction { Name = "second", EnergyCost = 2, ActionPointCost = 3 });
        actor.Roster.Add(Entry(110, 0, 0, 0));

        Decision decision = NativeCombatAiSimulator.ExecuteTurn(actor, environment);
        Equal(DecisionKind.CastAction, decision.Kind, "combat action precedes physical attack");
        Equal("second", decision.Action.Name, "injected random action selection");
        Equal(8, actor.Energy, "combat action energy cost");
        Equal(9, actor.ActionPoints, "combat action AP cost");
    }

    public static int Main()
    {
        NativeDistanceMatchesRecoveredMetric();
        TargetScoresAndDescendingQueueMatchNativeFormula();
        RelationOverrideAndEligibilityAreApplied();
        NearTargetAttacks();
        FarTargetAdvancesAndAttacksWhenAffordable();
        FarTargetMovesWhenFullAttackIsUnaffordable();
        BlockedTargetsFallThroughAtMostThreeAlternatives();
        SelfPreservationPrecedesQueuedActionAndTargeting();
        QueuedActionStopsNewDecision();
        LowHealthSwitchesToRetreat();
        NoTargetFallbackOrderMatchesDispatcher();
        RegroupUsesMidpointAndDeterministicJitter();
        CombatActionUsesInjectedRandomSelection();
        Console.WriteLine("native combat AI scenarios passed: " + checks + " checks");
        return 0;
    }
}
