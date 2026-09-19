/* wardsynq/wardsynq-readlog.js — who saw the number before it turned out to be wrong.
 *
 * Every correction path in this build can say WHAT changed. None of them can say WHO ACTED ON THE
 * OLD VALUE, because nothing recorded that anybody read it. HAZ-FLUID-01 has been PARTIAL for
 * exactly this: a consultant prescribes diuresis at 06:00 off a fluid balance containing a urine
 * output of 400 mL that was really 40, the figure is corrected at 08:00, and the correction reaches
 * the person who made it and nobody else.
 *
 * This is the missing half. It records that a derived value was DISPLAYED to a named person at a
 * time, so that when the value is later found to be wrong there is a list of people to tell.
 *
 *   1. IT RECORDS READS, NOT VIEWS. A page that renders a hundred numbers has not shown a clinician
 *      a hundred numbers. Logging everything on screen produces a list nobody can act on and buries
 *      the three reads that mattered, so a read is recorded where a value was DECISIVE: opened,
 *      expanded, printed, or carried into an order.
 *   2. IT IS AN AUDIT TRAIL AND THEREFORE A SURVEILLANCE RISK. A log of which clinician looked at
 *      what, when, is also a management tool for something other than safety, and if it is used that
 *      way people will stop opening things. The retention is bounded, the purpose is stated on every
 *      entry, and `forNotification()` deliberately returns only what is needed to warn somebody.
 *   3. A CORRECTION PRODUCES A LIST OF PEOPLE, NOT A NUMBER. The output is who to tell and what they
 *      saw, because "3 totals changed" is not actionable and "Dr Shah read the 06:00 balance, which
 *      was wrong by 360 mL" is.
 *   4. READING A VALUE THAT WAS ALREADY CORRECT IS NOT AN INCIDENT. Only reads of a version that was
 *      later superseded are surfaced, and only reads BEFORE the correction.
 *
 * NOT MODELLED: delivering the notification, which is wardsynq-transport.js's job; consent or the
 * governance of who may query this log, which belongs to the same committee that owns the audit
 * trail; and any inference about whether a decision was actually changed by the value.
 *
 * STATUS: IMPLEMENTED and TESTED.
 *
 * node --test test/wardsynq-readlog.test.mjs
 */

/** Why a value was on somebody's screen. Only the decisive ones are worth recording. */
const READ_KIND = Object.freeze({
  OPENED: "opened",         // the clinician opened this value's detail
  EXPANDED: "expanded",     // drilled into its provenance
  PRINTED: "printed",       // put on paper, which then leaves the system entirely
  ACTED_ON: "acted-on",     // carried into an order, a prescription or a documented decision
  HANDOVER: "handover",     // read out at a handover, so a whole team now believes it
});

/** How long reads are kept. Bounded on purpose: see the surveillance note in the header. */
const RETENTION_DAYS = 90;

class ReadLogError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ReadLogError";
    this.code = code || "READLOG_VIOLATION";
  }
}

class ReadLog {
  constructor({ now, retentionDays } = {}) {
    this.now = now || (() => new Date().toISOString());
    this.retentionDays = typeof retentionDays === "number" ? retentionDays : RETENTION_DAYS;
    this.entries = [];
  }

  /**
   * Records that a named person was shown a specific version of a derived value.
   *
   * `version` is what makes this useful: without it there is no way to tell a read of the wrong
   * figure from a read of the corrected one, and every correction would notify everybody.
   */
  record({ valueId, version, value, by, kind, patientId, at, context } = {}) {
    if (!valueId) throw new ReadLogError("a read names the value that was shown", "NO_VALUE");
    if (!by) throw new ReadLogError("a read names the person it was shown to; an anonymous read cannot be told about a correction", "NO_ACTOR");
    if (!Object.values(READ_KIND).includes(kind)) {
      throw new ReadLogError(
        `kind must be one of ${Object.values(READ_KIND).join(", ")}. A value merely rendered on a page is not a read: logging every number on screen produces a list nobody can act on and buries the three that mattered`,
        "NO_KIND");
    }
    if (version === undefined || version === null) {
      throw new ReadLogError("a read records WHICH version was shown, or a correction cannot tell a read of the wrong figure from a read of the right one", "NO_VERSION");
    }

    const entry = Object.freeze({
      valueId, version, value: value === undefined ? null : value,
      by, kind, patientId: patientId || null,
      at: at || this.now(),
      context: context || null,
      // Stated on every entry, so the purpose travels with the data rather than living in a policy
      // document nobody reads before running a query against it.
      purpose: "Recorded so that this person can be told if the value is later found to be wrong. Not for performance management.",
    });
    this.entries.push(entry);
    return entry;
  }

  /** Drops entries past the retention window. A read log that grows forever becomes a dossier. */
  prune(nowIso) {
    const cutoff = Date.parse(nowIso || this.now()) - this.retentionDays * 86_400_000;
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => Date.parse(e.at) >= cutoff);
    return { removed: before - this.entries.length, remaining: this.entries.length };
  }

  /**
   * Who read a version of this value BEFORE it was corrected.
   *
   * Two filters that matter. Reads of a version that is still current are not affected by anything,
   * and reads AFTER the correction saw the right figure, so neither is surfaced. Notifying either
   * would flood the list and teach people that these notices are noise.
   */
  readersToNotify({ valueId, supersededVersion, correctedAt } = {}) {
    if (!valueId || supersededVersion === undefined || !correctedAt) {
      throw new ReadLogError("finding readers needs the value, the version that turned out to be wrong, and when it was corrected", "NO_CORRECTION");
    }
    const cut = Date.parse(correctedAt);
    return this.entries.filter((e) =>
      e.valueId === valueId
      && e.version === supersededVersion
      && Date.parse(e.at) < cut);
  }

  /**
   * The actionable output: a list of people, what each of them saw, and how wrong it was.
   *
   * "Three totals changed" is not actionable. "Dr Shah read the 06:00 balance at 06:12 and it was
   * wrong by 360 mL" is, and the difference is whether anybody does anything.
   */
  forNotification({ valueId, supersededVersion, correctedAt, label, wasValue, nowValue, delta, unit } = {}) {
    const readers = this.readersToNotify({ valueId, supersededVersion, correctedAt });

    // One person may have read it several times. Notify a person once, with their earliest and most
    // significant read, rather than sending four messages about one number.
    const byPerson = new Map();
    for (const r of readers) {
      const existing = byPerson.get(r.by);
      const moreSignificant = existing && existing.kind !== READ_KIND.ACTED_ON && r.kind === READ_KIND.ACTED_ON;
      if (!existing || Date.parse(r.at) < Date.parse(existing.at) || moreSignificant) {
        byPerson.set(r.by, moreSignificant ? r : (existing && Date.parse(existing.at) <= Date.parse(r.at) ? existing : r));
      }
    }

    const people = [...byPerson.values()].map((r) => ({
      person: r.by,
      readAt: r.at,
      kind: r.kind,
      sawValue: r.value,
      // The ones who carried it into an order are named first: they are the ones who may have
      // prescribed on it.
      actedOn: r.kind === READ_KIND.ACTED_ON,
      message: `You saw ${label || valueId} as ${r.value}${unit ? " " + unit : ""} at ${r.at}. It has been corrected to ${nowValue}${unit ? " " + unit : ""}${typeof delta === "number" ? `, a difference of ${delta > 0 ? "+" : ""}${delta}${unit ? " " + unit : ""}` : ""}. If you made a decision on it, please review it.`,
    })).sort((a, b) => (b.actedOn ? 1 : 0) - (a.actedOn ? 1 : 0) || Date.parse(a.readAt) - Date.parse(b.readAt));

    return {
      valueId, label: label || valueId, wasValue, nowValue, delta, unit: unit || null,
      correctedAt,
      people,
      count: people.length,
      actedOnCount: people.filter((p) => p.actedOn).length,
      reading: people.length === 0
        ? `${label || valueId} was corrected and nobody had read the previous figure. Nothing to tell anybody.`
        : `${people.length} ${people.length === 1 ? "person" : "people"} saw the previous figure${people.some((p) => p.actedOn) ? `, and ${people.filter((p) => p.actedOn).length} carried it into a decision` : ""}. Each needs telling.`,
      // The honest limit, on the output rather than in a comment nobody opens.
      limitation: "This lists who was SHOWN the value. It does not know whether any of them relied on it, and a clinician who read it and ignored it will be told too. That is the correct direction to be wrong in.",
    };
  }

  /** Everything one person has been shown, which is what a subject access request asks for. */
  forPerson(person) {
    return this.entries.filter((e) => e.by === person);
  }
}

/**
 * Bridges a flowsheet correction to the read log and produces notices ready for the transport.
 *
 * This is the join HAZ-FLUID-01 named as missing: the flowsheet knows what changed, the read log
 * knows who saw it, and neither alone can tell a consultant that the number they prescribed on has
 * moved.
 */
function notifyReadersOfCorrection({ readLog, recomputation, valueId, supersededVersion, correctedAt, label, unit } = {}) {
  if (!readLog) throw new ReadLogError("no read log", "NO_LOG");
  if (!recomputation || !Array.isArray(recomputation.changed)) {
    throw new ReadLogError("this needs the recomputation from wardsynq-flowsheet.js, which says what actually changed", "NO_RECOMPUTATION");
  }

  const notices = [];
  for (const change of recomputation.changed) {
    const batch = readLog.forNotification({
      valueId: valueId || change.label,
      supersededVersion,
      correctedAt,
      label: label || change.label,
      wasValue: change.wasMl,
      nowValue: change.nowMl,
      delta: change.deltaMl,
      unit: unit || "mL",
    });
    for (const person of batch.people) {
      notices.push({
        to: person.person,
        // Urgent when they acted on it or when the correction crossed a threshold they prescribe
        // against: both mean a decision may now be wrong rather than merely informed by a wrong number.
        urgency: person.actedOn || (change.crossedThresholds || []).length ? "urgent" : "routine",
        title: `Corrected: ${batch.label}`,
        body: person.message + ((change.crossedThresholds || []).length ? ` This total also crossed ${change.crossedThresholds.join(", ")} mL, so ${change.significance}.` : ""),
        valueId: batch.valueId,
        actedOn: person.actedOn,
      });
    }
  }

  return {
    notices,
    count: notices.length,
    urgent: notices.filter((n) => n.urgency === "urgent").length,
    reading: notices.length === 0
      ? "The correction changed totals nobody had read."
      : `${notices.length} ${notices.length === 1 ? "person needs" : "people need"} telling, ${notices.filter((n) => n.urgency === "urgent").length} urgently.`,
  };
}

export { READ_KIND, RETENTION_DAYS, ReadLogError, ReadLog, notifyReadersOfCorrection };
